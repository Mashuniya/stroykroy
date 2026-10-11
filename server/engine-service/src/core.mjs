// Ядро конфигуратора: по файлу модели и выбору покупателя строит чертёж-образец.
// Скрипты построения никогда не покидают сервер: наружу уходят только поля формы и картинка с водяным знаком.
import {
  leko, runChain, ELEMENT_ROLES, STANDARD_FIGURE_GROUPS, getStandardFigure,
  MEASUREMENT_INFO, MEASUREMENT_ORDER, EASE_INFO, USER_EASE_GROUPS,
  DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES,
} from "../../../packages/pattern-engine/dist/index.js";

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
    if (id !== undefined && (model.elements?.[r.kind] ?? []).some((e) => e.id === id)) attached[r.kind] = id;
  }
  base.attached = attached;

  const seam = num(sel.seam, 0, 6) ?? 1;
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
  const easesNow = collect(ch);
  const eases = [...easesNow.values()].filter(hasRange).map((e) => ({
    name: e.name, title: e.title, unit: e.unit ?? "", min: e.min, max: e.max,
    pattern: e.pattern, default: easesAuto.get(e.name)?.default ?? null, value: e.set ? e.value : null,
  }));
  return { list, base, M, P, vals, settings, ch, shown, figure, height, bust, seam, attached, eases };
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
    options: optionList(r.ch, r.base),
    elements: model.mode === "ready" ? [] : ELEMENT_ROLES
      .filter((role) => (model.elements?.[role.kind] ?? []).length)
      .map((role) => ({
        kind: role.kind, title: role.title,
        choices: model.elements[role.kind].map((e) => ({ id: e.id, name: e.name })),
        selected: r.attached[role.kind] ?? "",
      })),
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Образец чертежа: контуры деталей без размеров и подписей точек, поверх — частый водяной знак. */
/** Всё, что нужно разработчику, чтобы повторить сбой: выбор покупателя и то, что из него получилось после проверки. */
function debugInfo(r, sel) {
  return {
    figure: r.figure?.id ?? null, height: r.height, bust: r.bust, seam: r.seam,
    measurements: r.M, easesEMKO: r.P, options: r.vals[r.base.id], attachedElements: r.attached,
    easeValuesApplied: r.settings.easeValues ?? {}, selectionReceived: sel,
  };
}

export function previewSvg(model, sel = {}) {
  const r = resolve(model, sel);
  const form = () => describe(model, sel, r);
  const failures = [];
  if (r.ch.own.ошибка) failures.push(`${r.base.name}: ${r.ch.own.ошибка.message}`);
  for (const e of r.ch.elements) if (e.result.ошибка) failures.push(`${e.role} «${e.c.name}»: ${e.result.ошибка.message}`);
  const raw = r.ch.pieces;
  if (failures.length || !raw.length) {
    return { error: failures.length ? failures.join("\n") : "Построение не дало ни одной детали", svg: null, describe: form(), debug: debugInfo(r, sel) };
  }
  // детали раскладываем рядом, без наложений (в студии они лежат «как на чертеже»)
  const xf = leko.arrangePieces(raw, { allowance: true });
  const keys = leko.pieceKeys(raw);
  const pieces = raw.map((pc, i) => { const t = xf[keys[i]]; return t ? leko.shiftPiece(pc, t.dx, t.dy) : pc; });
  const scale = leko.autoFitScale({}, { pieces, width: 1000, height: 800, padding: 30 });
  let svg = leko.renderScriptSvg({}, {
    pieces, scale, showLabels: false, showPoints: false, showAllowance: true, margin: 0, padding: 30,
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
