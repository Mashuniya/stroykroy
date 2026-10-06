/**
 * Редактор «Шаги»: скрипт — это обычный JS-текст, а здесь он показывается строками-шагами.
 * Шаг = один оператор верхнего уровня. Разбор не меняет текст: у каждого шага запоминается
 * диапазон [start, end) в исходнике, и при правке поля заменяется только он — остальной
 * текст (комментарии, пустые строки, форматирование) остаётся как был.
 */

export interface ParamMeta {
  label: string;
  def: string;
  /** point/line — подставляются последние построенные точки/линии; num — число/формула; list — перечисление. */
  kind?: "point" | "line" | "num" | "list";
  optional?: boolean;
}
export interface OpMeta {
  /** Название на русском (как в Leko). */
  ru: string;
  params: ParamMeta[];
  /** Приставка имени новой переменной: t — точка, d — дуга, s — сплайн… */
  varBase: string;
  varSuffix?: string;
  variadic?: boolean;
}

const P = (label: string, def = "0", kind: ParamMeta["kind"] = "num", optional = false): ParamMeta => ({ label, def, kind, optional });
const PT = (label: string) => P(label, "t1", "point");
const LN = (label: string) => P(label, "line", "line");

export const OPS_META: Record<string, OpMeta> = {
  point: { ru: "Точка", varBase: "t", params: [P("X (вправо), см"), P("Y (вниз), см")] },
  layOff: { ru: "Отложить", varBase: "t", params: [PT("от точки"), P("угол, °"), P("расстояние, см")] },
  layOffAlong: { ru: "Отложить вдоль линии", varBase: "t", params: [LN("линия"), P("расстояние, см")] },
  intersect: { ru: "Пересечение линий", varBase: "t", params: [LN("линия 1"), LN("линия 2")] },
  intersectDirections: { ru: "Пересечение направлений", varBase: "t", params: [PT("точка 1"), P("угол 1, °"), PT("точка 2"), P("угол 2, °")] },
  intersectCircles: { ru: "Пересечение дуг", varBase: "t", params: [PT("центр 1"), P("радиус 1, см"), PT("центр 2"), P("радиус 2, см"), P("сторона: 1 или -1", "1")] },
  intersectCircleDirection: { ru: "Пересечение дуги и направления", varBase: "t", params: [PT("центр"), P("радиус, см"), PT("точка направления"), P("угол, °"), P("сторона: 1 или -1", "1")] },
  segment: { ru: "Отрезок", varBase: "seg", params: [PT("от точки"), PT("до точки")] },
  dist: { ru: "Расстояние", varBase: "len", params: [PT("от точки"), PT("до точки")] },
  arc: { ru: "Дуга", varBase: "d", params: [PT("центр"), P("радиус, см"), P("начальный угол, °"), P("конечный угол, °", "90")] },
  filletArc: { ru: "Сопряжение дугой", varBase: "d", params: [PT("точка 1"), P("угол 1, °"), PT("точка 2"), P("угол 2, °"), P("радиус, см", "5")] },
  splineK: { ru: "Сплайн", varBase: "s", params: [PT("от точки"), PT("до точки"), P("касательная в начале, °"), P("касательная в конце, °", "90"), P("кривизна k", "0.4"), P("число точек (необяз.)", "", "num", true)] },
  splineKK: { ru: "Сплайн с асимметрией", varBase: "s", params: [PT("от точки"), PT("до точки"), P("касательная в начале, °"), P("касательная в конце, °", "90"), P("кривизна k", "0.4"), P("асимметрия k2", "1"), P("число точек (необяз.)", "", "num", true)] },
  polyline: { ru: "Ломаная", varBase: "pl", variadic: true, params: [P("точки и линии через запятую", "t1, t2", "list")] },
  reverseLine: { ru: "Развернуть линию", varBase: "rev", params: [LN("линия")] },
  angleAt: { ru: "Угол при вершине", varBase: "ang", params: [PT("точка A"), PT("вершина B"), PT("точка C")] },
  label: { ru: "Метка", varBase: "lbl", params: [PT("центр"), P("тип 1-8", "2"), P("угол, °"), P("длина, см", "2"), P("ширина, см", "1")] },
};

// ---------------------------------------------------------------- разбор

export type Row =
  | { kind: "note"; start: number; end: number; text: string }
  | { kind: "op"; start: number; end: number; decl: string; name: string; op: string; args: string[]; comment: string }
  | { kind: "formula"; start: number; end: number; decl: string; name: string; expr: string; comment: string }
  | { kind: "code"; start: number; end: number; text: string };

function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") { j += 2; continue; }
    if (src[j] === q) return j + 1;
    if (q !== "`" && src[j] === "\n") return j; // незакрытая строка не должна съесть весь файл
    j++;
  }
  return src.length;
}

/** Границы операторов верхнего уровня: комментарии (подряд идущие строки — один), операторы до ";" и блоки {…}. */
export function splitStatements(src: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++;
    if (i >= n) break;
    const start = i;
    if (src.startsWith("//", i)) {
      let end = src.indexOf("\n", i); if (end < 0) end = n;
      for (;;) {
        let k = end + 1;
        while (k < n && (src[k] === " " || src[k] === "\t")) k++;
        if (end < n && src.startsWith("//", k)) { const e2 = src.indexOf("\n", k); end = e2 < 0 ? n : e2; } else break;
      }
      out.push({ start, end });
      i = end;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      out.push({ start, end }); i = end; continue;
    }
    const block = /^(function|if|else|for|while|do|try|switch|class)\b/.test(src.slice(i, i + 9));
    let depth = 0, j = i, end = n;
    while (j < n) {
      const c = src[j];
      if (c === "/" && src[j + 1] === "/") { const e = src.indexOf("\n", j); j = e < 0 ? n : e; continue; }
      if (c === "/" && src[j + 1] === "*") { const e = src.indexOf("*/", j + 2); j = e < 0 ? n : e + 2; continue; }
      if (c === '"' || c === "'" || c === "`") { j = skipString(src, j); continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0 && c === "}" && block) {
          const m = /^\s*(else|catch|finally)\b/.exec(src.slice(j + 1, j + 30));
          if (!m) { end = j + 1; break; }
        }
      } else if (c === ";" && depth === 0) { end = j + 1; break; }
      j++;
    }
    // комментарий в конце той же строки относится к этому оператору
    let k = end;
    while (k < n && (src[k] === " " || src[k] === "\t")) k++;
    if (src.startsWith("//", k)) { const e = src.indexOf("\n", k); end = e < 0 ? n : e; }
    out.push({ start, end });
    i = end;
  }
  return out;
}

/** Делит s по sep на верхнем уровне (вне скобок и строк). */
export function splitTopLevel(s: string, sep = ","): string[] {
  const parts: string[] = [];
  let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === sep && depth === 0) { parts.push(s.slice(last, i).trim()); last = i + 1; }
  }
  parts.push(s.slice(last).trim());
  return parts;
}

function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Отделяет «хвостовой» комментарий // …, если он стоит вне строк. */
export function splitComment(text: string): { code: string; comment: string } {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(text, i) - 1; continue; }
    if (c === "/" && text[i + 1] === "/") return { code: text.slice(0, i).trimEnd(), comment: text.slice(i + 2).trim() };
  }
  return { code: text.trimEnd(), comment: "" };
}

const DECL = /^(const|let|var)\s+([A-Za-z_$А-Яа-яЁё][\w$А-Яа-яЁё]*)\s*=\s*([\s\S]+);$/;

export function parseSteps(src: string): Row[] {
  const rows: Row[] = [];
  for (const { start, end } of splitStatements(src)) {
    const text = src.slice(start, end);
    if (text.startsWith("//")) {
      rows.push({ kind: "note", start, end, text: text.split("\n").map((l) => l.trim().replace(/^\/\/ ?/, "")).join("\n") });
      continue;
    }
    if (text.startsWith("/*")) { rows.push({ kind: "code", start, end, text }); continue; }
    const { code, comment } = splitComment(text);
    const m = !code.includes("\n") ? DECL.exec(code) : null;
    if (!m) { rows.push({ kind: "code", start, end, text }); continue; }
    const [, decl, name, exprRaw] = m;
    const expr = exprRaw.trim();
    const call = /^([A-Za-z_]\w*)\(/.exec(expr);
    if (call && OPS_META[call[1]] && matchingParen(expr, call[0].length - 1) === expr.length - 1) {
      const meta = OPS_META[call[1]];
      const inner = expr.slice(call[0].length, -1);
      const args = inner.trim() === "" ? [] : splitTopLevel(inner);
      const required = meta.params.filter((p) => !p.optional).length;
      const okCount = meta.variadic ? true : args.length >= required && args.length <= meta.params.length;
      if (okCount) {
        rows.push({ kind: "op", start, end, decl, name, op: call[1], args: meta.variadic ? [args.join(", ")] : args, comment });
        continue;
      }
    }
    rows.push({ kind: "formula", start, end, decl, name, expr, comment });
  }
  return rows;
}

// ---------------------------------------------------------------- сборка

export function opArgsText(op: string, args: string[]): string {
  const meta = OPS_META[op];
  const raw = args.map((x) => x.trim());
  if (!meta) return raw.join(", ");
  if (meta.variadic) return raw[0] ? raw[0] : meta.params[0].def;
  let n = raw.length;
  while (n > 0 && meta.params[n - 1]?.optional && raw[n - 1] === "") n--; // пустые необязательные хвостовые аргументы не пишем
  return raw.slice(0, n).map((x, i) => (x === "" ? meta.params[i]?.def || "0" : x)).join(", "); // пустое обязательное поле → значение по умолчанию, чтобы скрипт не ломался
}

export function rowText(r: Row): string {
  const tail = (c: string) => (c.trim() ? ` // ${c.trim()}` : "");
  switch (r.kind) {
    case "note": return r.text.split("\n").map((l) => (l.trim() === "" ? "//" : `// ${l}`)).join("\n");
    case "op": return `${r.decl} ${r.name} = ${r.op}(${opArgsText(r.op, r.args)});${tail(r.comment)}`;
    case "formula": return `${r.decl} ${r.name} = ${r.expr.trim() === "" ? "0" : r.expr.trim()};${tail(r.comment)}`;
    case "code": return r.text;
  }
}

export function replaceRow(src: string, r: Row, newText: string): string {
  return src.slice(0, r.start) + newText + src.slice(r.end);
}

export function deleteRow(src: string, r: Row): string {
  let a = r.start, b = r.end;
  if (src[b] === "\n") b++; else if (a > 0 && src[a - 1] === "\n") a--;
  return src.slice(0, a) + src.slice(b);
}

/** Вставляет оператор на новой строке после позиции pos (или в конец). Возвращает новый текст и начало вставленного. */
export function insertStatement(src: string, pos: number | null, stmt: string): { src: string; start: number } {
  const at = pos === null || pos > src.length ? src.length : pos;
  const before = src.slice(0, at);
  const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const out = before + lead + stmt + (src.slice(at).startsWith("\n") || at === src.length ? "" : "\n") + src.slice(at);
  const start = before.length + lead.length;
  return { src: at === src.length && !out.endsWith("\n") ? out + "\n" : out, start };
}

/** Вставляет оператор строкой ПЕРЕД шагом, который начинается в позиции start. */
export function insertBefore(src: string, start: number, stmt: string): { src: string; start: number } {
  return { src: src.slice(0, start) + stmt + "\n" + src.slice(start), start };
}

/** Свободное имя переменной вида base+номер(+суффикс), которого ещё нет в тексте. */
export function freeVarName(base: string, script: string, suffix = ""): string {
  let n = 1;
  while (new RegExp(`\\b${base}${n}${suffix}\\b`).test(script)) n++;
  return `${base}${n}${suffix}`;
}

/** Значения по умолчанию для новой строки: точки — последние построенные, линии — последняя линия. */
export function defaultArgs(op: string, rows: Row[]): string[] {
  const meta = OPS_META[op];
  const pts: string[] = [], lines: string[] = [];
  for (const r of rows) {
    if (r.kind !== "op") continue;
    const base = OPS_META[r.op]?.varBase;
    if (base === "t") pts.push(r.name);
    else if (base === "seg" || base === "d" || base === "s" || base === "pl" || base === "rev") lines.push(r.name);
  }
  const needPts = meta.params.filter((p) => p.kind === "point").length;
  const usePts = pts.slice(-needPts);
  let pi = 0;
  return meta.params.map((p) => {
    if (p.kind === "point") return usePts[pi++ - (needPts - usePts.length)] ?? p.def;
    if (p.kind === "line") return lines[lines.length - 1] ?? p.def;
    return p.optional ? "" : p.def;
  });
}

export function newOpStatement(op: string, name: string, args: string[]): string {
  return rowText({ kind: "op", start: 0, end: 0, decl: "const", name, op, args, comment: "" });
}

// ---------------------------------------------------------------- проверка полей

/** Имя переменной: буквы (в т.ч. русские), цифры, _ и $; не с цифры. */
export function isIdent(s: string): boolean {
  return /^[A-Za-z_$А-Яа-яЁё][\w$А-Яа-яЁё]*$/.test(s);
}

/** Скобки и кавычки закрыты и нигде не «уходят в минус». */
export function isBalanced(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      const j = skipString(s, i);
      if (j > s.length || s[j - 1] !== c || j - 1 === i) return false; // строка не закрыта
      i = j - 1; continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/**
 * Можно ли записать значение поля в код, не сломав разбор на шаги: скобки закрыты, нет перевода строки,
 * нет «;» и «//» вне скобок/строк и (если запятая не разрешена) нет запятой на верхнем уровне.
 * Недописанное остаётся в поле и в код не попадает — поэтому строка не пропадает и фокус не теряется.
 */
export function isSafeField(v: string, allowComma: boolean): boolean {
  if (v.includes("\n")) return false;
  if (!isBalanced(v)) return false;
  if (splitTopLevel(v, ";").length > 1) return false;
  if (splitComment(v).comment !== "" || v.trim().startsWith("//")) return false;
  if (!allowComma && splitTopLevel(v, ",").length > 1) return false;
  return true;
}
