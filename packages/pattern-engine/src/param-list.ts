// Параметры списком «имя = значение» — как они записаны в алгоритме или в письме об ошибке:
//   пар_1 = 1            → опция opt_1 (par_N, кириллица, регистр — неважно)
//   facing_b = 1         → любой другой параметр алгоритма (input)
//   ease_chest = rz_16 * 0.01   → прибавка; формула считается по меркам так, как их видит сам алгоритм
//   rz_16 = 96           → мерка (rz_1 — рост)
// Порядок строк не важен: сначала мерки и опции (от опций зависит, какие прибавки есть), потом прибавки.

import type { Chain } from "./chain.js";

export interface ParamListLine { line: number; text: string; ok: boolean; note: string }

export interface ParamListContext {
  /** Построить изделие с этими опциями и прибавками (основа + её элементы). */
  run(options: Record<string, number>, easeValues: Record<string, number>): Chain;
  /** Тексты скриптов основы и элементов: по measure("rzN", …) видно, в каком виде мерку ждёт алгоритм. */
  scripts: string[];
  /** Мерки в виде rzN (как в мастерской), рост и обхват груди. */
  M: Record<string, number>;
  height: number;
  bust: number;
  /** В каком виде лежат обхваты в M. */
  girths: "full" | "half";
  /** Уже выбранные опции и прибавки (список их дополняет). */
  options?: Record<string, number>;
  easeValues?: Record<string, number>;
}

export interface ParamListResult {
  options: Record<string, number>;
  easeValues: Record<string, number>;
  /** Мерки из строк rz_N (ключ rzN), если были. */
  measures: Record<string, number>;
  height: number | null;
  report: ParamListLine[];
}

const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "c", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
/** Имя из алгоритма → имя в движке (как у переводчика .rb/.ALG): регистр не важен, пар_N/par_N → opt_N, кириллица → транслит. */
export function paramEngineName(n: string): string {
  const r = n.toLowerCase().replace(/(^|_)(пар|par)_/g, "$1opt_");
  return [...r].map((ch) => (ch in TR ? TR[ch] : ch)).join("").replace(/[^\w$]/g, "_");
}
const GIRTHS = new Set([13, 14, 15, 16, 17, 18, 19, 20, 45, 46, 47]);
const rzNumber = (n: string): number | null => { const m = /^(?:rz|рз)_?(\d+)$/i.exec(n); return m ? Number(m[1]) : null; };
const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

/** Число или формула: + − * / ^, скобки, имена (их значения даёт lookup). Запятая в числе — как точка. */
export function evalParamExpr(src: string, lookup: (name: string) => number): number {
  const s = src.replace(/(\d),(\d)/g, "$1.$2");
  const toks = s.match(/\d+(?:\.\d*)?|\.\d+|[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*|\*\*|[-+*/^()]|\S/g) ?? [];
  let i = 0;
  const fail = (m: string): never => { throw new Error(m); };
  const prim = (): number => {
    const t = toks[i++];
    if (t === undefined) return fail("формула не дописана");
    if (t === "(") { const v = add(); if (toks[i++] !== ")") fail("не закрыта скобка"); return v; }
    if (t === "-") return -pow();
    if (t === "+") return pow();
    if (/^[\d.]/.test(t)) return Number(t);
    if (/^[A-Za-zА-Яа-яЁё_]/.test(t)) return lookup(t);
    return fail(`непонятный знак «${t}»`);
  };
  const pow = (): number => { const b = prim(); if (toks[i] === "^" || toks[i] === "**") { i++; return Math.pow(b, pow()); } return b; };
  const mul = (): number => { let v = pow(); while (toks[i] === "*" || toks[i] === "/") { const op = toks[i++]; const r = pow(); v = op === "*" ? v * r : v / r; } return v; };
  const add = (): number => { let v = mul(); while (toks[i] === "+" || toks[i] === "-") { const op = toks[i++]; const r = mul(); v = op === "+" ? v + r : v - r; } return v; };
  const v = add();
  if (i < toks.length) fail(`лишнее в конце: «${toks.slice(i).join(" ")}»`);
  if (!Number.isFinite(v)) fail("получилось не число");
  return v;
}

/** Строки «имя = значение» (пустые и заметки # // пропускаются). */
export function splitParamList(text: string): { lines: { line: number; text: string; name: string; expr: string }[]; bad: ParamListLine[] } {
  const lines: { line: number; text: string; name: string; expr: string }[] = [];
  const bad: ParamListLine[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\s(#|\/\/).*$/, "").replace(/^\s*(#|\/\/).*$/, "").trim();
    if (!line) return;
    const m = /^([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)\s*:?=\s*(.+)$/.exec(line);
    if (!m) { bad.push({ line: idx + 1, text: raw.trim(), ok: false, note: "не похоже на «имя = значение»" }); return; }
    lines.push({ line: idx + 1, text: raw.trim(), name: m[1], expr: m[2].trim().replace(/;$/, "") });
  });
  return { lines, bad };
}

export function applyParamList(text: string, ctx: ParamListContext): ParamListResult {
  const { lines, bad } = splitParamList(text);
  const report: ParamListLine[] = [...bad];
  const options: Record<string, number> = { ...(ctx.options ?? {}) };
  const easeValues: Record<string, number> = { ...(ctx.easeValues ?? {}) };
  const measures: Record<string, number> = {};
  let height: number | null = null;
  const defined: Record<string, number> = {};
  let ch = ctx.run(options, easeValues);

  const vars = () => [ch.own.переменные, ...ch.elements.map((x) => x.result.переменные)];
  // мерка в формуле — то значение, которое видит сам алгоритм (полная или половина)
  const measure = (name: string): number => {
    const n = rzNumber(name)!;
    for (const v of vars()) for (const [k, x] of Object.entries(v ?? {})) {
      if ((k.toLowerCase() === `rz_${n}` || k.toLowerCase() === `rz${n}`) && typeof x === "number" && Number.isFinite(x)) return x;
    }
    const h = height ?? ctx.height;
    let given: number | undefined = n === 1 ? h : measures[`rz${n}`] ?? ctx.M[`rz${n}`];
    let have: "full" | "half" = n === 1 || !(`rz${n}` in ctx.M) || `rz${n}` in measures ? "full" : ctx.girths;
    if (given === undefined && n === 16) { given = ctx.bust; have = ctx.girths; }
    for (const s of ctx.scripts) {
      const mm = new RegExp(`measure\\(\\s*"rz${n}"\\s*,\\s*(-?[\\d.]+)\\s*(?:,\\s*"(half)")?`).exec(s);
      if (!mm) continue;
      if (given === undefined) return Number(mm[1]);
      const want = mm[2] === "half" ? "half" : "full";
      return !GIRTHS.has(n) || have === want ? given : have === "full" ? given / 2 : given * 2;
    }
    if (given === undefined) throw new Error(`мерка ${name} в этой модели не используется`);
    return given;
  };
  const lookup = (name: string): number => {
    if (rzNumber(name) !== null) return measure(name);
    const e = paramEngineName(name);
    if (e in defined) return defined[e];
    throw new Error(`неизвестное имя «${name}» (в формуле можно использовать мерки rz_N и имена, заданные строками выше)`);
  };
  const tryLine = (l: { line: number; text: string }, f: () => string) => {
    try { report.push({ line: l.line, text: l.text, ok: true, note: f() }); } catch (e) { report.push({ line: l.line, text: l.text, ok: false, note: e instanceof Error ? e.message : String(e) }); }
  };

  // 1) мерки
  for (const l of lines.filter((x) => rzNumber(x.name) !== null)) tryLine(l, () => {
    const v = evalParamExpr(l.expr, lookup);
    const n = rzNumber(l.name)!;
    if (n === 1) { if (v <= 100 || v >= 230) throw new Error("рост должен быть от 100 до 230"); height = v; }
    else { if (v <= 0 || v >= 400) throw new Error("значение мерки вне 0…400"); measures[`rz${n}`] = v; }
    return `мерка = ${fmt(v)}`;
  });

  // 2) опции и прочие параметры алгоритма; опция может появиться только после другой (рукав → низ рукава), поэтому несколько проходов
  let pending = lines.filter((x) => rzNumber(x.name) === null && !/^ease_/i.test(x.name));
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    ch = ctx.run(options, easeValues);
    const inputs = new Map<string, Chain["own"]["inputs"][number]>();
    for (const i of [...ch.own.inputs, ...ch.elements.flatMap((x) => x.result.inputs)]) if (!inputs.has(i.name.toLowerCase())) inputs.set(i.name.toLowerCase(), i);
    const left: typeof pending = [];
    for (const l of pending) {
      const inp = inputs.get(paramEngineName(l.name));
      if (!inp) { left.push(l); continue; }
      tryLine(l, () => {
        const v = evalParamExpr(l.expr, lookup);
        const vals = inp.values as (number | [number, string])[] | undefined;
        if (vals && !vals.some((x) => (Array.isArray(x) ? x[0] : x) === v)) {
          throw new Error(`у «${inp.title ?? inp.name}» нет значения ${fmt(v)}; можно: ${vals.map((x) => (Array.isArray(x) ? `${x[0]} (${x[1]})` : x)).join(", ")}`);
        }
        options[inp.name] = v;
        defined[paramEngineName(l.name)] = v;
        return inp.title && inp.title !== inp.name ? inp.title : "";
      });
    }
    if (left.length === pending.length) break;
    pending = left;
  }
  for (const l of pending) report.push({ line: l.line, text: l.text, ok: false, note: "такого параметра нет в этой модели (или он не работает при выбранных опциях и элементах)" });

  // 3) прибавки: формулы по меркам, значение — в допустимый диапазон
  const easeLines = lines.filter((x) => rzNumber(x.name) === null && /^ease_/i.test(x.name));
  if (easeLines.length) {
    ch = ctx.run(options, easeValues);
    const all = new Map([...ch.own.eases, ...ch.elements.flatMap((x) => x.result.eases)].map((e) => [e.name.toLowerCase(), e]));
    for (const l of easeLines) tryLine(l, () => {
      const v = evalParamExpr(l.expr, lookup);
      defined[paramEngineName(l.name)] = v;
      const e = all.get(l.name.toLowerCase());
      if (!e) throw new Error("такой прибавки нет в этой модели при выбранных опциях и элементах");
      if (e.min === null || e.max === null || !(e.min < e.max)) throw new Error("у этой прибавки сейчас нет диапазона — её не меняют");
      const c = Math.min(e.max, Math.max(e.min, v));
      easeValues[e.name] = c;
      return c !== v ? `= ${fmt(v)}, вне диапазона — взято ${fmt(c)} (допустимо ${fmt(e.min)}…${fmt(e.max)})` : `= ${fmt(v)}`;
    });
  }
  report.sort((a, b) => a.line - b.line);
  return { options, easeValues, measures, height, report };
}
