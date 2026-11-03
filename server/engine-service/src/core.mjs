// Ядро конфигуратора: по файлу модели и выбору покупателя строит чертёж-образец.
// Скрипты построения никогда не покидают сервер: наружу уходят только поля формы и картинка с водяным знаком.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  leko, runChain, ELEMENT_ROLES, STANDARD_FIGURE_GROUPS, getStandardFigure,
  MEASUREMENT_INFO, MEASUREMENT_ORDER, EASE_INFO, USER_EASE_GROUPS,
  DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES,
} from "../../../packages/pattern-engine/dist/index.js";

/** Вариант «без элемента» в списке элементов на сайте. */
const NONE_TEXT = { sleeve: "без рукава", collar: "без воротника", other: "нет" };

export const WATERMARK = "СтройКрой · образец";

/** Модель из файла каталога → список построений для движка. */
export function buildList(model) {
  const base = {
    id: model.id, name: model.name, script: model.script, kind: "base",
    mode: model.mode, links: model.links ?? [], attached: { ...(model.defaultElements ?? {}) },
    shownOptions: Array.isArray(model.shownOptions) ? model.shownOptions : undefined,
  };
  const list = [base];
  const seen = new Set([base.id]);
  for (const [kind, arr] of Object.entries(model.elements ?? {})) {
    for (const e of arr) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      list.push({ id: e.id, name: e.name, script: e.script, kind });
    }
  }
  for (const l of model.links ?? []) {
    if (!l.element || seen.has(l.element) || typeof l.script !== "string") continue;
    seen.add(l.element);
    list.push({ id: l.element, name: l.element, script: l.script, kind: "other" });
  }
  return list;
}

const hasRange = (e) => Number.isFinite(e.min) && Number.isFinite(e.max) && e.min < e.max;
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v > lo && v < hi ? v : null);

/** Что показывать покупателю: ключи мерок и прибавок из userInputs(...) в скрипте (нет оператора — всё). */
function shownKeys(script, probeRun) {
  const u = probeRun.own.userInputs;
  if (!u) return { measurements: MEASUREMENT_ORDER, eases: USER_EASE_GROUPS.flatMap((g) => g.keys), groups: USER_EASE_GROUPS };
  const set = new Set(u);
  return {
    measurements: MEASUREMENT_ORDER.filter((k) => set.has(k)),
    eases: USER_EASE_GROUPS.flatMap((g) => g.keys).filter((k) => set.has(k)),
    groups: USER_EASE_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => set.has(k)) })).filter((g) => g.keys.length),
  };
}

/** Применяет выбор покупателя; всё, что не проходит проверку, молча заменяется значением по умолчанию. */
function resolve(model, sel = {}) {
  const list = buildList(model);
  const base = list[0];
  // не указано — типовая фигура по умолчанию; null — «свои мерки»
  const figId = sel.figure === undefined ? "164-96-104" : sel.figure;
  const figure = typeof figId === "string" ? getStandardFigure(figId) : undefined;
  const M = { ...(figure ? figure.measurements : DEFAULT_MEASUREMENTS_W_164_96_104) };
  const P = { ...DEFAULT_EASES };
  const height = figure ? figure.height : num(sel.height, 100, 230) ?? 164;
  const bust = figure ? figure.bust : num(sel.bust, 60, 200) ?? 96;

  // выбранные элементы: только те, что есть в модели
  const attached = { ...(base.attached ?? {}) };
  for (const r of ELEMENT_ROLES) {
    const id = sel.elements?.[r.kind];
    if (id === "" && !(model.requiredElements ?? {})[r.kind]) { delete attached[r.kind]; (base.suppressed ??= []).push(r.kind); } // покупатель выбрал вариант «без рукава» и т. п.
    else if (id !== undefined && (model.elements?.[r.kind] ?? []).some((e) => e.id === id)) attached[r.kind] = id;
  }
  // элемент обязателен (вариант «без…» не разрешён): если ничего не выбрано — берём первый из разрешённых
  for (const r of ELEMENT_ROLES) {
    const list = model.elements?.[r.kind] ?? [];
    if ((model.requiredElements ?? {})[r.kind] && list.length && !list.some((e) => e.id === attached[r.kind])) attached[r.kind] = list[0].id;
  }
  base.attached = attached;

  // готовое изделие: одна галочка «с припусками / без»; конструктор: размер каждого припуска отдельно
  const ready = model.mode === "ready";
  const withAllowance = !ready || sel.allowance !== false;
  const seam = withAllowance ? (num(sel.seam, 0, 6) ?? 1) : 0;
  const vals = {};
  for (const c of list) vals[c.id] = { seam_allowance: seam };
  const opts = sel.options && typeof sel.options === "object" ? sel.options : {};
  for (const [k, v] of Object.entries(opts)) if (typeof v === "number" && Number.isFinite(v)) vals[base.id][k] = v;

  const settings = { girths: "full", height, bust };
  // первый прогон: узнать, какие поля показывать
  const probe = runChain(list, base, M, P, vals, settings);
  const shown = shownKeys(model.script, probe);
  for (const k of shown.measurements) { const v = num(sel.measurements?.[k], 0, 400); if (v !== null) M[k] = v; }
  for (const k of shown.eases) { const v = sel.eases?.[k]; if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100) P[k] = v; }
  let ch = runChain(list, base, M, P, vals, settings);
  // Прибавки ease_* из файла Leko: показываем те, у которых сейчас есть диапазон; значение покупателя зажимаем в диапазон
  const collect = (c) => {
    const m = new Map();
    for (const e of [...c.own.eases, ...c.elements.flatMap((x) => x.result.eases)]) if (!m.has(e.name)) m.set(e.name, e);
    return m;
  };
  const easesAuto = collect(ch);
  const given = {};
  const wanted = sel.easeValues && typeof sel.easeValues === "object" ? sel.easeValues : {};
  for (const [name, v] of Object.entries(wanted)) {
    const e = easesAuto.get(name);
    if (!e || typeof v !== "number" || !Number.isFinite(v) || !hasRange(e)) continue;
    given[name] = Math.min(e.max, Math.max(e.min, v));
  }
  if (Object.keys(given).length) { settings.easeValues = given; ch = runChain(list, base, M, P, vals, settings); }
  // Припуски из spec_*_max файла Leko: у каждого свой предел; значение зажимаем в [0, max]
  const collectA = (c) => {
    const m = new Map();
    for (const a of [...c.own.allowances ?? [], ...c.elements.flatMap((x) => x.result.allowances ?? [])]) if (!m.has(a.name)) m.set(a.name, a);
    return m;
  };
  const allowAuto = collectA(ch);
  const givenA = {};
  const wantedA = sel.allowanceValues && typeof sel.allowanceValues === "object" ? sel.allowanceValues : {};
  if (!ready) for (const [name, v] of Object.entries(wantedA)) {
    const a = allowAuto.get(name);
    if (!a || name === "seam_allowance" || typeof v !== "number" || !Number.isFinite(v)) continue;
    givenA[name] = Math.min(a.max, Math.max(0, v));
  }
  const sa = allowAuto.get("seam_allowance");
  if (sa && withAllowance && seam > sa.max) { for (const c of list) vals[c.id].seam_allowance = sa.max; }
  if (Object.keys(givenA).length) settings.allowanceValues = givenA;
  if (Object.keys(givenA).length || (sa && seam > sa.max)) ch = runChain(list, base, M, P, vals, settings);
  const allowances = ready ? [] : [...collectA(ch).values()].map((a) => ({
    name: a.name, title: a.title, max: a.max, default: Math.min(a.max, allowAuto.get(a.name)?.default ?? a.default ?? 0),
    value: a.name === "seam_allowance" ? vals[base.id].seam_allowance : (a.set ? a.value : null),
  }));
  const easesNow = collect(ch);
  const eases = [...easesNow.values()].filter(hasRange).map((e) => ({
    name: e.name, title: /^Прибавка: /.test(e.title ?? "") ? leko.easeTitle(e.name) : e.title, unit: e.unit ?? "", min: e.min, max: e.max,
    pattern: e.pattern, default: easesAuto.get(e.name)?.default ?? null, value: e.set ? e.value : null,
  }));
  return { list, base, M, P, vals, settings, ch, shown, figure, height, bust, seam: vals[base.id].seam_allowance, attached, eases, allowances, ready, withAllowance };
}

function optionList(ch, base) {
  const seen = new Set(["seam_allowance"]);
  const groups = [{ inputs: ch.own.inputs.filter((i) => i.option) }, ...ch.elements.map((e) => ({ inputs: e.result.inputs.filter((i) => i.option) }))];
  const names = Array.isArray(base.shownOptions) ? new Set(base.shownOptions) : null;
  const out = [];
  for (const g of groups) for (const i of g.inputs) {
    if (seen.has(i.name)) continue;
    seen.add(i.name);
    if (names && !names.has(i.name)) continue;
    out.push({
      name: i.name, title: i.title ?? i.name, value: i.value, default: i.default,
      values: i.values ? i.values.map((v) => (typeof v === "number" ? { value: v, label: String(v) } : { value: v[0], label: v[1] })) : null,
      hint: i.hint ?? null,
    });
  }
  return out;
}

/** Отпечаток результата: контуры, припуски, внутренние линии и надсечки всех деталей (с точностью до 0,01 см). */
function chainSig(ch) {
  if (ch.own.ошибка || ch.elements.some((e) => e.result.ошибка)) return "ERR";
  const pts = (pl) => (pl?.points ?? []).map((q) => q.x.toFixed(2) + "," + q.y.toFixed(2)).join(" ");
  return ch.pieces.map((p) => [p.name, pts(p.outline), pts(p.allowance), (p.inner ?? []).map(pts).join("|"), (p.notches ?? []).map(pts).join("|")].join(";")).join("#");
}

/**
 * Опция показывается покупателю, только если при нынешнем выборе она на что-то влияет:
 * пробуем каждое её значение, и если чертёж не меняется ни при каком, опция сейчас не работает (например, «Ткань» без обтачки или пояса).
 */
function relevantOptionNames(r, list) {
  const base = chainSig(r.ch);
  const keep = new Set();
  for (const o of list) {
    const cur = r.vals[r.base.id][o.name] ?? o.value;
    const alts = o.values ? o.values.map((v) => v.value) : [cur + 1, cur - 1];
    for (const a of alts) {
      if (a === cur) continue;
      const vals = { ...r.vals, [r.base.id]: { ...r.vals[r.base.id], [o.name]: a } };
      let sig;
      try { sig = chainSig(runChain(r.list, r.base, r.M, r.P, vals, r.settings)); } catch { sig = "ERR"; }
      if (sig !== base) { keep.add(o.name); break; }
    }
  }
  return keep;
}

/** Всё, что нужно нарисовать форму: типовые размеры, поля, опции, выбор элементов, текущие значения. */
export function describe(model, sel = {}, resolved = null) {
  const r = resolved ?? resolve(model, sel);
  return {
    id: model.id,
    title: model.shop?.title || model.name,
    figures: STANDARD_FIGURE_GROUPS.map((g) => ({ title: g.title, items: g.figures.map((f) => f.id) })),
    figure: r.figure?.id ?? null,
    height: r.height, bust: r.bust, seam: r.seam,
    measurements: r.shown.measurements.map((k) => ({ key: k, number: MEASUREMENT_INFO[k].number, name: MEASUREMENT_INFO[k].name, value: r.M[k] })),
    eases: r.shown.groups.map((g) => ({ title: g.title, items: g.keys.map((k) => ({ key: k, name: EASE_INFO[k]?.name ?? k, value: r.P[k] })) })),
    easeList: r.eases,
    allowances: r.allowances,
    specs: [...(r.ch.own.specs ?? []), ...r.ch.elements.flatMap((e) => e.result.specs ?? [])].map((x) => ({ name: x.name, title: x.title, value: x.value, unit: x.unit })),
    mode: r.ready ? "ready" : "constructor",
    withAllowance: r.withAllowance,
    options: (() => { const all = optionList(r.ch, r.base); const rel = relevantOptionNames(r, all); return all.filter((o) => rel.has(o.name)); })(),
    // готовое изделие: рукав задан каталогом и покупателем не выбирается, но его рисунок нужен для технического рисунка на странице товара
    fixedElements: model.mode === "ready" ? ELEMENT_ROLES.filter((role) => r.attached[role.kind] && (model.elements?.[role.kind] ?? []).some((e) => e.id === r.attached[role.kind])).map((role) => ({ kind: role.kind, selected: r.attached[role.kind] })) : [],
    elements: model.mode === "ready" ? [] : ELEMENT_ROLES
      .filter((role) => (model.elements?.[role.kind] ?? []).length)
      .map((role) => ({
        kind: role.kind, title: role.title,
        choices: [...((model.requiredElements ?? {})[role.kind] ? [] : [{ id: "", name: NONE_TEXT[role.kind] ?? "нет" }]), ...model.elements[role.kind].map((e) => ({ id: e.id, name: e.name }))],
        selected: r.attached[role.kind] ?? "",
      })),
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Образец чертежа: контуры деталей без размеров и подписей точек, поверх — частый водяной знак. */
/** Всё, что нужно разработчику, чтобы повторить сбой: выбор покупателя и то, что из него получилось после проверки. */
function debugInfo(r, sel, model) {
  return {
    repro: model ? reproText(r, model) : undefined,
    figure: r.figure?.id ?? null, height: r.height, bust: r.bust, seam: r.seam,
    measurements: r.M, easesEMKO: r.P, options: r.vals[r.base.id], attachedElements: r.attached,
    easeValuesApplied: r.settings.easeValues ?? {}, selectionReceived: sel,
  };
}

const rbName = (n) => String(n).replace(/^opt_/, "par_"); // в файлах .rb опции называются par_N, в движке opt_N
const fmtNum = (v) => (typeof v === "number" ? String(Math.round(v * 10000) / 10000) : JSON.stringify(v));

/**
 * Текст для вставки в алгоритм в VS Code: список мерок и список опций (par_N), с которыми получилась ошибка.
 * Строки вида «имя = значение» вставляются в начало .rb-файла (перед «размеры»): мерки и ease_* подхватываются как заданные снаружи,
 * а у par_N с готовой строкой в алгоритме достаточно заменить значение.
 */
export function reproText(r, model) {
  const out = [];
  const f = r.figure;
  out.push(f ? `# Размер: ${f.id} (рост ${f.height}, обхват груди ${f.bust}, обхват бёдер ${f.hips})` : `# Свои мерки: рост ${r.height}, обхват груди ${r.bust}`);
  out.push(`# Алгоритм: ${r.base.name}` + (Object.keys(r.attached).length ? "; элементы: " + Object.entries(r.attached).map(([k, id]) => `${k} ${r.list.find((c) => c.id === id)?.name ?? id}`).join(", ") : "; без элементов"));
  out.push("", "# --- Мерки (rz_N) ---", `rz_1 = ${fmtNum(r.height)}   # Т1 рост`);
  for (const k of MEASUREMENT_ORDER) {
    if (r.M[k] === undefined) continue;
    const n = MEASUREMENT_INFO[k]?.number ?? k.replace(/^rz/, "");
    out.push(`rz_${n} = ${fmtNum(r.M[k])}   # Т${n} ${MEASUREMENT_INFO[k]?.name ?? ""}`.trimEnd());
  }
  const opt = (id) => Object.entries(r.vals[id] ?? {}).filter(([k]) => k !== "seam_allowance");
  const baseOpts = opt(r.base.id);
  out.push("", "# --- Опции (par_N): выбор покупателя ---");
  if (!baseOpts.length) out.push("# (опции не заданы, везде значения по умолчанию из алгоритма)");
  for (const [k, v] of baseOpts) out.push(`${rbName(k)} = ${fmtNum(v)}`);
  for (const c of r.list) {
    if (c.id === r.base.id) continue;
    const o = opt(c.id);
    if (o.length) { out.push("", `# --- Опции элемента ${c.name} ---`); for (const [k, v] of o) out.push(`${rbName(k)} = ${fmtNum(v)}`); }
  }
  const ev = Object.entries(r.settings.easeValues ?? {});
  if (ev.length) { out.push("", "# --- Прибавки (ease_*), выбранные покупателем ---"); for (const [k, v] of ev) out.push(`${k} = ${fmtNum(v)}`); }
  const av = Object.entries(r.settings.allowanceValues ?? {});
  out.push("", "# --- Припуски ---", `# припуск на швы: ${fmtNum(r.seam)} см, ${r.withAllowance ? "с припусками" : "без припусков"}`);
  for (const [k, v] of av) out.push(`${k} = ${fmtNum(v)}`);
  return out.join("\n");
}

/** Выбор покупателя в «чистом» виде: проверенный, со значениями по умолчанию; его можно подать обратно в построение. */
function normalizeSelection(r) {
  const options = { ...r.vals[r.base.id] };
  delete options.seam_allowance;
  const pick = (src, keys) => Object.fromEntries(keys.map((k) => [k, src[k]]));
  return {
    figure: r.figure?.id ?? null, height: r.height, bust: r.bust, seam: r.seam,
    measurements: pick(r.M, r.shown.measurements), eases: pick(r.P, r.shown.eases),
    easeValues: { ...(r.settings.easeValues ?? {}) }, options,
    allowance: r.withAllowance, allowanceValues: { ...(r.settings.allowanceValues ?? {}) },
    // для ролей без выбранного элемента пишем пустую строку: при повторном построении не подключится элемент по умолчанию
    elements: { ...Object.fromEntries(ELEMENT_ROLES.map((x) => [x.kind, ""])), ...r.attached },
  };
}

// ---------------------------------------------------------------- параметры списком «имя = значение»

const TR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "c", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
/** Имя из алгоритма → имя в движке (как у переводчика .rb/.ALG): регистр не важен, пар_N/par_N → opt_N, кириллица → транслит. */
function engineName(n) {
  let r = String(n).toLowerCase().replace(/(^|_)(пар|par)_/g, "$1opt_");
  r = [...r].map((ch) => (ch in TR ? TR[ch] : ch)).join("");
  return r.replace(/[^\w$]/g, "_");
}
const GIRTHS = new Set([13, 14, 15, 16, 17, 18, 19, 20, 45, 46, 47]); // обхваты, которые бывают половинными (как в движке)
const rzNumber = (n) => { const m = /^(?:rz|рз)_?(\d+)$/i.exec(String(n)); return m ? Number(m[1]) : null; };

/** Значение строки: число или формула из чисел, + − * / ^, скобок, мерок rz_N / рз_N и имён, заданных строками выше. */
function evalExpr(src, lookup) {
  const s = String(src).replace(/(\d),(\d)/g, "$1.$2");
  const toks = s.match(/\d+(?:\.\d*)?|\.\d+|[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*|\*\*|[-+*/^()]|\S/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const fail = (m) => { throw new Error(m); };
  const prim = () => {
    const t = toks[i++];
    if (t === undefined) fail("формула не дописана");
    if (t === "(") { const v = add(); if (toks[i++] !== ")") fail("не закрыта скобка"); return v; }
    if (t === "-") return -pow();
    if (t === "+") return pow();
    if (/^[\d.]/.test(t)) return Number(t);
    if (/^[A-Za-zА-Яа-яЁё_]/.test(t)) return lookup(t);
    return fail(`непонятный знак «${t}»`);
  };
  const pow = () => { const b = prim(); if (peek() === "^" || peek() === "**") { i++; return Math.pow(b, pow()); } return b; };
  const mul = () => { let v = pow(); while (peek() === "*" || peek() === "/") { const op = toks[i++]; const r = pow(); v = op === "*" ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (peek() === "+" || peek() === "-") { const op = toks[i++]; const r = mul(); v = op === "+" ? v + r : v - r; } return v; };
  const v = add();
  if (i < toks.length) fail(`лишнее в конце: «${toks.slice(i).join(" ")}»`);
  if (!Number.isFinite(v)) fail("получилось не число");
  return v;
}

/**
 * Список «имя = значение» (как в алгоритме или в письме об ошибке) → выбор покупателя.
 * пар_N / par_N и другие параметры алгоритма → опции; ease_* → прибавки (зажимаются в допустимый диапазон);
 * rz_N / рз_N → мерки (размер становится «Свои мерки», rz_1 — рост). Порядок строк не важен: сначала мерки и опции, потом прибавки,
 * потому что от опций зависит, какие прибавки есть, а формулы прибавок считаются по меркам.
 * Возвращает новый выбор и отчёт по каждой строке.
 */
export function applyPaste(model, sel = {}) {
  const text = String(sel.paste ?? "").slice(0, 20000);
  const next = { ...sel, options: { ...(sel.options ?? {}) }, easeValues: { ...(sel.easeValues ?? {}) } };
  delete next.paste;
  const report = [];
  const lines = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\s(#|\/\/).*$/, "").replace(/^\s*(#|\/\/).*$/, "").trim();
    if (!line) return;
    const m = /^([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)\s*:?=\s*(.+)$/.exec(line);
    if (!m) { report.push({ line: idx + 1, text: raw.trim(), ok: false, note: "не похоже на «имя = значение»" }); return; }
    lines.push({ line: idx + 1, text: raw.trim(), name: m[1], expr: m[2].trim().replace(/;$/, "") });
  });
  const defined = {}; // имена, уже заданные в списке (по engineName) — на них можно ссылаться в формулах ниже
  const rzLines = lines.filter((l) => rzNumber(l.name) !== null);
  const easeLines = lines.filter((l) => rzNumber(l.name) === null && /^ease_/i.test(l.name));
  const optLines = lines.filter((l) => rzNumber(l.name) === null && !/^ease_/i.test(l.name));

  // 1) мерки
  let r = resolve(model, next);
  const keyOf = (n) => Object.keys(MEASUREMENT_INFO).find((k) => MEASUREMENT_INFO[k].number === n);
  // мерка в формуле — то значение, которое видит сам алгоритм (переменная rz_N после его расчёта, в той же форме: полная или половина)
  const measure = (name) => {
    const n = rzNumber(name);
    for (const vars of [r.ch.own.переменные, ...r.ch.elements.map((x) => x.result.переменные)]) {
      for (const [k, v] of Object.entries(vars ?? {})) if ((k.toLowerCase() === `rz_${n}` || k.toLowerCase() === `rz${n}`) && typeof v === "number" && Number.isFinite(v)) return v;
    }
    const height = next.height ?? r.height, bust = next.bust ?? r.bust;
    const given = n === 1 ? height : r.M[`rz${n}`] ?? (n === 16 ? bust : undefined);
    // мерка объявлена в алгоритме как measure("rzN", по_умолчанию[, "half"]) — повторяем то, что сделает построение
    for (const c of r.list) {
      const mm = new RegExp(`measure\\(\\s*"rz${n}"\\s*,\\s*(-?[\\d.]+)\\s*(?:,\\s*"(half)")?`).exec(c.script ?? "");
      if (!mm) continue;
      if (typeof given !== "number") return Number(mm[1]);
      return mm[2] === "half" && GIRTHS.has(n) ? given / 2 : given;
    }
    if (n === 1) return height;
    if (n === 16 && !keyOf(16)) return bust;
    const k = keyOf(n);
    const v = k ? next.measurements?.[k] ?? r.M[k] : undefined;
    if (v === undefined) throw new Error(`мерка ${name} в этой модели не используется`);
    return v;
  };
  const lookup = (name) => {
    if (rzNumber(name) !== null) return measure(name);
    const e = engineName(name);
    if (e in defined) return defined[e];
    throw new Error(`неизвестное имя «${name}» (в формуле можно использовать мерки rz_N и имена, заданные строками выше)`);
  };
  if (rzLines.length) {
    const ms = { ...r.M, ...(next.measurements ?? {}) };
    let height = next.height ?? r.height;
    for (const l of rzLines) {
      try {
        const v = evalExpr(l.expr, lookup);
        const n = rzNumber(l.name);
        if (n === 1) { if (v <= 100 || v >= 230) throw new Error("рост должен быть от 100 до 230"); height = v; }
        else {
          const k = keyOf(n);
          if (!k) throw new Error(`мерки ${l.name} нет в таблице мерок`);
          if (v <= 0 || v >= 400) throw new Error("значение мерки вне 0…400");
          ms[k] = v;
        }
        next.measurements = ms; next.height = height; next.figure = null;
        next.bust ??= r.bust;
        report.push({ line: l.line, text: l.text, ok: true, note: `мерка = ${fmtNum(v)}` });
      } catch (e) { report.push({ line: l.line, text: l.text, ok: false, note: e.message }); }
    }
  }

  // 2) опции и прочие параметры алгоритма (их ищем среди параметров основы и подключённых элементов)
  const inputsOf = (rr) => {
    const m = new Map();
    for (const i of [...rr.ch.own.inputs, ...rr.ch.elements.flatMap((x) => x.result.inputs)]) if (!m.has(i.name.toLowerCase())) m.set(i.name.toLowerCase(), i);
    return m;
  };
  let pending = optLines;
  for (let pass = 0; pass < 3 && pending.length; pass++) { // опция может появиться только после другой опции (рукав → низ рукава)
    r = resolve(model, next);
    const inputs = inputsOf(r);
    const left = [];
    for (const l of pending) {
      const inp = inputs.get(engineName(l.name));
      if (!inp) { left.push(l); continue; }
      try {
        const v = evalExpr(l.expr, lookup);
        if (inp.values && !inp.values.some((x) => (typeof x === "number" ? x : x[0]) === v)) {
          throw new Error(`у «${inp.title ?? inp.name}» нет значения ${fmtNum(v)}; можно: ${inp.values.map((x) => (typeof x === "number" ? x : `${x[0]} (${x[1]})`)).join(", ")}`);
        }
        next.options[inp.name] = v;
        defined[engineName(l.name)] = v;
        report.push({ line: l.line, text: l.text, ok: true, note: inp.title && inp.title !== inp.name ? inp.title : "" });
      } catch (e) { report.push({ line: l.line, text: l.text, ok: false, note: e.message }); }
    }
    if (left.length === pending.length) break;
    pending = left;
  }
  for (const l of pending) report.push({ line: l.line, text: l.text, ok: false, note: "такого параметра нет в этой модели (или он не работает при выбранных опциях)" });

  // 3) прибавки ease_*: формулы — по меркам, значение зажимаем в диапазон
  if (easeLines.length) {
    r = resolve(model, next);
    const byName = new Map(r.eases.map((e) => [e.name.toLowerCase(), e]));
    const all = new Map([...r.ch.own.eases, ...r.ch.elements.flatMap((x) => x.result.eases)].map((e) => [e.name.toLowerCase(), e]));
    for (const l of easeLines) {
      try {
        const v = evalExpr(l.expr, lookup);
        defined[engineName(l.name)] = v;
        const e = byName.get(l.name.toLowerCase());
        if (!e) throw new Error(all.has(l.name.toLowerCase()) ? "эта прибавка на сайте не меняется (у неё нет диапазона)" : "такой прибавки нет в этой модели при выбранных опциях");
        const c = Math.min(e.max, Math.max(e.min, v));
        next.easeValues[e.name] = c;
        report.push({ line: l.line, text: l.text, ok: true, note: c !== v ? `= ${fmtNum(v)}, вне диапазона — взято ${fmtNum(c)} (допустимо ${fmtNum(e.min)}…${fmtNum(e.max)})` : `= ${fmtNum(v)}` });
      } catch (e) { report.push({ line: l.line, text: l.text, ok: false, note: e.message }); }
    }
  }
  report.sort((a, b) => a.line - b.line);
  return { selection: next, report };
}

/** Сообщение об ошибке + строка переведённого скрипта, на которой она случилась (по ней в .rb ищется место: имена переменных те же). */
function errText(label, err, script) {
  let t = `${label}: ${err.message}`;
  if (err.line && typeof script === "string") {
    const src = script.split("\n")[err.line - 1];
    if (src !== undefined) t += ` [строка ${err.line} переведённого скрипта: ${src.trim().slice(0, 160)}]`;
  }
  return t;
}

function buildFailures(r) {
  const failures = [];
  if (r.ch.own.ошибка) failures.push(errText(r.base.name, r.ch.own.ошибка, r.base.script));
  for (const e of r.ch.elements) if (e.result.ошибка) failures.push(errText(`${e.role} «${e.c.name}»`, e.result.ошибка, e.c.script));
  if (!failures.length && !r.ch.pieces.length) failures.push("Построение не дало ни одной детали");
  return failures;
}

/** Проверка выбора при добавлении в корзину: строится ли чертёж, и каким он будет после нормализации. */
export function checkSelection(model, sel = {}) {
  const r = resolve(model, sel);
  const failures = buildFailures(r);
  const ru = (n) => String(n).replace(".", ","); // по-русски: запятая в дробных
  const f = r.figure;
  const parts = [f ? `размер ${f.id}` : `рост ${r.height}, ОГ ${r.bust}, свои мерки`];
  // что покупатель изменил: прибавки со своим значением и опции не по умолчанию — чтобы строки в корзине отличались
  for (const e of r.eases) if (e.value !== null && e.value !== undefined && e.value !== e.default) parts.push(`${e.title} ${ru(e.value)}${e.unit ? " " + e.unit.replace(/^\s*/, "") : ""}`);
  for (const o of optionList(r.ch, r.base)) {
    if (o.default === undefined || o.value === o.default) continue;
    const lab = o.values?.find((v) => v.value === o.value)?.label ?? o.value;
    parts.push(`${o.title}: ${lab}`);
  }
  for (const [kind, id] of Object.entries(r.attached)) {
    const el = (model.elements?.[kind] ?? []).find((x) => x.id === id);
    if (el && r.base.attached?.[kind] !== undefined) parts.push(el.name);
  }
  for (const role of ELEMENT_ROLES) {
    if ((model.elements?.[role.kind] ?? []).length && !r.attached[role.kind] && model.mode !== "ready") parts.push(NONE_TEXT[role.kind] ?? "без элемента");
  }
  const summary = parts.join(", ");
  return {
    error: failures.length ? failures.join("\n") : null,
    selection: normalizeSelection(r), summary, debug: failures.length ? debugInfo(r, sel, model) : undefined,
  };
}

/** Детали, разложенные рядом без наложений — так же, как в образце и в файлах для покупателя. */
function laidOut(raw, maxWidth = 150) {
  const xf = leko.arrangePieces(raw, { allowance: true, maxWidth });
  const keys = leko.pieceKeys(raw);
  return raw.map((pc, i) => { const t = xf[keys[i]]; return t ? leko.shiftPiece(pc, t.dx, t.dy) : pc; });
}

/** Для образца: ширина ряда подбирается так, чтобы детали как можно крупнее поместились в рамку образца (без пустых полей). */
function previewLayout(raw) {
  let best = null;
  for (const w of [45, 60, 80, 100, 125, 150, 190, 240]) {
    const p = laidOut(raw, w);
    const sc = leko.autoFitScale({}, { pieces: p, width: 1000, height: 800, padding: 30 });
    if (!best || sc > best.sc * 1.001) best = { sc, p };
  }
  return best.p;
}

/** Файлы для покупателя после оплаты: полноразмерные лекала с припусками, без водяного знака образца. */
const here = dirname(fileURLToPath(import.meta.url));
let fontCache = null;
/** Шрифт DejaVu Sans для русских надписей в PDF (лежит рядом с сервисом, свободная лицензия). */
function pdfFont() {
  if (fontCache === null) {
    try {
      fontCache = {
        regular: new Uint8Array(readFileSync(join(here, "..", "fonts", "DejaVuSans.ttf"))),
        bold: new Uint8Array(readFileSync(join(here, "..", "fonts", "DejaVuSans-Bold.ttf"))),
        deflate: (b) => new Uint8Array(deflateSync(b)),
      };
    } catch { fontCache = undefined; } // без шрифта надписи в PDF будут латиницей
  }
  return fontCache;
}

export function buildFiles(model, sel = {}, { title = "", stamp = "" } = {}) {
  const r = resolve(model, sel);
  const failures = buildFailures(r);
  if (failures.length) return { error: failures.join("\n"), debug: debugInfo(r, sel, model) };
  const pieces = laidOut(r.ch.pieces);
  const o = { allowance: r.withAllowance, title, stamp, font: pdfFont() };
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const text = (t) => Buffer.from(t, "utf8").toString("base64");
  return {
    error: null,
    files: [
      { kind: "pdfA4", mime: "application/pdf", data: b64(leko.exportPdfA4(pieces, o)) },
      { kind: "pdfA3", mime: "application/pdf", data: b64(leko.exportPdfA3(pieces, o)) },
      { kind: "pdfA0", mime: "application/pdf", data: b64(leko.exportPdfA0(pieces, o)) },
      { kind: "pdf", mime: "application/pdf", data: b64(leko.exportPdf(pieces, o)) },
      { kind: "aama", mime: "application/dxf", data: text(leko.exportDxf(pieces, { ...o, target: "aama" })) },
    ],
  };
}

export function previewSvg(model, sel = {}) {
  const r = resolve(model, sel);
  const form = () => describe(model, sel, r);
  const failures = [];
  if (r.ch.own.ошибка) failures.push(errText(r.base.name, r.ch.own.ошибка, r.base.script));
  for (const e of r.ch.elements) if (e.result.ошибка) failures.push(errText(`${e.role} «${e.c.name}»`, e.result.ошибка, e.c.script));
  const raw = r.ch.pieces;
  if (failures.length || !raw.length) {
    return { error: failures.length ? failures.join("\n") : "Построение не дало ни одной детали", svg: null, describe: form(), debug: debugInfo(r, sel, model) };
  }
  // детали раскладываем рядом, без наложений (в студии они лежат «как на чертеже»)
  const pieces = previewLayout(raw);
  const scale = leko.autoFitScale({}, { pieces, width: 1000, height: 800, padding: 30 });
  let svg = leko.renderScriptSvg({}, {
    pieces, scale, showLabels: false, showPoints: false, showAllowance: r.withAllowance, margin: 0, padding: 30, width: 1, height: 1, // рамка по размеру деталей, а не фиксированная
  });
  svg = svg.replace(/ data-var="[^"]*"/g, "").replace(/ class="sv-item"/g, "").replace(/ style="cursor:pointer"/g, "")
    .replace(/<circle [^>]*\br="(?:14|7)"[^>]*\/>/g, ""); // ручки перетаскивания деталей из студии
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const w = m ? +m[1] : 1000, h = m ? +m[2] : 800;
  const wm = `<defs><pattern id="skwm" width="260" height="170" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">`
    + `<text x="8" y="90" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#b0303a" fill-opacity="0.42">${esc(WATERMARK)}</text></pattern></defs>`
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#skwm)" pointer-events="none"/>`;
  svg = svg.replace("</svg>", wm + "</svg>");
  return { error: null, svg, width: w, height: h, describe: form() };
}


// ---------------------------------------------------------------- самопроверка алгоритмов по базе типовых размеров

const SELFTEST_QUICK_FIGURES = ["164-96-104"];
/** Размеры для быстрой проверки: самый маленький, самый большой, по одному на каждую полнотную группу и стандартный 164-96-104. */
function quickFigureIds() {
  const all = STANDARD_FIGURE_GROUPS.flatMap((g) => g.figures);
  const ids = new Set(SELFTEST_QUICK_FIGURES);
  for (const g of STANDARD_FIGURE_GROUPS) {
    const f = [...g.figures].sort((a, b) => a.bust - b.bust || a.height - b.height);
    if (f.length) { ids.add(f[0].id); ids.add(f[f.length - 1].id); ids.add(f[Math.floor(f.length / 2)].id); }
  }
  return all.filter((f) => ids.has(f.id)).map((f) => f.id);
}

/** Выборы для проверки: «по умолчанию», затем по одной опции и по одному элементу (остальное по умолчанию). */
function selfTestVariants(model, figure) {
  const r0 = resolve(model, { figure });
  const out = [{ label: "по умолчанию", sel: { figure } }];
  const base = r0.base;
  for (const o of optionList(r0.ch, base)) {
    if (!o.values) continue;
    for (const v of o.values) {
      if (v.value === o.default) continue;
      out.push({ label: `${rbName(o.name)}=${v.value}` + (v.label !== String(v.value) ? ` (${v.label})` : ""), sel: { figure, options: { [o.name]: v.value } } });
    }
  }
  if (model.mode !== "ready") {
    for (const role of ELEMENT_ROLES) {
      const els = model.elements?.[role.kind] ?? [];
      for (const e of els) out.push({ label: `${role.title}: ${e.name}`, sel: { figure, elements: { [role.kind]: e.id } } });
      if (els.length && !(model.requiredElements ?? {})[role.kind]) out.push({ label: NONE_TEXT[role.kind] ?? "без элемента", sel: { figure, elements: { [role.kind]: "" } } });
    }
  }
  return out;
}

/**
 * Прогон модели по типовым размерам. mode: «quick» — все варианты на нескольких размерах + вариант по умолчанию на каждом из 147,
 * «full» — все варианты на всех размерах. Одинаковые ошибки сводятся в одну группу с первым примером и текстом для воспроизведения.
 */
export function selfTest(model, { mode = "quick", figures = null, timeMs = 120_000 } = {}) {
  const t0 = Date.now();
  const allIds = STANDARD_FIGURE_GROUPS.flatMap((g) => g.figures.map((f) => f.id));
  const quick = quickFigureIds();
  const figs = figures ?? (mode === "full" ? allIds : allIds);
  const groups = new Map();
  let total = 0, failed = 0, skipped = 0;
  const note = (err, label, figure, sel) => {
    failed++;
    const key = err.split("\n")[0].replace(/\d+([.,]\d+)?/g, "N").slice(0, 200);
    let g = groups.get(key);
    if (!g) {
      let repro = "";
      try { repro = reproText(resolve(model, sel), model); } catch { /* пример не воспроизвёлся */ }
      g = { error: err, count: 0, example: { figure, variant: label, repro }, cases: new Set() };
      groups.set(key, g);
    }
    g.count++;
    if (g.cases.size < 12) g.cases.add(`${figure} · ${label}`);
  };
  for (const figure of figs) {
    if (Date.now() - t0 > timeMs) { skipped++; continue; }
    const full = mode === "full" || quick.includes(figure);
    let variants;
    try { variants = full ? selfTestVariants(model, figure) : [{ label: "по умолчанию", sel: { figure } }]; }
    catch (e) { total++; note("Исключение при подготовке вариантов: " + String(e && e.message || e), "по умолчанию", figure, { figure }); continue; }
    for (const v of variants) {
      total++;
      try {
        const r = resolve(model, v.sel);
        const fl = buildFailures(r);
        if (fl.length) note(fl.join("\n"), v.label, figure, v.sel);
      } catch (e) { note("Исключение: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : String(e)), v.label, figure, v.sel); }
    }
  }
  return {
    model: model.id, name: model.name, title: model.shop?.title || model.name, mode, total, failed, skippedFigures: skipped, ms: Date.now() - t0,
    groups: [...groups.values()].map((g) => ({ ...g, cases: [...g.cases] })).sort((a, b) => b.count - a.count),
  };
}

/** Читаемый отчёт: что сломалось, на каких размерах и вариантах, и текст для вставки в алгоритм. */
export function selfTestText(reports) {
  const out = [];
  const bad = reports.filter((r) => r.failed > 0);
  out.push(`Проверено алгоритмов: ${reports.length}, с ошибками: ${bad.length}. Построений: ${reports.reduce((n, r) => n + r.total, 0)}, неудачных: ${reports.reduce((n, r) => n + r.failed, 0)}.`);
  for (const r of reports) {
    out.push("", "=".repeat(70), `${r.name} (${r.model}) — ${r.title}: ${r.failed ? "ОШИБКИ " + r.failed + " из " + r.total : "всё построилось (" + r.total + " построений)"}${r.skippedFigures ? `; не успели проверить размеров: ${r.skippedFigures}` : ""}`);
    r.groups.forEach((g, i) => {
      out.push("", `--- Ошибка ${i + 1} (повторяется ${g.count} раз) ---`, g.error, "", "Где случилось (размер · вариант):", ...g.cases.map((c) => "  " + c));
      if (g.count > g.cases.length) out.push(`  … и ещё ${g.count - g.cases.length}`);
      out.push("", `Первый пример: размер ${g.example.figure}, вариант «${g.example.variant}». Вставьте в начало алгоритма в VS Code:`, "", g.example.repro);
    });
  }
  return out.join("\n");
}
