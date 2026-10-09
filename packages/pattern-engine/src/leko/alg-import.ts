import * as ops from "./ops.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104 } from "../types.js";

/**
 * Переводчик файлов .ALG (язык Leko) в наш язык построений: JavaScript с английскими именами операторов.
 *
 * Что делает:
 *  • операторы: точка → point, отрезок → segment, ломаная → polyline, отложить → layOff, отложить_в → layOffAlong, пересечение_н → intersectDirections,
 *    пересечение_д → intersectCircles, пересечение_дн → intersectCircleDirection, разделить → split, разделить_н → splitByDirection,
 *    симметрия_л → mirror, перенос → translate, поворот → rotate, сплайн_к/сплайн_кк/сплайн_д → lekoSplineK/lekoSplineKK/lekoSplineLength (кривизна пересчитана: k=1 — дуга окружности, как в Leko),
 *    метка → label, л_фнк → sizeFn, существует → exists, нарисовать_текст → drawText, ЗАПИСАТЬ → writePiece и т.д.;
 *  • у Leko результат процедурных операторов пишется в переменную-аргумент — здесь это обычное присваивание;
 *  • [а:б].л / .ф1 / .ф2 → seg(а,б).length / .angle1 / .angle2; .х/.у → .x/.y; .к → .k (кривизна сплайна);
 *  • условия «если … то … иначе_если … иначе … конец_если» → if / else if / else; «или»/«и» → ||/&&;
 *  • переменные, которые в Leko приходили снаружи (пар_16, рз_1, вид…), становятся входными параметрами input("имя", значение);
 *    необязательные (проверяются через существует) остаются не заданными — как в Leko;
 *  • комментарии { … } сохраняются как // …; имена переменных (в том числе по-русски) не меняются.
 * Чего не переносит (предупреждает): усадка, прибавка_т (коды уголков), кд в ЗАПИСАТЬ; неизвестные операторы.
 */

export interface AlgInput { name: string; default: number; note: string }
export interface AlgImportResult {
  script: string;
  warnings: string[];
  inputs: AlgInput[];
  stats: { statements: number; variables: number; pieces: number };
}

// ====================================================================== лексер

interface Tok { t: "num" | "str" | "id" | "p" | "eof"; v: string; pos: number; comments: string[] }

const isLetter = (c: string) => /[\p{L}_]/u.test(c);
const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c);

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0, pending: string[] = [];
  const n = src.length;
  const push = (t: Tok["t"], v: string, pos: number) => { toks.push({ t, v, pos, comments: pending }); pending = []; };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") { // комментарий (вложенные скобки допускаются)
      let d = 1, j = i + 1;
      while (j < n && d > 0) { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; }
      const text = src.slice(i + 1, j - 1).replace(/\s+/g, " ").trim();
      if (text) pending.push(text);
      i = j; continue;
    }
    if (c === '"') { let j = i + 1; while (j < n && src[j] !== '"') j++; push("str", src.slice(i + 1, j), i); i = j + 1; continue; }
    const prev = toks[toks.length - 1];
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? "") && !(prev && (prev.t === "id" || prev.v === ")" || prev.v === "]")))) {
      let j = i; while (j < n && /\d/.test(src[j])) j++;
      if (src[j] === "." && /\d/.test(src[j + 1] ?? "")) { j++; while (j < n && /\d/.test(src[j])) j++; }
      push("num", src.slice(i, j), i); i = j; continue;
    }
    if (isLetter(c)) { let j = i; while (j < n && isWord(src[j])) j++; push("id", src.slice(i, j), i); i = j; continue; }
    if (c === ":" && src[i + 1] === "=") { push("p", ":=", i); i += 2; continue; }
    if ("+-*/()[],;:.=<>".includes(c)) { push("p", c, i); i++; continue; }
    i++; // неизвестный символ пропускаем
  }
  push("eof", "", n);
  return toks;
}

// ====================================================================== разбор

type Expr =
  | { k: "num"; v: string }
  | { k: "str"; v: string }
  | { k: "id"; name: string }
  | { k: "call"; name: string; bracket?: string; args: Expr[] }
  | { k: "seg"; a: Expr; b: Expr }
  | { k: "prop"; obj: Expr; prop: string }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "un"; op: string; x: Expr }
  | { k: "paren"; items: Expr[] }
  | { k: "named"; name: string; value: Expr };

type Stmt =
  | { k: "assign"; name: string; expr: Expr; comments: string[] }
  | { k: "call"; call: Extract<Expr, { k: "call" }>; comments: string[] }
  | { k: "if"; branches: { cond: Expr; body: Stmt[] }[]; els: Stmt[] | null; comments: string[] }
  | { k: "command"; name: string; comments: string[] };

class Parser {
  i = 0;
  warnings: string[];
  constructor(private toks: Tok[], warnings: string[]) { this.warnings = warnings; }
  get cur() { return this.toks[this.i]; }
  peek(o = 1) { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  is(v: string) { return this.cur.t === "p" && this.cur.v === v; }
  isKw(v: string) { return this.cur.t === "id" && this.cur.v.toLowerCase() === v; }
  next() { return this.toks[this.i++]; }
  expect(v: string) {
    if (this.cur.v !== v) throw new Error(`ожидалось «${v}», найдено «${this.cur.v || "конец файла"}»${this.where()}`);
    this.i++;
  }
  where() { return ` (символ ${this.cur.pos})`; }

  parseProgram(): Stmt[] { return this.parseStatements([]); }

  parseStatements(stop: string[]): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      while (this.is(";")) this.i++;
      const c = this.cur;
      if (c.t === "eof") break;
      if (c.t === "id" && stop.includes(c.v.toLowerCase())) break;
      const comments = c.comments;
      try {
        if (this.isKw("если")) { out.push(this.parseIf(comments)); continue; }
        if (c.t === "id" && this.peek().v === ":=" && this.peek().t === "p") {
          const name = this.next().v; this.i++;
          out.push({ k: "assign", name, expr: this.parseExpr(), comments });
          continue;
        }
        if (c.t === "id" && (this.peek().v === "(" || (this.peek().v === "[" && this.peek(2).t === "num" && this.peek(3).v === "]" && this.peek(4).v === "("))) {
          const e = this.parseExpr();
          if (e.k !== "call") throw new Error("ожидался вызов оператора" + this.where());
          out.push({ k: "call", call: e, comments });
          continue;
        }
        if (c.t === "id") { this.i++; out.push({ k: "command", name: c.v, comments }); continue; }
        throw new Error(`неожиданный символ «${c.v}»${this.where()}`);
      } catch (e) {
        this.warnings.push(`Разбор: ${(e as Error).message} — оператор пропущен.`);
        // пропускаем до ближайшей «;»
        while (this.cur.t !== "eof" && !this.is(";")) this.i++;
      }
    }
    return out;
  }

  parseIf(comments: string[]): Stmt {
    this.i++; // если
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    let els: Stmt[] | null = null;
    let cond = this.parseExpr();
    if (!this.isKw("то")) throw new Error("после условия ожидалось «то»" + this.where());
    this.i++;
    branches.push({ cond, body: this.parseStatements(["иначе", "иначе_если", "конец_если"]) });
    for (;;) {
      if (this.isKw("иначе_если")) {
        this.i++; cond = this.parseExpr();
        if (!this.isKw("то")) throw new Error("после условия ожидалось «то»" + this.where());
        this.i++;
        branches.push({ cond, body: this.parseStatements(["иначе", "иначе_если", "конец_если"]) });
      } else if (this.isKw("иначе")) {
        this.i++; els = this.parseStatements(["конец_если"]);
      } else break;
    }
    if (!this.isKw("конец_если")) throw new Error("не найдено «конец_если»" + this.where());
    this.i++;
    return { k: "if", branches, els, comments };
  }

  // приоритеты: или < и < не < сравнения(нет) < + - < * / < унарный минус < постфикс
  parseExpr(): Expr { return this.parseOr(); }
  parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isKw("или")) { this.i++; l = { k: "bin", op: "||", l, r: this.parseAnd() }; }
    return l;
  }
  parseAnd(): Expr {
    let l = this.parseNot();
    while (this.isKw("и")) { this.i++; l = { k: "bin", op: "&&", l, r: this.parseNot() }; }
    return l;
  }
  parseNot(): Expr {
    if (this.isKw("не")) { this.i++; return { k: "un", op: "!", x: this.parseNot() }; }
    return this.parseCmp();
  }
  parseCmp(): Expr {
    let l = this.parseAdd();
    while (this.cur.t === "p" && (this.cur.v === "<" || this.cur.v === ">")) {
      const op = this.next().v; l = { k: "bin", op, l, r: this.parseAdd() };
    }
    return l;
  }
  parseAdd(): Expr {
    let l = this.parseMul();
    while (this.cur.t === "p" && (this.cur.v === "+" || this.cur.v === "-")) { const op = this.next().v; l = { k: "bin", op, l, r: this.parseMul() }; }
    return l;
  }
  parseMul(): Expr {
    let l = this.parseUnary();
    while (this.cur.t === "p" && (this.cur.v === "*" || this.cur.v === "/")) { const op = this.next().v; l = { k: "bin", op, l, r: this.parseUnary() }; }
    return l;
  }
  parseUnary(): Expr {
    if (this.cur.t === "p" && (this.cur.v === "-" || this.cur.v === "+")) { const op = this.next().v; return { k: "un", op, x: this.parseUnary() }; }
    return this.parsePostfix();
  }
  parsePostfix(): Expr {
    let e = this.parsePrimary();
    while (this.is(".") && this.peek().t === "id") { this.i++; e = { k: "prop", obj: e, prop: this.next().v }; }
    return e;
  }
  parseArgs(): Expr[] {
    const args: Expr[] = [];
    this.expect("(");
    if (!this.is(")")) {
      for (;;) {
        if (this.cur.t === "id" && this.peek().t === "p" && this.peek().v === "=") { // именованный параметр (ЗАПИСАТЬ)
          const name = this.next().v; this.i++;
          args.push({ k: "named", name, value: this.parseExpr() });
        } else args.push(this.parseExpr());
        if (this.is(",")) { this.i++; continue; }
        break;
      }
    }
    this.expect(")");
    return args;
  }
  parsePrimary(): Expr {
    const c = this.cur;
    if (c.t === "num") { this.i++; return { k: "num", v: c.v.startsWith(".") ? "0" + c.v : c.v }; }
    if (c.t === "str") { this.i++; return { k: "str", v: c.v }; }
    if (c.t === "p" && c.v === "(") {
      this.i++;
      const items: Expr[] = [];
      if (!this.is(")")) for (;;) { items.push(this.parseExpr()); if (this.is(",")) { this.i++; continue; } break; }
      this.expect(")");
      return { k: "paren", items };
    }
    if (c.t === "p" && c.v === "[") { // [а:б] — отрезок между точками
      this.i++; const a = this.parseExpr(); this.expect(":"); const b = this.parseExpr(); this.expect("]");
      return { k: "seg", a, b };
    }
    if (c.t === "id") {
      this.i++;
      if (this.is("(")) return { k: "call", name: c.v, args: this.parseArgs() };
      if (this.is("[") && this.peek().t === "num" && this.peek(2).v === "]" && this.peek(3).v === "(") {
        this.i++; const bracket = this.next().v; this.i++;
        return { k: "call", name: c.v, bracket, args: this.parseArgs() };
      }
      return { k: "id", name: c.v };
    }
    throw new Error(`в выражении неожиданный символ «${c.v || "конец файла"}»${this.where()}`);
  }
}

// ====================================================================== анализ: что приходит «снаружи»

/** Операторы с результатом в аргументе: [индексы аргументов-результатов]. */
const OUT_ARGS: Record<string, number[]> = {
  "пересечение_н": [4], "пересечение_д": [5], "пересечение_дн": [5], "пересечение": [2],
  "разделить": [2, 3, 4], "разделить_н": [3, 4, 5], "отложить_в": [2],
};
const LIST_OPS = new Set(["симметрия_л", "перенос", "поворот", "симметрия_т"]);

interface Analysis {
  inline: Set<string>;       // объявляются на месте первого присваивания на верхнем уровне
  hoist: Set<string>;        // объявляются заранее (let имя;)
  inputs: Set<string>;       // приходят снаружи (input)
  optional: Set<string>;     // проверяются существует() — остаются не заданными
  eqConsts: Map<string, number[]>;
  tableKeys: Map<string, number[]>;
  assignedConst: Map<string, number>; // имя → числовая константа, присвоенная в блоке по условию на необязательный флаг («мастерская»)
  halfInputs: Set<string>;   // мерка, которая сразу удваивается (рз_16 := рз_16*2): снаружи приходит половина
  readFirst: Set<string>;    // мерки, прочитанные раньше первого присваивания — приходят снаружи
  optDefaults: Map<string, number>;   // «если существует(X) то иначе X := c» — входной параметр X со значением c
  allNames: Set<string>;
}

function constNumber(e: Expr): number | null {
  if (e.k === "num") return Number(e.v);
  if (e.k === "un" && e.op === "-" && e.x.k === "num") return -Number(e.x.v);
  return null;
}

/** Куда записать результат симметрии/переноса/поворота: имена в тех же позициях, что и объекты (null — у объекта нет имени). */
function suffixTargets(call: Extract<Expr, { k: "call" }>, warnings: string[]): (string | null)[] {
  const items = call.args[0]?.k === "paren" ? (call.args[0] as Extract<Expr, { k: "paren" }>).items : call.args[0] ? [call.args[0]] : [];
  const names = items.map((it) => (it.k === "id" ? it.name : null));
  const third = call.name === "поворот" ? call.args[3] : call.args[2];
  if (!third || third.k === "str") {
    const suf = third && third.k === "str" ? third.v : "";
    return names.map((nm) => (nm === null ? null : nm + suf));
  }
  if (third.k === "paren" || third.k === "id") {
    const li = third.k === "paren" ? third.items : [third];
    if (li.length !== names.length) warnings.push(`«${call.name}»: список результатов (${li.length}) не совпадает со списком объектов (${names.length}).`);
    return names.map((_, i) => (li[i]?.k === "id" ? (li[i] as { name: string }).name : null));
  }
  return names;
}

function walkE(e: Expr, f: (e: Expr) => void) {
  f(e);
  switch (e.k) {
    case "call": e.args.forEach((x) => walkE(x, f)); break;
    case "seg": walkE(e.a, f); walkE(e.b, f); break;
    case "prop": walkE(e.obj, f); break;
    case "bin": walkE(e.l, f); walkE(e.r, f); break;
    case "un": walkE(e.x, f); break;
    case "paren": e.items.forEach((x) => walkE(x, f)); break;
    case "named": walkE(e.value, f); break;
  }
}
function walkS(ss: Stmt[], f: (s: Stmt) => void) { for (const s of ss) { f(s); if (s.k === "if") { s.branches.forEach((b) => walkS(b.body, f)); if (s.els) walkS(s.els, f); } } }

function analyse(prog: Stmt[]): Analysis {
  const a: Analysis = { inline: new Set(), hoist: new Set(), inputs: new Set(), optional: new Set(), eqConsts: new Map(), tableKeys: new Map(), assignedConst: new Map(), allNames: new Set(), optDefaults: new Map(), halfInputs: new Set(), readFirst: new Set() };

  // ---- проход 1: необязательные (существует), шаблон «если существует(X) то иначе X:=c», значения из сравнений и таблиц
  walkS(prog, (s) => {
    const exprs: Expr[] = s.k === "assign" ? [s.expr] : s.k === "call" ? [s.call] : s.k === "if" ? s.branches.map((b) => b.cond) : [];
    exprs.forEach((e) => walkE(e, (x) => {
      if (x.k !== "call") return;
      if (x.name === "существует" && x.args[0]?.k === "id") a.optional.add((x.args[0] as { name: string }).name);
      if (x.name === "равно" && x.args.length === 2 && x.args[0].k === "id") {
        const c = constNumber(x.args[1]);
        if (c !== null) { const nm = (x.args[0] as { name: string }).name; const arr = a.eqConsts.get(nm) ?? []; arr.push(c); a.eqConsts.set(nm, arr); }
      }
      if (x.name === "л_фнк" && x.args[0]?.k === "id" && x.args[1]?.k === "paren") {
        const nm = (x.args[0] as { name: string }).name;
        for (const it of (x.args[1] as Extract<Expr, { k: "paren" }>).items) {
          const key = it.k === "paren" ? constNumber(it.items[0]) : null;
          if (key !== null) { const arr = a.tableKeys.get(nm) ?? []; if (!arr.includes(key)) arr.push(key); a.tableKeys.set(nm, arr); }
        }
      }
    }));
    if (s.k === "if" && s.branches.length === 1 && s.branches[0].body.length === 0 && s.els && s.els.length === 1 && s.els[0].k === "assign") {
      const c0 = s.branches[0].cond, as = s.els[0] as Extract<Stmt, { k: "assign" }>;
      if (c0.k === "call" && c0.name === "существует" && c0.args[0]?.k === "id" && (c0.args[0] as { name: string }).name === as.name) {
        const v = constNumber(as.expr);
        if (v !== null && !a.optDefaults.has(as.name)) a.optDefaults.set(as.name, v); // берём ПЕРВОЕ вхождение шаблона: поздние повторы уже ничего не меняют // «если задан X — оставить, иначе X := c» → входной параметр со значением c
      }
    }
  });
  // Припуск на швы в Leko приходит снаружи (если не задан — 0). В студии это опция «Припуск на швы» с типовым значением 1 см (общая для всего изделия)
  if (a.optional.has("seam_allowance") && !a.optDefaults.has("seam_allowance")) a.optDefaults.set("seam_allowance", 1);
  for (const n of a.optDefaults.keys()) a.optional.delete(n);

  // ---- проход 2: в порядке программы — где имя встретилось впервые, где присваивается, что читается как число
  const seen = new Set<string>();
  const writesOutside = new Set<string>();
  const readsGeneral = new Set<string>();
  const touch = (name: string) => { a.allNames.add(name); if (!seen.has(name)) { seen.add(name); a.hoist.add(name); } };   // использовано раньше присваивания → объявить заранее
  const readExpr = (e: Expr, general: boolean) => {
    const skip = new Set<Expr>();
    walkE(e, (x) => { if (x.k === "call" && x.name === "существует") x.args.forEach((y) => skip.add(y)); });
    walkE(e, (x) => {
      if (x.k !== "id") return;
      if (skip.has(x)) { touch(x.name); return; }
      if (general && !seen.has(x.name) && /^рз_?\d+$/.test(x.name)) a.readFirst.add(x.name);
      touch(x.name);
      if (general) readsGeneral.add(x.name);
    });
  };
  const write = (name: string, depth: number, simple: boolean, workshop: boolean, c: number | null) => {
    a.allNames.add(name);
    if (!workshop) writesOutside.add(name);
    if (workshop && c !== null && !a.assignedConst.has(name)) a.assignedConst.set(name, c);
    if (!seen.has(name)) { seen.add(name); if (depth === 0 && simple && !workshop) a.inline.add(name); else a.hoist.add(name); }
  };
  const run = (ss: Stmt[], depth: number, workshop: boolean) => {
    for (const s of ss) {
      if (s.k === "assign") {
        if (!writesOutside.has(s.name) && /^рз_?\d+$/.test(s.name) && s.expr.k === "bin" && s.expr.op === "*" && s.expr.l.k === "id" && s.expr.l.name === s.name && s.expr.r.k === "num" && s.expr.r.v === "2") a.halfInputs.add(s.name);
        readExpr(s.expr, true);
        write(s.name, depth, true, workshop, constNumber(s.expr));
      } else if (s.k === "call") {
        const c = s.call, outIdx = OUT_ARGS[c.name] ?? [];
        const listOp = LIST_OPS.has(c.name);
        c.args.forEach((x, idx) => {
          if (outIdx.includes(idx)) return;
          if (listOp && (idx === 0 || idx === (c.name === "поворот" ? 3 : 2))) { walkE(x, (y) => { if (y.k === "id") touch(y.name); }); return; } // списки объектов — не входные числа
          if (c.name === "ЗАПИСАТЬ" && x.k === "named" && ["контур", "внтр", "имя"].includes(x.name)) { walkE(x.value, (y) => { if (y.k === "id") touch(y.name); }); return; }
          readExpr(x, true);
        });
        for (const idx of outIdx) { const o = c.args[idx]; if (o?.k === "id") write(o.name, depth, false, workshop, null); }
        if (c.name === "отложить" && c.args.length === 4 && c.args[3].k === "id") write((c.args[3] as { name: string }).name, depth, true, workshop, null);
        if (listOp) for (const t of suffixTargets(c, [])) if (t) write(t, depth, false, workshop, null);
        if (c.name === "удалить" && c.args[0]?.k === "id") touch((c.args[0] as { name: string }).name);
      } else if (s.k === "if") {
        s.branches.forEach((b) => readExpr(b.cond, true));
        // блок «мастерская»: если(равно(ФЛАГ, c)) где ФЛАГ — необязательная внешняя переменная; присвоенные там константы — значения по умолчанию
        const first = s.branches[0].cond;
        const isFlag = first.k === "call" && first.name === "равно" && first.args[0]?.k === "id" && a.optional.has((first.args[0] as { name: string }).name);
        s.branches.forEach((b, i) => run(b.body, depth + 1, workshop || (isFlag && i === 0)));
        if (s.els) run(s.els, depth + 1, workshop);
      }
    }
  };
  run(prog, 0, false);

  // ---- итоги
  for (const n of readsGeneral) if (!writesOutside.has(n) && !a.optional.has(n)) a.inputs.add(n); // нигде не вычисляется — значит, приходит снаружи
  for (const n of a.readFirst) if (!a.optional.has(n)) a.inputs.add(n);
  for (const n of a.optDefaults.keys()) a.inputs.add(n);
  for (const n of [...a.inputs]) if (/^import_/.test(n)) a.inputs.delete(n); // import_* приходят от других элементов, а не вводятся вручную
  for (const n of a.allNames) if (/^import_/.test(n)) { a.inline.delete(n); a.optional.delete(n); a.hoist.add(n); }
  for (const n of a.inputs) { a.inline.delete(n); a.hoist.delete(n); }
  for (const n of a.optional) { if (!a.inline.has(n)) a.hoist.add(n); a.inline.delete(n); }
  for (const n of a.allNames) if (!a.inline.has(n) && !a.hoist.has(n) && !a.inputs.has(n)) a.hoist.add(n); // использованы, но нигде не заданы (списки объектов других вариантов)
  return a;
}

// ====================================================================== генерация кода

const JS_RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield await async static undefined NaN Infinity eval arguments of".split(" "));
const BUILTIN = new Set([...Object.keys(ops), "M", "P", "writePiece", "userInputs", "input", "importValue", "measure", "seg"]);

/** Известные значения входов: рост и размерные признаки по умолчанию (типовая фигура 164-96-104). */
const KNOWN_DEFAULTS: Record<string, number> = {
  "рз_1": 164, "рз_16": 96, "рз_18": 76, "рз_19": 104, "рз_20": 101, "рз_25": 106.1, "рз_26": 104.2, "рз_28": 30.3, "рз_29": 16.5, "рз_31": 13.3, "рз_32": 45.3, "рз_33": 68.9,
};
function knownDefault(name: string): number | null {
  if (name in KNOWN_DEFAULTS) return KNOWN_DEFAULTS[name];
  const m = /^рз_?(\d+)$/.exec(name);
  if (m) { const v = (DEFAULT_MEASUREMENTS_W_164_96_104 as unknown as Record<string, number>)["rz" + m[1]]; if (typeof v === "number") return v; }
  return null;
}

const PROP: Record<string, string> = { "л": "length", "ф": "angle1", "ф1": "angle1", "ф2": "angle2", "x": "x", "y": "y", "х": "x", "у": "y", "к": "k" };
const CMP: Record<string, string> = { "равно": "equal", "больше": "greater", "меньше": "less", "больше_р": "greaterR", "меньше_р": "lessR" };
const MATH = new Set(["ABS", "ATAN", "COS", "SIN", "EXP", "LN", "ROUND", "SQRT", "SQR", "TRUNC"]);

// ====================================================================== опции, транслитерация, русские названия деталей

type OptValue = number | [number, string];
interface OptInfo { title: string; values?: OptValue[]; hint?: string }
/** Что значат параметры «пар_N» и подобные: русское название и список значений (по комментариям в самом файле). Неизвестные — остаются «opt_N». */
const OPTION_INFO: Record<string, OptInfo> = {
  "пар_1": { title: "Тип ткани", values: [1, 2, 3, 4] },
  "пар_2": { title: "Посадка", values: [1, 2, 3] },
  "пар_20": { title: "Форма ягодиц", values: [1, 2, 3, 5, 6] },
  "пар_4": { title: "Силуэт", values: [[1, "Слим"], [2, "Стандарт"], [3, "Классика"]] },
  "пар_31": { title: "Форма низа", values: [31, 32, 33, 34, 35] },
  "пар_32": { title: "Разрез", values: [[0, "нет"], [1, "есть"]] },
  "пар_5": { title: "Линия горловины переда", values: [101, 102, 103, 202, 203] },
  "пар_3": { title: "Длина изделия", values: [1, 2, 3, 4, 5, 6] },
  "пар_012": { title: "Карманы", hint: "0 — нет; 2Х — левый карман; Х — оба кармана; 1–9 — верхний карман" },
  "пар_16": { title: "Застёжка переда", values: [[0, "шов переда"], [1, "планка на пуговицах"], [2, "молния"], [3, "пуговицы по борту"], [4, "разрез горловины"], [5, "без шва"], [6, "поло: планка на пуговицах"], [7, "поло: молния"], [8, "поло: V-разрез"], [9, "поло без пуговиц"]] },
  "пар_18": { title: "Застёжка спинки", values: [[0, "без шва"], [1, "изогнутый шов спинки"], [2, "прямой шов"], [3, "пуговицы на спинке"]] },
  "пар_21": { title: "Молния", values: [[0, "нет"], [1, "потайная"], [2, "7 мм"], [3, "10 мм"], [4, "внахлёст"], [5, "по центру"]] },
  "пар_44": { title: "Нагрудная вытачка", values: [[0, "без вытачки"], [1, "с вытачкой"]] },
  "пар_17": { title: "Воротник", values: [[0, "нет"], [1, "стойка"]] },
  "пар_81": { title: "Форма выреза проймы", values: [[1, "стандартная"], [2, "половина ширины плеча"], [3, "плечо 2–3 см"], [5, "спущенное плечо"]] },
  "пар_8": { title: "Длина рукава", values: [[1, "длинный"], [2, "до запястья (браслет)"], [3, "три четверти"], [4, "до локтя"], [5, "выше локтя"], [6, "короткий"]] },
  "пар_24": { title: "Ткань и вытачки", values: [[1, "тканая"], [2, "трикотаж"], [3, "тканая без вытачек"], [4, "трикотаж без вытачек"]] },
  "facing_s": { title: "Низ рукава", values: [[0, "подгиб"], [1, "манжета"], [2, "окантовка"]] },
  "seam_allowance": { title: "Припуск на швы, см", hint: "Обычно 0.7–1.6 см. 0 — без припусков" },
  "ruffle": { title: "Волан", hint: "0 — без волана; больше 0 — с воланом" },
  "пар_facing": { title: "Обтачка низа рукава", hint: "0 — без обтачки; больше 0 — с обтачкой" },
  "facing_t": { title: "Обработка горловины", values: [[0, "без обработки"], [1, "цельнокроеная обтачка"], [2, "обтачка"], [3, "закрытая окантовка"], [4, "окантовка"], [5, "стойка"]] },
  "facing_b": { title: "Пояс", values: [[0, "нет"], [1, "есть"]] },
  "fabric": { title: "Ткань", values: [[0, "основная"], [1, "рибана"]] },
};

/** Параметры, которые остаются просто значениями (мерки, служебные), а не выбираются пользователем. */
function isOptionName(n: string): boolean {
  return /^пар_/.test(n) || /^facing_/.test(n) || n === "fabric" || n === "ruffle" || n === "seam_allowance";
}
/** пар_N → opt_N (option); остальное — как есть. */
function optionRename(n: string): string { return n.replace(/(^|_)пар_/g, "$1opt_"); }

const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "c", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function translit(n: string): string {
  let out = "";
  for (const ch of n) {
    const low = ch.toLowerCase();
    if (low in TR) { const t = TR[low]; out += ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1); } else out += ch;
  }
  return out;
}

const PIECE_PHRASES: Record<string, string> = {
  "BACK": "Спинка", "FRONT": "Перед", "SLEEVE": "Рукав", "WAISTBAND": "Пояс", "BACK WAISTBAND": "Пояс спинки", "FRONT WAISTBAND": "Пояс переда",
  "FRONT FACING": "Обтачка переда", "BACK FACING": "Обтачка спинки", "NECK FACING": "Обтачка горловины", "PATCH POCKET": "Накладной карман",
  "FRONT PLACKET": "Планка переда", "FRONT FACING PLACKET": "Подзор планки переда",
  "FUSIBLE INTERFACING FOR FRONT": "Клеевая прокладка переда", "FUSIBLE INTERFACING FOR POCKET": "Клеевая прокладка кармана",
  "MAIN FABRIC": "Основная ткань", "FUSIBLE INTERFACING": "Клеевая прокладка", "RIB TRIMMING": "Рибана",
};
function ruPieceName(raw: string): string {
  const t = raw.trim();
  const noCut = /\bNO_CUT\b/.test(t);
  const base = t.replace(/\s*\bNO_CUT\b/, "").trim();
  const ru = PIECE_PHRASES[base] ?? base;
  return noCut ? `${ru} (без раскроя)` : ru;
}


class Gen {
  warnings: string[];
  declared = new Set<string>();
  usedNames = new Set<string>();
  ignoredParams = new Set<string>();
  unknownOps = new Set<string>();
  pieces = 0;
  statements = 0;
  extraHoist: string[] = []; // безымянные «нарисованные» линии получают имена отр_1, отр_2…
  constructor(private an: Analysis, warnings: string[]) { this.warnings = warnings; }

  private nameMap = new Map<string, string>();
  private taken = new Set<string>();
  name(n: string): string {
    const hit = this.nameMap.get(n);
    if (hit) return hit;
    if (this.nameMap.size === 0) {
      // сначала занимаем латинские имена как есть — переведённые кириллические не должны с ними совпасть
      for (const x of this.an.allNames) if (/^[\x00-\x7f]+$/.test(optionRename(x))) {
        let r = optionRename(x);
        if (JS_RESERVED.has(r) || BUILTIN.has(r)) r += "_";
        this.nameMap.set(x, r); this.taken.add(r);
      }
      for (const x of [...this.an.allNames].sort()) if (!this.nameMap.has(x)) {
        let r = translit(optionRename(x)).replace(/[^\w$]/g, "_");
        if (/^\d/.test(r)) r = "_" + r;
        while (JS_RESERVED.has(r) || BUILTIN.has(r) || this.taken.has(r)) r += "_";
        this.nameMap.set(x, r); this.taken.add(r);
      }
    }
    const m = this.nameMap.get(n);
    if (m) return m;
    let r = translit(optionRename(n)).replace(/[^\w$]/g, "_");
    while (JS_RESERVED.has(r) || BUILTIN.has(r) || this.taken.has(r)) r += "_";
    this.nameMap.set(n, r); this.taken.add(r);
    this.usedNames.add(r);
    return r;
  }

  prec(op: string) { return op === "||" ? 1 : op === "&&" ? 2 : ["<", ">", "==="].includes(op) ? 3 : op === "+" || op === "-" ? 4 : 5; }

  expr(e: Expr, lineCtx = false): string {
    switch (e.k) {
      case "num": return e.v;
      case "str": return JSON.stringify(e.v.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")));
      case "id": return this.name(e.name);
      case "seg": return `seg(${this.expr(e.a)}, ${this.expr(e.b)})`;
      case "prop": {
        const o = this.expr(e.obj);
        const needParens = !["id", "call", "seg", "prop", "paren"].includes(e.obj.k);
        const p = PROP[e.prop] ?? (this.warnings.push(`Неизвестное свойство «.${e.prop}» оставлено как есть.`), e.prop);
        return `${needParens ? "(" + o + ")" : o}.${p}`;
      }
      case "bin": {
        const wrap = (x: Expr, right: boolean) => {
          const s = this.expr(x);
          if (x.k === "bin" && (this.prec(x.op) < this.prec(e.op) || (right && this.prec(x.op) === this.prec(e.op) && (e.op === "-" || e.op === "/")))) return `(${s})`;
          return s;
        };
        return `${wrap(e.l, false)} ${e.op} ${wrap(e.r, true)}`;
      }
      case "un": {
        if (e.op === "!") return `!${this.wrapUnary(e.x)}`;
        if (e.op === "-" && lineCtx && ["id", "call", "prop", "seg"].includes(e.x.k)) return `reverseLine(${this.expr(e.x)})`;
        return `${e.op}${this.wrapUnary(e.x)}`;
      }
      case "paren": {
        if (e.items.length === 1 && !lineCtx) return `(${this.expr(e.items[0])})`;
        return `[${e.items.map((x) => this.expr(x, lineCtx)).join(", ")}]`;
      }
      case "named": return `${e.name}: ${this.expr(e.value)}`;
      case "call": return this.call(e);
    }
  }
  wrapUnary(x: Expr): string { const s = this.expr(x); return x.k === "bin" ? `(${s})` : s; }

  /** Список (a,b,c) → [a, b, c]; одиночный (a) тоже список. Минус перед линией — reverseLine. */
  list(e: Expr, lineCtx = true): string {
    if (e.k === "paren") return `[${e.items.map((x) => this.listItem(x, lineCtx)).join(", ")}]`;
    return `[${this.listItem(e, lineCtx)}]`;
  }
  listItem(x: Expr, lineCtx: boolean): string {
    if (x.k === "paren") return `[${x.items.map((y) => this.listItem(y, lineCtx)).join(", ")}]`;
    return this.expr(x, lineCtx);
  }
  /** Таблица ((a,b),(c,d)) → [[a, b], [c, d]] (значения — любые выражения). */
  table(e: Expr): string {
    if (e.k !== "paren") return this.expr(e);
    return `[${e.items.map((x) => (x.k === "paren" ? `[${x.items.map((y) => this.table(y)).join(", ")}]` : this.expr(x))).join(", ")}]`;
  }
  str(e: Expr): string { return e.k === "str" ? this.expr(e) : e.k === "paren" && e.items.length === 1 ? this.str(e.items[0]) : this.expr(e); }

  call(c: Extract<Expr, { k: "call" }>): string {
    const a = c.args;
    const arg = (i: number) => (a[i] ? this.expr(a[i]) : "undefined");
    const all = () => a.map((x) => this.expr(x)).join(", ");
    switch (c.name) {
      case "точка": return `point(${all()})`;
      case "отрезок": return `segment(${all()})`;
      case "ломаная": return `polyline(${a.map((x) => this.expr(x, true)).join(", ")})`;
      case "отложить":
        if (a.length === 2) return `layOff(${arg(0)}, ${this.table(a[1])})`;
        if (a.length === 3) return `layOff(${all()})`;
        this.warnings.push(`«отложить» с ${a.length} аргументами в выражении — не переведено как значение.`);
        return `layOff(${a.slice(0, 3).map((x) => this.expr(x)).join(", ")})`;
      case "метка": return `label(${all()})`;
      case "л_фнк": return `sizeFn(${arg(0)}, ${this.table(a[1])})`;
      case "существует": return `exists(${all()})`;
      case "сплайн_к": return `lekoSplineK(${all()}${c.bracket ? ", " + c.bracket : ""})`;
      case "сплайн_кк": return `lekoSplineKK(${all()}${c.bracket ? ", " + c.bracket : ""})`;
      case "сплайн_д": return `lekoSplineLength(${all()}${c.bracket ? ", " + c.bracket : ""})`;
      case "нарисовать_текст": return `drawText(${all()})`;
      default:
        if (CMP[c.name]) return `${CMP[c.name]}(${all()})`;
        if (MATH.has(c.name)) return `${c.name}(${all()})`;
        if (MATH.has(c.name.toUpperCase())) return `${c.name.toUpperCase()}(${all()})`;
        this.unknownOps.add(c.name);
        return `${this.name(c.name)}(${all()})`;
    }
  }

  // ---------------------------------------------------------------- операторы-команды
  lhs(name: string, rhs: string, ind: string, simple: boolean): string {
    const n = this.name(name);
    if (!this.declared.has(n) && simple && this.an.inline.has(name)) { this.declared.add(n); return `${ind}let ${n} = ${rhs};`; }
    this.declared.add(n);
    return `${ind}${n} = ${rhs};`;
  }
  comment(cs: string[], ind: string): string[] {
    return cs.map((c) => `${ind}// ${c}`);
  }

  stmts(ss: Stmt[], ind: string): string[] {
    const out: string[] = [];
    for (const s of ss) {
      this.statements++;
      out.push(...this.comment(s.comments, ind));
      if (s.k === "assign") out.push(this.lhs(s.name, this.expr(s.expr), ind, true));
      else if (s.k === "command") out.push(`${ind}// (команда «${s.name}» из Leko не переносится)`);
      else if (s.k === "if") {
        s.branches.forEach((b, i) => {
          out.push(`${ind}${i === 0 ? "if" : "} else if"} (${this.expr(b.cond)}) {`);
          out.push(...this.stmts(b.body, ind + "  "));
        });
        if (s.els && s.els.length) { out.push(`${ind}} else {`); out.push(...this.stmts(s.els, ind + "  ")); }
        out.push(`${ind}}`);
      } else out.push(...this.proc(s.call, ind));
    }
    return out;
  }

  proc(c: Extract<Expr, { k: "call" }>, ind: string): string[] {
    const a = c.args;
    const e = (i: number) => (a[i] ? this.expr(a[i]) : "undefined");
    const outName = (i: number) => (a[i]?.k === "id" ? (a[i] as { name: string }).name : null);
    const assignOut = (i: number, rhs: string) => { const nm = outName(i); return nm ? this.lhs(nm, rhs, ind, false) : `${ind}// (результат «${c.name}» не записан в переменную)`; };
    switch (c.name) {
      case "пересечение_н": return [assignOut(4, `intersectDirections(${e(0)}, ${e(1)}, ${e(2)}, ${e(3)})`)];
      case "пересечение_д": return [assignOut(5, `intersectCircles(${e(0)}, ${e(1)}, ${e(2)}, ${e(3)}, ${e(4)})`)];
      case "пересечение_дн": return [assignOut(5, `intersectCircleDirection(${e(0)}, ${e(1)}, ${e(2)}, ${e(3)}, ${e(4)})`)];
      case "пересечение": return [assignOut(2, `intersect(${e(0)}, ${e(1)})`)];
      case "отложить": return [assignOut(3, `layOff(${e(0)}, ${e(1)}, ${e(2)})`)];
      case "отложить_в": return [assignOut(2, `layOffAlong(${e(0)}, ${e(1)})`)];   // отложить_в(линия, расстояние, точка) — вдоль линии от её начала
      case "разделить":
      case "разделить_н": {
        const byDir = c.name === "разделить_н";
        const call = byDir ? `splitByDirection(${e(0)}, ${e(1)}, ${e(2)})` : `split(${e(0)}, ${e(1)})`;
        const o = byDir ? [3, 4, 5] : [2, 3, 4];
        const lines = [`${ind}{`, `${ind}  const __split = ${call};`];
        const fields = ["point", "part1", "part2"];
        o.forEach((idx, k) => { const nm = outName(idx); if (nm) lines.push(this.lhs(nm, `__split.${fields[k]}`, ind + "  ", false)); });
        lines.push(`${ind}}`);
        return lines;
      }
      case "симметрия_л": case "перенос": case "поворот": {
        const items = a[0]?.k === "paren" ? (a[0] as Extract<Expr, { k: "paren" }>).items : a[0] ? [a[0]] : [];
        const src = items.map((x) => this.expr(x)).join(", ");
        const targets = suffixTargets(c, this.warnings);
        const fn = c.name === "симметрия_л" ? `mirror([${src}], ${e(1)})` : c.name === "перенос" ? `translate([${src}], ${e(1)})` : `rotate([${src}], ${e(1)}, ${e(2)})`;
        if (targets.filter((t) => t).length === 0) return [`${ind}${fn};`];
        const names = targets.map((t) => (t === null ? "" : this.name(t)));
        names.forEach((n) => n && this.declared.add(n));
        return [`${ind}[${names.join(", ")}] = ${fn};`];
      }
      case "удалить": { const nm = outName(0); return nm ? [`${ind}${this.name(nm)} = undefined;`] : []; }
      case "нарисовать_текст": return [`${ind}${this.call(c)};`];
      case "отрезок": case "ломаная": case "точка": {
        // в Leko оператор без присваивания просто рисует линию/точку; у нас рисуются значения переменных — даём имя
        const nm = `otr_${this.extraHoist.length + 1}`;
        this.extraHoist.push(nm);
        this.declared.add(nm);
        return [`${ind}${nm} = ${this.call(c)};`];
      }
      case "ЗАПИСАТЬ": return this.writePiece(c, ind);
      default: {
        this.unknownOps.add(c.name);
        return [`${ind}${this.name(c.name)}(${a.map((x) => this.expr(x)).join(", ")});`];
      }
    }
  }

  /** Строковый литерал с переводом (если это обычная строка, а не выражение). */
  ruStr(v: Expr, f: (x: string) => string): string {
    const raw = this.str(v);
    try { const lit = JSON.parse(raw); if (typeof lit === "string") return JSON.stringify(f(lit)); } catch { /* не литерал */ }
    return raw;
  }

  writePiece(c: Extract<Expr, { k: "call" }>, ind: string): string[] {
    this.pieces++;
    const fields: string[] = [];
    const fabrics: string[] = [];
    for (const x of c.args) {
      if (x.k !== "named") { this.warnings.push("ЗАПИСАТЬ: параметр без имени пропущен."); continue; }
      const v = x.value;
      switch (x.name) {
        case "имя": fields.push(`name: ${this.ruStr(v, ruPieceName)}`); break;
        case "контур": fields.push(`contour: ${this.list(v, true)}`); break;
        case "внтр": fields.push(`inner: ${this.list(v, true)}`); break;
        case "прибавка": fields.push(`allowance: ${this.expr(v)}`); break;
        case "прибавка_у": fields.push(`allowanceZones: ${this.list(v, false)}`); break;
        case "цвет": fields.push(`color: ${this.expr(v)}`); break;
        case "полотно": fabrics.push(this.str(v)); break;
        case "код": fields.push(`code: ${this.str(v)}`); break;
        case "кд": case "усадка": case "прибавка_т": case "прибавка_л":
          this.ignoredParams.add(x.name); break;
        default: this.ignoredParams.add(x.name);
      }
    }
    if (fabrics.length) {
      const lit = fabrics.map((f) => { try { return JSON.parse(f) as string; } catch { return null; } });
      fields.push(`fabric: ${lit.every((x) => x !== null) ? JSON.stringify((lit as string[]).map((x) => ruPieceName(x)).join(" / ")) : fabrics[0]}`);
    }
    return [`${ind}writePiece({`, ...fields.map((f) => `${ind}  ${f},`), `${ind}});`];
  }
}

// ====================================================================== точка входа

/** Определяет значение входного параметра по умолчанию. */
function inferDefault(name: string, an: Analysis): { value: number; note: string } {
  if (an.optDefaults.has(name)) return { value: an.optDefaults.get(name)!, note: "значение по умолчанию из исходного файла" };
  const k = knownDefault(name);
  if (k !== null && an.halfInputs.has(name)) return { value: Math.round(k * 50) / 100, note: "половина мерки типовой фигуры 164-96-104 (в файле сразу удваивается)" };
  if (k !== null) return { value: k, note: "типовая фигура 164-96-104" };
  if (an.assignedConst.has(name)) return { value: an.assignedConst.get(name)!, note: "значение из блока «мастерская» исходного файла" };
  const keys = an.tableKeys.get(name);
  if (keys && keys.length) return { value: keys[0], note: "вариант из таблицы л_фнк (допустимые: " + keys.join(", ") + ")" };
  const eq = an.eqConsts.get(name);
  if (eq && eq.length) {
    const cnt = new Map<number, number>(); eq.forEach((v) => cnt.set(v, (cnt.get(v) ?? 0) + 1));
    return { value: eq[0], note: "вариант из условий файла (встречаются: " + [...cnt.keys()].sort((x, y) => x - y).join(", ") + ")" };
  }
  return { value: 0, note: "значение неизвестно — поставлен 0" };
}

export function algToScript(source: string, opts: { title?: string; inputsAsConstants?: boolean } = {}): AlgImportResult {
  const warnings: string[] = [];
  const toks = lex(source);
  // В Leko регистр букв в именах переменных не важен (Bracelet_length = bracelet_length, Пмд = пмд): приводим к нижнему. Имена операторов (перед «(» или «[N](») не трогаем.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id") continue;
    const nx = toks[i + 1];
    const isCall = nx && nx.t === "p" && (nx.v === "(" || (nx.v === "[" && toks[i + 2]?.t === "num" && toks[i + 3]?.v === "]" && toks[i + 4]?.v === "("));
    if (!isCall) t.v = t.v.toLowerCase();
  }
  const prog = new Parser(toks, warnings).parseProgram();
  const an = analyse(prog);
  const gen = new Gen(an, warnings);

  // тело программы
  const body = gen.stmts(prog, "");

  // входные параметры
  const inputNames = [...an.inputs].filter((n) => !an.optional.has(n));
  const inputs: AlgInput[] = inputNames.map((n) => { const d = inferDefault(n, an); return { name: n, default: d.value, note: d.note }; });
  const head: string[] = [];
  head.push(`// Построение, переведённое из файла Leko${opts.title ? " «" + opts.title + "»" : ""}.`);
  head.push("// Операторы — английские (point, layOff, intersectDirections, writePiece…); имена переменных — латиницей (транслит исходных: п1 → p1, пар_5 → opt_5).");
  const optNames = inputNames.filter(isOptionName);
  const constNames = inputNames.filter((n) => !isOptionName(n));
  if (constNames.length && opts.inputsAsConstants) {
    // значения, которые не выбирает пользователь (мерки, служебные), — одной строкой; при желании правятся прямо в коде
    head.push("//");
    head.push("// Значения, которые в Leko приходили снаружи (рост, обхват груди…), — одной строкой; при желании поправьте здесь.");
    const measureKeys = new Set([...Object.keys(DEFAULT_MEASUREMENTS_W_164_96_104), "rz1", "rz16"]);
    const constExpr = (n: string): string => {
      const m = /^рз_?(\d+)$/.exec(n);
      // мерки, которые есть в наборе мерок студии, берутся из него (меняются на вкладке «Мерки»); half — построение ждёт половину обхвата
      if (m && measureKeys.has("rz" + m[1])) return `measure("rz${m[1]}", ${inferDefault(n, an).value}${an.halfInputs.has(n) ? ', "half"' : ""})`;
      return String(inferDefault(n, an).value);
    };
    head.push("let " + constNames.map((n) => `${gen.name(n)} = ${constExpr(n)}`).join(", ") + ";");
    for (const n of constNames) gen.declared.add(gen.name(n));
  }
  if (optNames.length && opts.inputsAsConstants) {
    head.push("");
    head.push("// Опции (в Leko — пар_N): справа от чертежа, кликнув на опцию, можно выбрать значение. Русские названия подписаны, где они известны; иначе остаётся номер opt_N.");
    for (const n of optNames) {
      const info = OPTION_INFO[n];
      const meta: Record<string, unknown> = { option: true };
      if (info) { meta.title = info.title; if (info.values) meta.values = info.values; if (info.hint) meta.hint = info.hint; }
      head.push(`let ${gen.name(n)} = input(${JSON.stringify(gen.name(n))}, ${inferDefault(n, an).value}, ${JSON.stringify(meta)});`);
      gen.declared.add(gen.name(n));
    }
  }
  if (opts.inputsAsConstants) {
    inputs.length = 0;
  } else if (inputs.length) {
    head.push("//");
    head.push("// Входные параметры — то, что в Leko приходило снаружи (рост, обхват груди, варианты пар_N…). Значения по умолчанию подобраны");
    head.push("// по файлу и типовой фигуре; их можно менять в студии (вкладка «Мерки и прибавки», раздел «Параметры построения»).");
    for (const n of inputNames) {
      const d = inferDefault(n, an);
      head.push(`let ${gen.name(n)} = input(${JSON.stringify(gen.name(n))}, ${d.value}); // ${d.note}`);
      gen.declared.add(gen.name(n));
    }
  }
  const hoisted = [...an.hoist].filter((n) => !an.inputs.has(n));
  if (hoisted.length) {
    head.push("");
    head.push("// Переменные, которым значение присваивается внутри условий или которые могут быть не заданы (в Leko объявлять не нужно).");
    const plain = hoisted.filter((n) => !/^import_/.test(gen.name(n)));
    if (plain.length) head.push("let " + plain.map((n) => gen.name(n)).join(", ") + ";");
    const imps = hoisted.filter((n) => /^import_/.test(gen.name(n)));
    if (imps.length) {
      head.push("");
      head.push("// Связь с другими элементами изделия: import_X берёт то, что основа отдала переменной export_X (длины срезов и т.п.).");
      head.push("// Если основа не подключена — переменная остаётся не заданной, как в Leko.");
      for (const n of imps) {
        const gn = gen.name(n);
        const base = n.replace(/^import_/, "");
        if (isOptionName(base)) {
          // опция, значение которой по умолчанию приходит от основы, но которую можно выбрать и у самого элемента (длина рукава и т.п.)
          const info = OPTION_INFO[base];
          const meta: Record<string, unknown> = { option: true };
          if (info) { meta.title = info.title; if (info.values) meta.values = info.values; if (info.hint) meta.hint = info.hint; }
          else meta.title = gn.replace(/^import_/, "");
          const dflt = an.optDefaults.has(n) ? an.optDefaults.get(n) : inferDefault(n, an).value;
          head.push(`let ${gn} = input(${JSON.stringify(gn)}, importValue(${JSON.stringify(gn)}) ?? ${dflt}, ${JSON.stringify(meta)});`);
        } else head.push(`let ${gn} = importValue(${JSON.stringify(gn)})${an.optDefaults.has(n) ? ` ?? ${an.optDefaults.get(n)}` : ""};`);
      }
    }
  }
  if (gen.extraHoist.length) {
    head.push("");
    head.push("// Линии, которые в Leko просто «рисуются» оператором отрезок(…) без имени, здесь получили имена, чтобы попасть на чертёж.");
    head.push("let " + gen.extraHoist.join(", ") + ";");
  }
  const bodyText = body.join("\n");
  const script = head.join("\n") + "\n\n" + bodyText + "\n";

  if (gen.unknownOps.size) warnings.push(`Операторы без перевода (оставлены как есть, при запуске будут ошибкой): ${[...gen.unknownOps].join(", ")}.`);
  if (gen.ignoredParams.size) warnings.push(`В ЗАПИСАТЬ не перенесены параметры: ${[...gen.ignoredParams].join(", ")} (усадка, коды уголков, количество деталей — пока не поддерживаются).`);
  const unknownDefaults = inputs.filter((i) => i.note.startsWith("значение неизвестно"));
  if (unknownDefaults.length) warnings.push(`Для ${unknownDefaults.length} входных параметров значение по умолчанию неизвестно (поставлен 0): ${unknownDefaults.map((i) => i.name).join(", ")}.`);
  return { script, warnings, inputs, stats: { statements: gen.statements, variables: an.allNames.size, pieces: gen.pieces } };
}

/** Декодирует байты файла .ALG: Leko хранит текст в Windows-1251; если файл в UTF-8 — берём его. */
export function decodeAlg(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1251").decode(bytes); }
}
