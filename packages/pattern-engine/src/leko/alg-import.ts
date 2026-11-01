import * as ops from "./ops.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104 } from "../types.js";
import { BOY_LABELS } from "../gost-boys-data.js";
import { GIRL_LABELS } from "../gost-girls-data.js";
import { MEN_LABELS } from "../gost-men-data.js";

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
  /** Для .rb: номер строки исходного файла для каждой строки скрипта (индекс с 0; 0 — нет соответствия). */
  lineMap?: number[];
}

// ====================================================================== лексер

export interface Tok { t: "num" | "str" | "id" | "p" | "eof"; v: string; pos: number; comments: string[] }

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

export type Expr =
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

export type Stmt =
  | { k: "assign"; name: string; expr: Expr; comments: string[]; line?: number }
  | { k: "call"; call: Extract<Expr, { k: "call" }>; comments: string[]; line?: number }
  | { k: "if"; branches: { cond: Expr; body: Stmt[] }[]; els: Stmt[] | null; comments: string[]; line?: number }
  | { k: "loop"; body: Stmt[]; comments: string[]; line?: number }
  | { k: "command"; name: string; comments: string[]; line?: number };

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
        if (this.isKw("ц_начало")) {
          this.i++;
          const body = this.parseStatements(["ц_конец"]);
          if (!this.isKw("ц_конец")) throw new Error("не найдено «ц_конец»" + this.where());
          this.i++;
          out.push({ k: "loop", body, comments });
          continue;
        }
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
const LIST_OPS = new Set(["симметрия_л", "перенос", "поворот", "симметрия_т", "сжать", "развести"]);
/** Номер параметра-«суффикса/результатов» у операторов над списком объектов. */
const suffixIdx = (name: string) => (name === "поворот" ? 3 : name === "сжать" ? 5 : name === "развести" ? 6 : 2);

interface Analysis {
  inline: Set<string>;       // объявляются на месте первого присваивания на верхнем уровне
  hoist: Set<string>;        // объявляются заранее (let имя;)
  inputs: Set<string>;       // приходят снаружи (input)
  optional: Set<string>;     // проверяются существует() — остаются не заданными
  /** Прибавки ease_*: что нашли в файле (диапазон _min/_max, pattern_…, переменная-потребитель). */
  easeMin: Set<string>; easeMax: Set<string>;
  patterns: Map<string, string>;   // база (без ease_ и _unit_*) → полное имя pattern_…
  easeConsumer: Map<string, string>; // ease_X → переменная, которой в «если существует(ease_X)» присваивается значение один в один
  existsNames: Set<string>;  // все имена, которые хоть раз встретились внутри существует(…): только они переключаются, остальное — просто значения
  eqConsts: Map<string, number[]>;
  garment?: { group: string; item: string };  // из кода алга: группа (J, M, D, DD, DM) и изделие (PL, YB, BR…)
  topConst: Map<string, number>;  // числовые константы, присвоенные в самом верху файла (fabric_type = 2, пар_30 = 0): по ним определяется вид изделия и ткани
  tableKeys: Map<string, number[]>;
  assignedConst: Map<string, number>; // имя → числовая константа, присвоенная в блоке по условию на необязательный флаг («мастерская»)
  halfInputs: Set<string>;   // мерка, которая сразу удваивается (рз_16 := рз_16*2): снаружи приходит половина
  readFirst: Set<string>;    // мерки, прочитанные раньше первого присваивания — приходят снаружи
  optDefaults: Map<string, number>;   // «если существует(X) то иначе X := c» — входной параметр X со значением c
  allNames: Set<string>;
  /** Присваивания, которые не переносятся: константа припуска на швы, ставшая входным параметром (seam_allowance := 1 в готовом изделии). */
  skip: Set<Stmt>;
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
  const third = call.args[suffixIdx(call.name)];
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
function walkS(ss: Stmt[], f: (s: Stmt) => void) { for (const s of ss) { f(s); if (s.k === "if") { s.branches.forEach((b) => walkS(b.body, f)); if (s.els) walkS(s.els, f); } else if (s.k === "loop") walkS(s.body, f); } }

/** Русские названия прибавок Leko (ease_*). */
const EASE_TITLES: Record<string, string> = {
  vertical_shrinkage: "Усадка по длине, %",
  horizontal_shrinkage: "Усадка по ширине, %",
  vertical_compression: "Уплотнение по длине, %",
  horizontal_compression: "Уплотнение по ширине, %",
  bust_dart_length: "Длина нагрудной вытачки",
  bust_dart_height: "Высота нагрудной вытачки",
  shoulder_width: "Ширина плеча",
  back_width: "Ширина спинки",
  back_length_to_waist: "Длина спинки до талии",
  front_length_to_waist: "Длина переда до талии",
  upper_pocket_entry_length: "Длина входа верхнего кармана",
  center_front_upper_pocket_position: "Положение верхнего кармана от середины переда",
  waist_to_upper_pocket_length: "Расстояние от талии до верхнего кармана",
  upper_pocket_width_welt: "Ширина листочки верхнего кармана",
  button_diameter: "Диаметр пуговицы",
  stretch_factor: "Коэффициент растяжимости ткани",
  stretch_factor_horizontal: "Растяжимость по ширине",
  stretch_factor_vertical: "Растяжимость по длине",
  height_armhole: "Высота проймы",
  bust: "Ширина по груди",
  waist: "Ширина по талии",
  hips: "Ширина по бёдрам",
  upper_arm: "Ширина рукава по окату",
  neckline_facing_width: "Ширина обтачки горловины",
  neckline_enclosed_binding_width: "Ширина закрытой окантовки горловины",
  neckline_binding_width: "Ширина окантовки горловины",
  elastic_collar_height: "Высота трикотажного воротника",
  waistband_width: "Ширина пояса",
  neck_width: "Ширина горловины",
  front_neck_depth: "Глубина горловины переда",
  back_neck: "Горловина спинки",
  length: "Длина изделия",
  center_back_length_to_hem: "Длина по середине спинки",
  back_length_to_hem: "Длина спинки",
  hemline_sweep: "Ширина низа",
  side_slit_length: "Длина бокового разреза",
  placket_width: "Ширина планки",
  placket_length: "Длина планки",
  last_button_to_hem_placket: "Расстояние от последней пуговицы до низа",
  front_buttons_quantity: "Количество пуговиц на переде",
  front_last_button_to_hem: "Расстояние от последней пуговицы переда до низа",
  front_split_length: "Длина разреза переда",
  kangaroo_pocket_height: "Высота кармана-кенгуру",
  kangaroo_pocket_width: "Ширина кармана-кенгуру",
  hemline_kangaroo_pocket_position: "Положение кармана-кенгуру от низа",
  back_buttons_quantity: "Количество пуговиц на спинке",
  back_closure_length: "Длина застёжки спинки",
  side_zipper_length: "Длина боковой молнии",
  pocket_entry_length: "Длина входа кармана",
  side_seam_pocket_position: "Положение кармана на боковом шве",
  waist_to_pocket_length: "Расстояние от талии до кармана",
  pocket_width_welt: "Ширина листочки кармана",
  ruffle_length: "Длина волана",
  upper_pockets_move_horizontally: "Сдвиг верхних карманов по горизонтали",
  upper_pockets_move_vertically: "Сдвиг верхних карманов по вертикали",
  pocket_bag_height: "Высота мешковины кармана",
  sleeve_length: "Длина рукава",
  sleeve_opening: "Ширина низа рукава",
  elastic_cuff_width: "Ширина манжеты",
  gather_sleeve_opening: "Ширина низа рукава со сборкой",
  sleeve_elastic_cuff_length: "Длина рукава с манжетой",
  armhole_binding_width: "Ширина окантовки проймы",
  armhole_depth: "Углубление проймы",
  armhole_elastic_length: "Длина резинки проймы",
  armhole_enclosed_binding: "Ширина закрытой окантовки проймы",
  armhole_facing_width: "Ширина обтачки проймы",
  armhole_width: "Ширина проймы",
  back_length: "Длина спинки",
  back_length_to_waist_seam: "Длина спинки до отрезного по талии",
  back_length_vent: "Длина шлицы спинки",
  back_neck_depth: "Глубина горловины спинки",
  band_length: "Длина полосы",
  binding_armhole_width: "Ширина окантовки проймы",
  binding_width: "Ширина окантовки",
  bottom_opening_facing: "Ширина обтачки нижнего разреза",
  bottom_opening_zipper: "Длина нижней молнии",
  bra_hook_and_eye_closure_length: "Длина застёжки на крючках",
  bra_strap_adjuster_width: "Ширина регулятора бретели",
  chest: "Ширина по груди",
  collar_fall_length: "Длина отлёта воротника",
  collar_width: "Ширина воротника",
  cuff_button_diameter: "Диаметр пуговицы манжеты",
  cuff_length: "Длина манжеты",
  cuff_width: "Ширина манжеты",
  drop_waist_seam: "Положение заниженной линии талии",
  elastic_width: "Ширина резинки",
  empire_seam: "Положение линии под грудью",
  facing_width: "Ширина обтачки",
  flap_height: "Высота клапана",
  front_length: "Длина переда",
  front_length_to_waist_seam: "Длина переда до отрезного по талии",
  front_slit_length: "Длина разреза переда",
  front_width: "Ширина полочки",
  gather_hemline_skirt: "Сборка по низу юбки",
  gather_sleeve_flounce: "Сборка волана рукава",
  gather_sleeve_ruffle: "Сборка оборки рукава",
  gather_waistline_skirt: "Сборка по линии талии юбки",
  gusset_width: "Ширина клина",
  half_breast_width: "Полуобхват груди",
  height_back_yoke: "Высота кокетки спинки",
  height_front_yoke: "Высота кокетки переда",
  hem_bottom: "Ширина низа",
  hem_to_last_grommet_clearance: "Расстояние от низа до последнего люверса",
  hood_height: "Высота капюшона",
  lapel_length: "Длина лацкана",
  lapel_width: "Ширина лацкана",
  last_button_to_hem_front: "Расстояние от последней пуговицы до низа",
  last_button_to_hem_split: "Расстояние от последней пуговицы до разреза",
  leg_opening_elastic_length: "Длина резинки по низу штанины",
  length_to_drop_waist_seam: "Длина до заниженной линии талии",
  length_to_empire_seam: "Длина до линии под грудью",
  natural_waist: "Ширина по линии талии",
  neckline_elastic_length: "Длина резинки горловины",
  panty_rise: "Высота посадки трусов",
  rounding_radius: "Радиус скругления",
  skirt_hip: "Ширина юбки по бёдрам",
  skirt_length: "Длина юбки",
  skirt_waist: "Ширина юбки по талии",
  sleeve_cap: "Ширина рукава по окату",
  sleeve_enclosed_binding: "Ширина закрытой окантовки рукава",
  sleeve_flounce_length: "Длина волана рукава",
  sleeve_flounce_outer_circle: "Внешняя окружность волана рукава",
  sleeve_hem: "Ширина рукава внизу",
  sleeve_lower_flounce_length: "Длина нижнего волана рукава",
  sleeve_placket_button_diameter: "Диаметр пуговицы планки рукава",
  sleeve_placket_length: "Длина планки рукава",
  sleeve_placket_width: "Ширина планки рукава",
  sleeve_ruffle_length: "Длина оборки рукава",
  sleeve_slit_length: "Длина разреза рукава",
  sleeve_upper_flounce_length: "Длина верхнего волана рукава",
  stand_height: "Высота стойки",
  strap_width: "Ширина бретели",
  trousers_hem: "Ширина брюк внизу",
  trousers_hip: "Ширина брюк по бёдрам",
  trousers_knee: "Ширина брюк по колену",
  trousers_rise: "Посадка брюк",
  trousers_waist: "Ширина брюк по талии",
  underbust: "Ширина под грудью",
  waistband_partly_elastic_width: "Ширина пояса с частичной резинкой",
  wrist: "Ширина по запястью",
};
export function easeTitle(name: string): string {
  const base = name.replace(/^ease_/, "");
  return EASE_TITLES[base] ?? ("Прибавка: " + base.replace(/_/g, " "));
}

function analyse(prog: Stmt[]): Analysis {
  const a: Analysis = { inline: new Set(), hoist: new Set(), inputs: new Set(), optional: new Set(), easeMin: new Set(), easeMax: new Set(), patterns: new Map(), easeConsumer: new Map(), existsNames: new Set(), eqConsts: new Map(), topConst: new Map(), tableKeys: new Map(), assignedConst: new Map(), allNames: new Set(), optDefaults: new Map(), halfInputs: new Set(), readFirst: new Set(), skip: new Set() };
  for (const st of prog) if (st.k === "assign") { const c = constNumber(st.expr); if (c !== null && !a.topConst.has(st.name)) a.topConst.set(st.name, c); }

  walkS(prog, (s) => {
    // прибавки ease_*: диапазон, pattern и переменная-потребитель
    if (s.k === "assign") {
      const mm = /^(ease_.+)_(min|max)$/.exec(s.name);
      if (mm) (mm[2] === "min" ? a.easeMin : a.easeMax).add(mm[1]);
      if (/^pattern_/.test(s.name)) {
        const base = s.name.replace(/^pattern_/, "").replace(/_unit_(cm|pc)$/, "").replace(/^ease_/, "");
        if (!a.patterns.has(base)) a.patterns.set(base, s.name);
      }
    }
    if (s.k === "if") {
      for (const b of s.branches) {
        const c = b.cond;
        if (c.k === "call" && c.name === "существует" && c.args[0]?.k === "id") {
          const en = (c.args[0] as { name: string }).name;
          if (!/^ease_/.test(en) || a.easeConsumer.has(en)) continue;
          for (const st of b.body) if (st.k === "assign" && st.expr.k === "id" && (st.expr as { name: string }).name === en) { a.easeConsumer.set(en, st.name); break; }
        }
      }
    }
  });
  // ---- проход 1: необязательные (существует), шаблон «если существует(X) то иначе X:=c», значения из сравнений и таблиц
  walkS(prog, (s) => {
    const exprs: Expr[] = s.k === "assign" ? [s.expr] : s.k === "call" ? [s.call] : s.k === "if" ? s.branches.map((b) => b.cond) : [];
    exprs.forEach((e) => walkE(e, (x) => {
      if (x.k !== "call") return;
      if (x.name === "существует" && x.args[0]?.k === "id") { const en = (x.args[0] as { name: string }).name; a.optional.add(en); a.existsNames.add(en); }
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
  // Готовое изделие (MOV11001): припуск прописан прямо в файле — seam_allowance := 1, без существует(). Чтобы покупатель мог его выключить,
  // эта константа становится значением по умолчанию входного параметра «Припуск на швы», а само присваивание не переносится.
  if (!a.optional.has("seam_allowance") && !a.optDefaults.has("seam_allowance")) {
    let top: Extract<Stmt, { k: "assign" }> | null = null;
    for (const s of prog) if (s.k === "assign" && s.name === "seam_allowance" && constNumber(s.expr) !== null) top = s;
    if (top) { a.optDefaults.set("seam_allowance", constNumber(top.expr)!); a.existsNames.add("seam_allowance"); a.skip.add(top); }
  }
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
          if (listOp && (idx === 0 || idx === suffixIdx(c.name))) { walkE(x, (y) => { if (y.k === "id") touch(y.name); }); return; } // списки объектов — не входные числа
          if (c.name === "ЗАПИСАТЬ" && x.k === "named" && ["контур", "внтр", "имя"].includes(x.name)) { walkE(x.value, (y) => { if (y.k === "id") touch(y.name); }); return; }
          readExpr(x, true);
        });
        for (const idx of outIdx) { const o = c.args[idx]; if (o?.k === "id") write(o.name, depth, false, workshop, null); }
        { const an = autoSplineName(c); if (an) write(an, depth, false, workshop, null); }
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
      } else if (s.k === "loop") run(s.body, depth + 1, workshop);
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
/** Сплайн без имени получает в Leko имя «с_<точка1>_<точка2>» — на него потом ссылаются (С_Б_Т2.ф2). */
function autoSplineName(c: { name: string; args: Expr[] }): string | null {
  const a = c.args;
  if (!/^сплайн_/.test(c.name) || a[0]?.k !== "id" || a[1]?.k !== "id") return null;
  return `с_${(a[0] as { name: string }).name}_${(a[1] as { name: string }).name}`.toLowerCase();
}
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
/** Служебная метка в конце строки сгенерированного кода: за ней номер строки исходного файла (убирается в buildFromProg). */
const LINE_MARK = "\u0001";
const MATH = new Set(["ABS", "ATAN", "COS", "SIN", "EXP", "LN", "ROUND", "SQRT", "SQR", "TRUNC"]);

// ====================================================================== опции, транслитерация, русские названия деталей

type OptValue = number | [number, string];
interface OptInfo { title: string; values?: OptValue[]; hint?: string; hidden?: boolean }
/** «1=Название|2=Название» → {1:"Название",2:"Название"} */
const L = (t: string): Record<number, string> => Object.fromEntries(t.split("|").map((x) => { const i = x.indexOf("="); return [Number(x.slice(0, i)), x.slice(i + 1)]; }));
/** Что значат параметры «пар_N» и подобные: русское название и список значений (по комментариям в самом файле). Неизвестные — остаются «opt_N». */
const OPTION_INFO: Record<string, OptInfo> = {
  "пар_1": { title: "Растяжимость ткани", values: [1, 2, 3, 4] },
  "пар_2": { title: "Посадка", values: [1, 2, 3] },
  "пар_20": { title: "Форма ягодиц", values: [1, 2, 3, 5, 6] },
  "пар_4": { title: "Силуэт" },
  "пар_31": { title: "Форма низа" },
  "пар_32": { title: "Боковые разрезы" },
  "пар_15": { title: "Положение талии", hidden: true, hint: "Служебная: задаёт конструктор (0 — платье, комбинезон; 1 — юбка или брюки отдельно). Пользователь не видит" },
  "пар_5": { title: "Линия горловины переда", values: [101, 102, 103, 202, 203] },
  "пар_3": { title: "Длина изделия", values: [1, 2, 3, 4, 5, 6] },
  "пар_012": { title: "Карманы", hint: "0 — нет; 2Х — левый карман; Х — оба кармана; 1–9 — верхний карман" },
  "пар_16": { title: "Застёжка переда", values: [[0, "шов переда"], [1, "планка на пуговицах"], [2, "молния"], [3, "пуговицы по борту"], [4, "разрез горловины"], [5, "без шва"], [6, "поло: планка на пуговицах"], [7, "поло: молния"], [8, "поло: V-разрез"], [9, "поло без пуговиц"]] },
  "пар_18": { title: "Застёжка спинки", values: [[0, "без шва"], [1, "изогнутый шов спинки"], [2, "прямой шов"], [3, "пуговицы на спинке"]] },
  "пар_21": { title: "Молния", values: [[0, "нет"], [1, "потайная"], [2, "7 мм"], [3, "10 мм"], [4, "внахлёст"], [5, "по центру"]] },
  "пар_44": { title: "Нагрудная вытачка" },
  "пар_17": { title: "Воротник", values: [[0, "нет"], [1, "стойка"]] },
  "пар_81": { title: "Форма выреза проймы", values: [[1, "стандартная"], [2, "половина ширины плеча"], [3, "плечо 2–3 см"], [5, "спущенное плечо"]] },
  "пар_8": { title: "Длина рукава", values: [[1, "длинный"], [2, "до запястья (браслет)"], [3, "три четверти"], [4, "до локтя"], [5, "выше локтя"], [6, "короткий"]] },
  "пар_24": { title: "Ткань и вытачки", values: [[1, "тканая"], [2, "трикотаж"], [3, "тканая без вытачек"], [4, "трикотаж без вытачек"]] },
  "facing_s": { title: "Низ рукава" },
  "seam_allowance": { title: "Припуск на швы, см", hint: "Обычно 0.7–1.6 см. 0 — без припусков" },
  "ruffle": { title: "Волан", hint: "0 — без волана; больше 0 — с воланом" },
  "пар_facing": { title: "Обтачки: горловина и пройма" },
  "facing_t": { title: "Обработка горловины", values: [[0, "без обработки"], [1, "цельнокроеная обтачка"], [2, "обтачка"], [3, "закрытая окантовка"], [4, "окантовка"], [5, "стойка"]] },
  "facing_b": { title: "Пояс", values: [[0, "нет"], [1, "есть"]] },
  "fabric": { title: "Ткань", values: [[0, "основная"], [1, "рибана"]] },
};

/** Названия опций, которых нет в OPTION_INFO (по документу параметров). */
const EXTRA_TITLES: Record<string, string> = {
  "пар_6": "Линия горловины спинки", "пар_7": "Drop cut горловины спинки", "пар_9": "Низ рукава: планка, хлястик", "пар_10": "Осанка", "пар_11": "Скат плеч",
  "пар_12": "Карманы спереди (боковые, в шве)", "пар_120": "Задние карманы", "пар_13": "Ширинка", "пар_14": "Ширина пояса",
  "пар_19": "Шлица или складка сзади", "пар_22": "Длина застёжки", "пар_022": "Длина застёжки переда", "пар_23": "Застёжка спинки юбки", "пар_25": "Одно плечо",
  "пар_26": "Манжета", "пар_27": "Застёжка переда юбки", "пар_28": "Разрез спереди", "пар_29": "Линия талии / посадка", "пар_30": "Вид изделия",
  "пар_33": "Разрезы спереди на юбке", "пар_34": "Складки на юбке", "пар_340": "Отстрочка складок", "пар_40": "Ширина бретели", "пар_401": "Бретели: холтер",
  "пар_41": "Вытачки по талии", "пар_42": "Чашки бюстгальтера", "пар_43": "Плечевые вытачки", "пар_45": "Боди или купальник", "пар_46": "Раскладка принцессовых швов",
  "пар_47": "Принцессовые швы переда", "пар_48": "Принцессовые швы спинки", "пар_82": "Тип рукава боди", "пар_161": "Кокетка переда", "пар_171": "Воротник: втачной или цельнокроеный",
  "пар_180": "Кокетка спинки юбки", "пар_181": "Кокетка спинки рубашки", "пар_182": "Складки под кокеткой", "пар_183": "Вытачки на спинке", "пар_230": "Вытачки и складки на поясе",
  "пар_241": "Шов на локтевой части рукава", "пар_37": "Ткань для юбки", "пар_140": "Ширина ремня", "пар_141": "Длина ремня",
  "facing_h": "Обработка капюшона", "facing_v": "Обработка пояса нижнего белья", "facing": "Обработка горловины и проймы", "lining": "Подкладка", "waistband": "Пояс",
  "cuff": "Низ брюк (манжета)", "elastic": "Резинка в поясе", "flare": "Расширение низа рукава", "flounce": "Воланы на рукаве", "ruche": "Сборка рукава",
  "layer": "Слои рукава", "loop": "Шлёвки для ремня", "gender": "Пол", "interfacing": "Клеевая прокладка", "regulated": "Регулируемая бретель", "waistdarts": "Вытачки по талии",
};
/** Подписи значений по документу параметров. Если опция в разных изделиях значит разное (длина пар_3, силуэт пар_4, растяжимость пар_1), подписей нет. */
const OPT_LABELS: Record<string, Record<number, string>> = {
  "пар_2": L("1=очень облегающая|2=облегающая|3=полуприлегающая"),
  "пар_5": L("100=широкий вырез|101=круглая, по шее|102=круглая, шаг 2|103=круглая, шаг 3|104=круглая, шаг 4|105=круглая глубокая|106=круглая широкая глубокая|107=лодочка|108=узкая глубокая (U)|201=V по шее, неглубокий|202=V, шаг 2|203=V, шаг 3|204=V, шаг 4|205=V, шаг 5|206=V широкий глубокий|207=широкий неглубокий V|208=глубокий V|222=мягкий V, шаг 2|223=мягкий V, шаг 3|224=мягкий V, шаг 4|225=мягкий V, шаг 5|226=мягкий V, шаг 6|227=мягкий V, шаг 7|228=мягкий V, шаг 8|301=квадратная по шее|302=квадратная, шаг 2|303=квадратная, шаг 3|304=квадратная, шаг 4|305=квадратная, шаг 5|306=квадратная широкая глубокая|307=квадратная лодочка|308=квадратная узкая глубокая|322=квадратная со скруглёнными углами, шаг 2|323=квадратная со скруглёнными углами, шаг 3|324=квадратная со скруглёнными углами, шаг 4|325=квадратная со скруглёнными углами, шаг 5|326=квадратная со скруглёнными углами, шаг 6|327=квадратная со скруглёнными углами, шаг 7|328=квадратная со скруглёнными углами, шаг 8|401=бретели, неглубокий вырез|402=бретели, прямой вырез|404=бретели, V|501=запах|502=на одно плечо|601=чашки балконет|602=чашки сердечком|603=чашки холтер|700=лацканный воротник, угол 1|701=лацканный воротник, угол 2|702=лацканный воротник, скруглённые углы|703=лацканный воротник с отдельной стойкой"),
  "пар_6": L("101=круглая, по шее|102=круглая, ниже на 1 см|103=круглая, ниже на 2 см|104=круглая, ниже на 3 см|105=круглая, 20% длины спинки|106=круглая глубокая, 45% длины спинки|107=лодочка|108=без спинки, круглая|202=V, ниже на 1 см|203=V, ниже на 2 см|204=V, ниже на 3 см|205=V, 20% длины спинки|206=V, 45% длины спинки|207=V лодочка|208=V без спинки|302=квадратная, ниже на 1 см|303=квадратная, ниже на 2 см|304=квадратная, ниже на 3 см|305=квадратная, 20% длины спинки|306=квадратная, 45% длины спинки|307=квадратная лодочка|308=квадратная без спинки|501=запах|502=на одно плечо"),
  "пар_7": L("0=без Drop cut|1=Drop cut 1|2=Drop cut 2|3=Drop cut 3"),
  "пар_8": L("0=без рукава|1=длинный|2=до запястья (браслет)|3=три четверти|4=до локтя|5=выше локтя|6=короткий|11=пройма подогнута и застрочена|12=пройма с обтачкой, припуск срезан|13=пройма с окантовкой"),
  "пар_10": L("1=прогнутая спина|2=выправленная (военная)|3=округлые плечи|4=седловидная спина|5=прямая спина"),
  "пар_11": L("1=квадратные|2=нормальные|3=слегка скошенные|4=сильно скошенные"),
  "пар_12": L("0=нет|1=в шве|2=с клапаном|3=прорезные косые|4=косые с клапаном|5=накладные|6=прорезные вертикальные|7=боковые|8=накладные боковые|9=боковые круглые|11=в шве, прямоугольный мешок|12=в шве, мешок со скошенным углом|13=в шве, круглый мешок"),
  "пар_120": L("0=нет|1=с клапаном|11=с клапаном, только правый|21=с клапаном, только левый|2=прорезные|12=прорезной, только правый|22=прорезной, только левый|3=накладные|13=накладной, только правый|23=накладной, только левый|4=накладные с острым низом|14=накладной с острым низом, только правый|24=накладной с острым низом, только левый"),
  "пар_012": L("0=нет|1=накладные с линией U, два|21=накладной с линией U, левый|11=накладной с линией U, правый|2=накладные закруглённые, два|22=накладной закруглённый, левый|12=накладной закруглённый, правый|3=накладные с клапаном, два|23=накладной с клапаном, левый|13=накладной с клапаном, правый|4=с листочкой и клапаном, два|24=с листочкой и клапаном, левый|14=с листочкой и клапаном, правый|5=прорезные с рамкой, два|25=прорезной с рамкой, левый|15=прорезной с рамкой, правый|6=косые прорезные, два|26=косой прорезной, левый|16=косой прорезной, правый|7=косые прорезные|8=карман-кенгуру, косой вход|9=карман-кенгуру, вход дугой|30=накладные с острым низом, два|130=накладной с острым низом, правый|230=накладной с острым низом, левый"),
  "пар_15": L("0=по натуральной талии (платье, комбинезон)|1=юбка или брюки отдельно"),
  "пар_13": L("0=нет|1=ширинка|2=ложная ширинка"),
  "пар_14": L("0=без пояса|1=пояс 2 см|2=пояс 3 см|3=пояс 4 см|4=пояс 5 см|5=пояс 3 см с шлёвками для шнура"),
  "пар_16": L("61=короткая фигурная планка по центру|62=как 61, петли и мелкие пуговицы|63=короткая планка со смещением|64=как 63, планка с обеих сторон|71=фигурная планка с потайной молнией|72=как 71, со смещением"),
  "пар_17": L("6=воротник-бабочка|7=воротник-бабочка|8=воротник-бабочка|9=воротник-бабочка|10=стойка для закрытой горловины"),
  "пар_18": L("4=корсет: изогнутый шов, шнуровка|5=корсет: прямой шов, шнуровка"),
  "пар_19": L("0=нет|1=шлица|2=разрез|3=встречная складка с подзором|4=встречная складка без подзора|5=двойная встречная складка"),
  "пар_20": L("1=очень выпуклые|2=выпуклые|3=средние|5=плоские|6=очень плоские"),
  "пар_22": L("0=нет|1=7 дюймов (18 см)|2=14 дюймов (36 см)|3=22 дюйма (56 см)|4=на всю длину|5=до линии талии"),
  "пар_022": L("0=нет|1=7 дюймов (18 см)|2=14 дюймов (36 см)|3=22 дюйма (56 см)|4=на всю длину|5=до линии талии"),
  "пар_23": L("0=без шва|1=изогнутый шов|2=прямой шов|3=шов с пуговицами"),
  "пар_24": L("5=трикотаж: рукав для боди|6=реглан цельнокроеный|7=реглан со швом по плечу|8=реглан с вытачкой на плече"),
  "пар_25": L("0=нет|1=левое|2=правое"),
  "пар_26": L("0=без манжет|11=манжета на 1 пуговицу, прямая|12=манжета на 1 пуговицу, срезанный угол|13=манжета на 1 пуговицу, закруглённая|21=манжета на 2 пуговицы, прямая|22=манжета на 2 пуговицы, срезанный угол|23=манжета на 2 пуговицы, закруглённая|31=трансформируемая манжета|32=манжета на 3 пуговицы, срезанный угол|33=манжета на 3 пуговицы, закруглённая|41=французская манжета, прямая|42=узкая манжета|43=французская манжета, закруглённая|51=закрытая манжета 3,2 см|52=закрытая манжета 6,4 см|53=закрытая манжета 10,2 см|61=цельнокроеная планка-обтачка 3,2 см|62=цельнокроеная планка-обтачка 6,4 см|63=цельнокроеная планка-обтачка 10,2 см|71=прямая планка 3,2 см|72=прямая планка 6,4 см|73=прямая планка 10,2 см|81=башенная планка 3,2 см|82=башенная планка 6,4 см|83=башенная планка 10,2 см"),
  "пар_27": L("0=шов переда|1=планка на пуговицах|2=молния|3=пуговицы по борту|5=без шва|6=короткая планка|7=короткая молния|8=короткая застёжка"),
  "пар_28": L("0=нет|1=шлица|2=разрез"),
  "пар_29": L("0=натуральная талия|1=завышенная (ампир)|2=высокая талия|3=заниженная, по высокой линии бёдер|4=заниженная, по низкой линии бёдер|5=сверхвысокая посадка|6=высокая посадка|7=средняя посадка|8=ниже средней посадки|9=низкая посадка|10=сверхнизкая посадка"),
  "пар_30": L("0=платье|1=блуза|2=жакет|3=пальто|5=платье или топ (Infinity)"),
  "пар_31": L("1=прямой|2=закруглённый|3=низ перед короче, спинка длиннее (вариант 1)|4=низ перед короче, спинка длиннее (вариант 2)|5=низ перед короче, спинка длиннее (вариант 3)|6=низ перед короче, спинка длиннее (вариант 4)|7=низ перед короче, спинка длиннее (вариант 5)|8=низ перед короче, спинка длиннее (вариант 6)|9=низ перед короче, спинка длиннее (вариант 7)|10=низ перед короче, спинка длиннее (вариант 8)|11=низ перед короче, спинка длиннее (вариант 9)|12=низ перед короче, спинка длиннее (вариант 10)|13=низ перед короче, спинка длиннее (вариант 11)|14=асимметричный перед|15=асимметричный перед 2|31=стандартный|32=современный закруглённый|33=удлинённая спинка|34=прямой|35=прямой с удлинённой спинкой|41=прямой|42=щиток|43=асимметричный (платок)|44=волнистый|51=низ трусов, вариант 1|52=низ трусов, вариант 2|53=низ трусов, вариант 3|54=низ трусов, вариант 4|55=низ трусов, вариант 5|61=прямой борт|62=закруглённый борт|63=скошенный борт"),
  "пар_32": L("0=нет|1=оба разреза|2=правый|3=левый|4=разрезы с молниями"),
  "пар_33": L("0=нет|1=оба|2=правый|3=левый"),
  "пар_34": L("0=прямые складки|1=складки «солнце»"),
  "пар_340": L("0=без отстрочки|1=с отстрочкой"),
  "пар_40": L("0=без бретелей|1=0,7 см|2=1,5 см|3=2 см|4=3 см|5=4 см|6=5 см"),
  "пар_401": L("0=без холтера|1=с завязками|2=на пуговицах у шеи"),
  "пар_41": L("0=без вытачек|1=с вытачками"),
  "пар_42": L("0=без чашек|1=с чашками"),
  "пар_43": L("0=без плечевых вытачек|1=с плечевыми вытачками"),
  "пар_44": L("0=нет|1=по боковому шву|2=по пройме|3=по низу|4=по плечевому шву|5=по горловине|6=по центру переда|7=по боковому шву от талии|8=по центру переда от талии"),
  "пар_45": L("0=боди|1=купальник"),
  "пар_46": L("1=облегающая (слим)|2=трапеция"),
  "пар_47": L("0=вытачки|1=по плечу|2=по пройме|3=от талии|4=на всю длину"),
  "пар_48": L("0=вытачки|1=по плечу|2=по пройме|3=от талии|4=на всю длину"),
  "пар_82": L("1=зауженный рукав боди|2=расширенный рукав боди|3=с открытыми плечами|4=с плечом"),
  "пар_161": L("0=без кокетки|1=кокетка переда"),
  "пар_171": L("0=цельнокроеный|1=втачной"),
  "пар_180": L("0=без кокетки|1=с кокеткой|11=кокетка с поясом|12=только кокетка"),
  "пар_181": L("0=без кокетки|1=горизонтальная|2=фигурная|3=вестерн|4=накладная кокетка (кандура)"),
  "пар_182": L("0=без складок|1=центральная складка|2=две складки|3=две параллельные складки до низа"),
  "пар_183": L("0=без вытачек|1=с вытачками на спинке"),
  "пар_230": L("0=вытачка|1=одна складка|2=две складки|3=без вытачек и складок"),
  "пар_241": L("0=без шва|1=шов без шлицы|2=шов со шлицей"),
  "пар_37": L("1=тканая|2=трикотаж"),
  "пар_140": L("1=около 3 см|2=около 6 см|3=около 10 см"),
  "пар_141": L("1=один оборот|2=два оборота|3=с пряжкой"),
  "пар_facing": L("0=без обтачек|1=обтачка горловины|2=обтачка проймы|3=обтачки горловины и проймы|4=цельная обтачка"),
  "facing": L("0=нет|1=горловина|2=пройма|3=горловина и пройма|4=цельная"),
  "facing_h": L("0=без обработки|1=подкладка капюшона|2=обтачка капюшона"),
  "facing_v": L("0=без обработки|1=цельнокроеный с резинкой|2=косая обтачка|3=окантовка|4=кружевная резинка"),
  "lining": L("0=без подкладки|1=с подкладкой"),
  "waistband": L("0=без пояса|1=цельный пояс"),
  "cuff": L("0=без манжет|1=резинка, цельнокроеная|2=резинка, отдельная манжета"),
  "elastic": L("0=без резинки|1=резинка в поясе|2=полностью на резинке"),
  "flare": L("1=средний клёш|2=большой клёш"),
  "flounce": L("0=без воланов|1=один волан|2=два волана|3=рюш|4=собранный волан|5=волан-платок|6=двойной волан-платок|7=волан «солнце»"),
  "ruche": L("1=пышный рукав, сборка на резинке|2=двухъярусный, сборка на резинке|3=трёхъярусный, сборка на резинке|11=пышный рукав, сборка в кулиске|21=двухъярусный, сборка в кулиске|31=трёхъярусный, сборка в кулиске"),
  "layer": L("1=один слой|2=два яруса|3=три яруса|4=четыре яруса|5=пять ярусов"),
  "loop": L("0=без шлёвок|1=со шлёвками"),
  "gender": L("1=женский|2=мужской"),
  "interfacing": L("0=без прокладки|1=с клеевой прокладкой"),
  "regulated": L("0=нерегулируемая|1=регулируемая бретель"),
  "waistdarts": L("0=без вытачек|1=с вытачками"),
  "ruffle": L("0=без волана|7=7 см|12=12 см|17=17 см"),
};
/** Группа и изделие из кода алгоритма (JPL10001 → женское платье, DMFT48001 → футболка для мальчика): схема кодов в docs/«Коды алгоритмов». */
function garmentFromTitle(title?: string): { group: string; item: string } | undefined {
  const base = (title ?? "").replace(/^.*[\\/]/, "").replace(/\.(rb|alg)$/i, "").toUpperCase();
  const m = /^(DD|DM|J|M|D)(PL|YB|BR|JK|JL|BL|RB|SV|FT|KR|PT|KM|RK|VR|MN|KN|PS|KP|BD|KU|TR)\d/.exec(base);
  return m ? { group: m[1], item: m[2] } : undefined;
}
const LEN_DRESS = "1=микро-мини|2=мини|3=выше колена|4=до колена|5=ниже колена|6=миди|7=чайная длина|8=до щиколотки|9=длинное|10=в пол|11=со шлейфом";
const LEN_BLOUSE = "1=до талии (топ)|2=укороченная|3=выше высокой линии бёдер|4=до высокой линии бёдер|5=до низкой линии бёдер|6=туника";
const LEN_TROUSERS = "1=шорты|2=шорты «ямайка»|3=бермуды|4=капри до колена|5=укороченные ниже колена|6=педал-пушеры|7=капри|8=до щиколотки|9=укороченные|10=полная длина|11=в пол";
const SIL_DRESS = "1=прямой|2=карандаш|3=А-силуэт|4=годе|5=клёш|6=сильный клёш|7=трапеция|8=шатёр|9=кокон";
const SIL_TROUSERS_W = "1=классические прямые|2=зауженные|3=клёш|4=широкие|5=палаццо|6=зауженные книзу (пег)";
const SIL_TROUSERS_M = "1=прямые|2=зауженные|3=клёш|4=свободные|5=стандартная посадка|6=зауженные книзу (пег)";
/** Подписи, зависящие от вида ткани (fabric_type) и вида изделия (пар_30), которые заданы константами вверху файла. */
function ctxLabels(key: string, an: Analysis): Record<number, string> | undefined {
  const ft = an.topConst.get("fabric_type"), kind = an.topConst.get("пар_30");
  if (key === "пар_1") {
    if (ft === 1) return L("1=тканая без растяжения|2=малая растяжимость|3=средняя растяжимость|4=высокая растяжимость|5=задаётся вручную");
    if (ft === 2) return L("1=малая растяжимость|2=средняя растяжимость|3=высокая растяжимость|4=очень высокая растяжимость|5=задаётся вручную");
  }
  const g = an.garment;
  if (key === "пар_15" && g?.item === "TR") return L("1=низкая|2=средняя|3=высокая");
  if (key === "facing_s") {
    if (g && g.item !== "RK") return L("0=подгиб проймы|1=окантовка проймы|2=закрытая окантовка проймы|3=обтачка проймы|4=подгиб с резинкой");
    return L("0=подгиб|1=манжета|2=окантовка");
  }
  if (g && key === "пар_3") {
    if (g.item === "PL" || g.item === "YB") return L(LEN_DRESS);
    if (g.item === "BR") return L(LEN_TROUSERS);
    if (g.item === "BL") return L(LEN_BLOUSE);
  }
  if (g && key === "пар_4") {
    if (g.item === "PL" || g.item === "BL") return L(SIL_DRESS);
    if (g.item === "BR") return L(g.group === "M" || g.group === "DM" ? SIL_TROUSERS_M : SIL_TROUSERS_W);
  }
  if (key === "пар_4" && (!g || g.item === "RB" || g.item === "FT" || g.item === "SV")) return L("1=слим|2=стандарт|3=классика");
  if (key === "пар_3" && !g) {
    if (kind === 0) return L("1=микро-мини|2=мини|3=выше колена|4=до колена|5=ниже колена|6=миди|7=чайная длина|8=до щиколотки|9=длинное|10=в пол");
    if (kind === 1) return L("1=до талии (топ)|2=укороченная|3=выше высокой линии бёдер|4=до высокой линии бёдер|5=до низкой линии бёдер|6=туника");
    if (kind === 5) return L("1=до подмышки|2=ампир|3=высокая талия|4=натуральная талия|5=до талии (топ)|6=укороченная|7=выше высокой линии бёдер|8=до высокой линии бёдер|9=до низкой линии бёдер|10=туника|11=микро-мини|12=мини|13=выше колена|14=до колена|15=ниже колена|16=миди|17=чайная длина|18=до щиколотки|19=длинное|20=в пол");
  }
  return undefined;
}
/** Название, значения и подсказка опции для заголовка скрипта: значения — те, на которые опирается сам файл (сравнения «равно»), плюс значение по умолчанию. */
const panty0 = (k: string, an: Analysis) => k === "пар_15" && an.garment?.item === "TR";
function optMeta(infoKey: string, an: Analysis, anKey: string, titleFallback?: string): Record<string, unknown> {
  const info = OPTION_INFO[infoKey];
  const meta: Record<string, unknown> = { option: true };
  const title = (panty0(infoKey, an) ? "Посадка трусов" : undefined) ?? (infoKey === "facing_s" && an.garment && an.garment.item !== "RK" ? "Обработка проймы" : undefined) ?? info?.title ?? EXTRA_TITLES[infoKey] ?? titleFallback;
  if (title) meta.title = title;
  const panty = infoKey === "пар_15" && an.garment?.item === "TR"; // у трусов пар_15 — посадка, её выбирает пользователь
  if (info?.hint && !panty) meta.hint = info.hint;
  if (info?.hidden && !panty) meta.hidden = true;
  const lab: Record<number, string> = { ...(OPT_LABELS[infoKey] ?? {}), ...(ctxLabels(infoKey, an) ?? {}) };
  const nums = new Set<number>();
  for (const v of info?.values ?? []) { if (Array.isArray(v)) { lab[v[0]] = v[1]; nums.add(v[0]); } else nums.add(v); }
  if (Object.keys(lab).length || info?.values) {
    for (const c of an.eqConsts.get(anKey) ?? []) nums.add(c);
    if (an.optDefaults.has(anKey)) nums.add(an.optDefaults.get(anKey)!);
    const vals = [...nums].sort((x, y) => x - y).map((n) => (lab[n] ? [n, lab[n]] : n));
    if (vals.length) meta.values = vals;
  }
  return meta;
}

/** Параметры, которые остаются просто значениями (мерки, служебные), а не выбираются пользователем. */
function isOptionName(n: string): boolean {
  return /^пар_/.test(n) || /^facing(_|$)/.test(n) || /^(fabric|ruffle|seam_allowance|lining|waistband|cuff|elastic|flare|flounce|ruche|layer|loop|gender|interfacing|regulated|waistdarts)$/.test(n);
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
  "SLEEVE CUFF": "Манжета рукава", "CUFF": "Манжета", "MAIN FABRIC": "Основная ткань", "FUSIBLE INTERFACING": "Клеевая прокладка", "RIB TRIMMING": "Рибана",
};
function ruPieceName(raw: string): string {
  const t = raw.trim();
  const noCut = /\bNO_CUT\b/.test(t);
  const base = t.replace(/\s*\bNO_CUT\b/, "").trim();
  const ru = PIECE_PHRASES[base] ?? base;
  void noCut; // NO_CUT («не кроить») — служебная пометка Leko, на чертеже не нужна
  return ru;
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
      case "дуга": return `arc(${all()})`;
      case "угол_т": return `angleAt(${all()})`; // угол при вершине: угол_т(A, B, C) — угол в точке B между лучами на A и на C
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
      const startAt = out.length;
      if (s.k === "assign") { if (!this.an.skip.has(s)) out.push(this.lhs(s.name, this.expr(s.expr), ind, true)); }
      else if (s.k === "command") out.push(/^ц_прекратить$/i.test(s.name) ? `${ind}break;` : `${ind}// (команда «${s.name}» из Leko не переносится)`);
      else if (s.k === "loop") {
        out.push(`${ind}for (;;) {`);
        out.push(...this.stmts(s.body, ind + "  "));
        out.push(`${ind}}`);
      }
      else if (s.k === "if") {
        s.branches.forEach((b, i) => {
          out.push(`${ind}${i === 0 ? "if" : "} else if"} (${this.expr(b.cond)}) {`);
          out.push(...this.stmts(b.body, ind + "  "));
        });
        if (s.els && s.els.length) { out.push(`${ind}} else {`); out.push(...this.stmts(s.els, ind + "  ")); }
        out.push(`${ind}}`);
      } else out.push(...this.proc(s.call, ind));
      // метка строки исходного файла (для .rb): потом превращается в таблицу «строка скрипта → строка файла» и убирается из текста
      if (s.line && out.length > startAt && !out[startAt].includes(LINE_MARK)) out[startAt] += `${LINE_MARK}${s.line}`;
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
      // сопряжение_д(точка1, угол1, точка2, угол2, радиус, число_шагов, результат) — дуга радиуса R, касательная к двум линиям
      case "сопряжение_д": return [assignOut(6, `filletArc(${e(0)}, ${e(1)}, ${e(2)}, ${e(3)}, ${e(4)})`)];
      case "напечатать": return [`${ind}// напечатать(…) — вывод в окно Leko не переносится`];
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
      case "симметрия_л": case "перенос": case "поворот": case "сжать": case "развести": {
        if (c.name === "развести" && !this.warnings.some((w) => w.startsWith("развести:"))) this.warnings.push("развести: сделано упрощённо — при угле разведения 0 объекты не меняются, иначе поворачиваются вокруг начала линии на этот угол. Сверьте с Leko.");
        const items = a[0]?.k === "paren" ? (a[0] as Extract<Expr, { k: "paren" }>).items : a[0] ? [a[0]] : [];
        const src = items.map((x) => this.expr(x)).join(", ");
        const targets = suffixTargets(c, this.warnings);
        const fn = c.name === "развести" ? `spread([${src}], ${a[1] ? this.expr(a[1], true) : "undefined"}, ${e(2)}, ${e(3)}, ${e(4)})` : c.name === "сжать" ? `squeeze([${src}], ${e(1)}, ${e(2)}, ${e(3)}, ${e(4)})` : c.name === "симметрия_л" ? `mirror([${src}], ${e(1)})` : c.name === "перенос" ? `translate([${src}], ${e(1)})` : `rotate([${src}], ${e(1)}, ${e(2)})`;
        if (targets.filter((t) => t).length === 0) return [`${ind}${fn};`];
        const names = targets.map((t) => (t === null ? "" : this.name(t)));
        names.forEach((n) => n && this.declared.add(n));
        return [`${ind}[${names.join(", ")}] = ${fn};`];
      }
      case "удалить": { const nm = outName(0); return nm ? [`${ind}${this.name(nm)} = undefined;`] : []; }
      case "нарисовать_текст": return [`${ind}${this.call(c)};`];
      case "отрезок": case "ломаная": case "точка": case "сплайн_к": case "сплайн_кк": case "сплайн_д": case "дуга": {
        // в Leko оператор без присваивания просто рисует линию/точку; у нас рисуются значения переменных — даём имя
        // сплайн без имени получает в Leko имя «С_<точка1>_<точка2>» — на него потом ссылаются (С_Б_Т2.ф2)
        const auto = autoSplineName(c);
        if (auto) return [this.lhs(auto, this.call(c), ind, false)];
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
  return buildFromProg(prog, warnings, opts, "Leko");
}

/** Общая часть перевода: из разобранной программы (из .ALG или .rb) — в наш скрипт. */
export function buildFromProg(prog: Stmt[], warnings: string[], opts: { title?: string; inputsAsConstants?: boolean } = {}, src: "Leko" | "Ruby" = "Leko"): AlgImportResult {
  const an = analyse(prog);
  an.garment = garmentFromTitle(opts.title);
  const gen = new Gen(an, warnings);

  // тело программы
  const body = gen.stmts(prog, "");

  // входные параметры
  const inputNames = [...an.inputs].filter((n) => !an.optional.has(n));
  const inputs: AlgInput[] = inputNames.map((n) => { const d = inferDefault(n, an); return { name: n, default: d.value, note: d.note }; });
  const head: string[] = [];
  head.push(`// Построение, переведённое из файла ${src === "Ruby" ? "Ruby (.rb)" : "Leko"}${opts.title ? " «" + opts.title + "»" : ""}.`);
  head.push("// Операторы — английские (point, layOff, intersectDirections, writePiece…); имена переменных — латиницей (транслит исходных: п1 → p1, пар_5 → opt_5).");
  // Опция — только то, что в файле проверяется через существует(пар_N): значит, пользователь может его выбрать.
  // Параметр, который просто прописан значением и нигде не переключается, опцией не считаем — это обычное значение.
  const optNames = inputNames.filter((n) => isOptionName(n) && an.existsNames.has(n));
  const constNames = inputNames.filter((n) => !optNames.includes(n));
  if (constNames.length && opts.inputsAsConstants) {
    // значения, которые не выбирает пользователь (мерки, служебные), — одной строкой; при желании правятся прямо в коде
    head.push("//");
    head.push("// Значения, которые в Leko приходили снаружи (рост, обхват груди…), — одной строкой; при желании поправьте здесь.");
    // + все мерки типовых фигур детей и мужчин (ГОСТ): иначе построение для детей берёт rz53, rz20… константами и не строится
    const measureKeys = new Set([...Object.keys(DEFAULT_MEASUREMENTS_W_164_96_104), "rz1", "rz16", "rz18", ...[...BOY_LABELS, ...GIRL_LABELS, ...MEN_LABELS].map((n) => "rz" + n)]);
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
      const meta = optMeta(n, an, n);
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
    // Прибавки ease_*, которые покупатель может задать сам: есть существует(ease_X), диапазон _min/_max и pattern_…
    const userEases = hoisted.filter((n) => /^ease_/.test(n) && an.existsNames.has(n) && an.easeMin.has(n) && an.easeMax.has(n) && an.patterns.has(n.replace(/^ease_/, "")));
    // Припуски, которые покупатель может менять: есть существует(X) и объявление spec_X_max (spec_hem_max, spec_hem_poc_max…)
    const userAllowances = hoisted.filter((n) => n !== "seam_allowance" && an.existsNames.has(n) && an.allNames.has("spec_" + n + "_max"));
    const plain = hoisted.filter((n) => !/^import_/.test(gen.name(n)) && !userEases.includes(n) && !userAllowances.includes(n));
    if (plain.length) head.push("let " + plain.map((n) => gen.name(n)).join(", ") + ";");
    if (userEases.length && opts.inputsAsConstants) {
      head.push("");
      head.push("// Прибавки, которые можно задать (в Leko — ease_*): значение приходит снаружи в пределах ease_*_min … ease_*_max; не задано — считается по умолчанию.");
      for (const n of userEases) {
        const pat = an.patterns.get(n.replace(/^ease_/, ""))!;
        const meta: Record<string, unknown> = { title: easeTitle(n), pattern: gen.name(pat) };
        const cons = an.easeConsumer.get(n);
        if (cons) meta.consumer = gen.name(cons);
        const u = /_unit_(cm|pc)$/.exec(pat);
        if (u) meta.unit = u[1] === "cm" ? "см" : "шт";
        else if (/shrinkage|compression/.test(n)) meta.unit = "%";
        head.push(`let ${gen.name(n)} = userEase(${JSON.stringify(gen.name(n))}, ${JSON.stringify(meta)});`);
      }
    } else if (userEases.length) head.push("let " + userEases.map((n) => gen.name(n)).join(", ") + ";");
    if (userAllowances.length && opts.inputsAsConstants) {
      head.push("");
      head.push("// Припуски, которые можно задать (в Leko объявляются spec_*_max): значение приходит снаружи в пределах 0 … spec_*_max; не задано — считается по умолчанию.");
      for (const n of userAllowances) head.push(`let ${gen.name(n)} = userAllowance(${JSON.stringify(gen.name(n))});`);
    } else if (userAllowances.length) head.push("let " + userAllowances.map((n) => gen.name(n)).join(", ") + ";");
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
          const meta = optMeta(base, an, n, gn.replace(/^import_/, ""));
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
  let script = head.join("\n") + "\n\n" + bodyText + "\n";
  let lineMap: number[] | undefined;
  if (script.includes(LINE_MARK)) {
    lineMap = [];
    script = script.split("\n").map((ln) => {
      const k = ln.indexOf(LINE_MARK);
      if (k < 0) { lineMap!.push(0); return ln; }
      lineMap!.push(Number(ln.slice(k + 1)) || 0);
      return ln.slice(0, k);
    }).join("\n");
  }

  if (gen.unknownOps.size) warnings.push(`Операторы без перевода (оставлены как есть, при запуске будут ошибкой): ${[...gen.unknownOps].join(", ")}.`);
  if (gen.ignoredParams.size) warnings.push(`В ЗАПИСАТЬ не перенесены параметры: ${[...gen.ignoredParams].join(", ")} (усадка, коды уголков, количество деталей — пока не поддерживаются).`);
  const unknownDefaults = inputs.filter((i) => i.note.startsWith("значение неизвестно"));
  if (unknownDefaults.length) warnings.push(`Для ${unknownDefaults.length} входных параметров значение по умолчанию неизвестно (поставлен 0): ${unknownDefaults.map((i) => i.name).join(", ")}.`);
  return { script, warnings, inputs, stats: { statements: gen.statements, variables: an.allNames.size, pieces: gen.pieces }, lineMap };
}

/** Декодирует байты файла .ALG: Leko хранит текст в Windows-1251; если файл в UTF-8 — берём его. */
export function decodeAlg(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1251").decode(bytes); }
}
