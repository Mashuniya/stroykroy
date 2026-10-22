import { buildFromProg, type AlgImportResult, type Expr, type Stmt, type Tok } from "./alg-import.js";

/**
 * Читатель алгоритмов на Ruby (.rb) — тот самый «ваш» формат: русские операторы Leko, присваивание «=», условия if/elsif/else/end,
 * квадратные скобки как скобки, результат процедурных операторов последним аргументом, циклы Ц_начало … ц_конец, require.
 * Разбирает текст в то же дерево, что и переводчик .ALG, и дальше работает общий переводчик (buildFromProg),
 * поэтому всё, что умеет переводчик .ALG (опции, прибавки ease_*, спеки, детали), работает и для .rb.
 *
 * Отличия от .ALG, которые учтены:
 *  • rz_N → рз_N, par_N → пар_N (так их знает общий переводчик); регистр букв в именах не важен (как в Leko);
 *  • длн(а, б) = [а:б].л, напр / напр1 / напр2 = .ф / .ф1 / .ф2; «~имя» = существует(имя); ==, !=, <=, >= → равно/не/больше/меньше;
 *  • сплайн_к_100(…) = сплайн_к[100](…) (число — количество шагов), записать(…) = ЗАПИСАТЬ(…);
 *  • require "parts/файл.rb" — вставляется текст файла на этом месте (см. loadRb); номера строк запоминаются для перехода в VS Code.
 */

// ====================================================================== require и номера строк

/** Участок объединённого текста: строки объединённого текста start … start+count-1 — это строки файла с fileLine. */
export interface RbSegment { file: string; start: number; fileLine: number; count: number }
export interface RbSource { text: string; segments: RbSegment[]; missing: string[] }

/** Читает .rb-файл вместе со всеми require "…" (каждый файл один раз, как в Ruby) и склеивает в один текст. */
export async function loadRb(mainFile: string, read: (file: string) => Promise<string>): Promise<RbSource> {
  const lines: string[] = [];
  const segments: RbSegment[] = [];
  const missing: string[] = [];
  const seen = new Set<string>([mainFile]);
  const add = (file: string, fileLine: number, text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.file === file && last.fileLine + last.count === fileLine && last.start + last.count === lines.length + 1) last.count++;
    else segments.push({ file, start: lines.length + 1, fileLine, count: 1 });
    lines.push(text);
  };
  const expand = async (file: string, text: string, depth: number): Promise<void> => {
    const src = text.split(/\r?\n/);
    for (let i = 0; i < src.length; i++) {
      const m = /^\s*require\s*\(?\s*["']([^"']+)["']\s*\)?\s*(#.*)?$/.exec(src[i]);
      if (m && depth < 8) {
        const target = m[1];
        if (!seen.has(target)) {
          seen.add(target);
          try { await expand(target, await read(target), depth + 1); } catch { missing.push(target); add(file, i + 1, `# (не найден файл ${target})`); }
        }
        continue;
      }
      add(file, i + 1, src[i]);
    }
  };
  await expand(mainFile, await read(mainFile), 0);
  return { text: lines.join("\n"), segments, missing };
}

/** Строка объединённого текста → файл и строка в нём. */
export function rbWhere(segments: RbSegment[], line: number): { file: string; line: number } | null {
  for (const s of segments) if (line >= s.start && line < s.start + s.count) return { file: s.file, line: s.fileLine + (line - s.start) };
  return null;
}

// ====================================================================== лексер

interface RbTok extends Tok { line: number }
const isLetter = (c: string) => /[\p{L}_]/u.test(c);
const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c);

function lexRb(src: string): RbTok[] {
  const toks: RbTok[] = [];
  let i = 0, line = 1, pending: string[] = [];
  const n = src.length;
  const push = (t: Tok["t"], v: string, pos: number) => { toks.push({ t, v, pos, comments: pending, line }); pending = []; };
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") {
      let j = i + 1; while (j < n && src[j] !== "\n") j++;
      const text = src.slice(i + 1, j).trim();
      if (text) pending.push(text);
      i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n && src[j] !== c && src[j] !== "\n") j++;
      push("str", src.slice(i + 1, j), i); i = j + 1; continue;
    }
    const prev = toks[toks.length - 1];
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? "") && !(prev && (prev.t === "id" || prev.v === ")" || prev.v === "]")))) {
      let j = i; while (j < n && /\d/.test(src[j])) j++;
      if (src[j] === "." && /\d/.test(src[j + 1] ?? "")) { j++; while (j < n && /\d/.test(src[j])) j++; }
      push("num", src.slice(i, j), i); i = j; continue;
    }
    if (isLetter(c)) { let j = i; while (j < n && isWord(src[j])) j++; push("id", src.slice(i, j), i); i = j; continue; }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { push("p", two, i); i += 2; continue; }
    if ("+-*/()[],.=<>!~".includes(c)) { push("p", c, i); i++; continue; }
    i++; // неизвестный символ пропускаем
  }
  push("eof", "", n);
  return toks;
}

// ====================================================================== разбор

const KW_END = new Set(["end", "else", "elsif", "ц_конец"]);

class RbParser {
  i = 0;
  constructor(private toks: RbTok[], private warnings: string[]) {}
  get cur() { return this.toks[this.i]; }
  peek(o = 1) { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  is(v: string) { return this.cur.t === "p" && this.cur.v === v; }
  kw(v: string) { return this.cur.t === "id" && this.cur.v.toLowerCase() === v; }
  next() { return this.toks[this.i++]; }
  where() { return ` (строка ${this.cur.line})`; }
  expect(v: string) {
    if (this.cur.v !== v) throw new Error(`ожидалось «${v}», найдено «${this.cur.v || "конец файла"}»${this.where()}`);
    this.i++;
  }

  program(): Stmt[] { return this.statements(); }

  statements(): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      const c = this.cur;
      if (c.t === "eof") break;
      if (c.t === "id" && KW_END.has(c.v.toLowerCase())) break;
      const startI = this.i;
      try {
        out.push(this.statement());
      } catch (e) {
        this.warnings.push(`Разбор: ${(e as Error).message} — оператор пропущен.`);
        // пропускаем до следующей строки: первый токен, стоящий на другой строке
        const bad = this.toks[Math.max(startI, 0)].line;
        if (this.i <= startI) this.i = startI + 1;
        while (this.cur.t !== "eof" && this.cur.line <= bad && !(this.cur.t === "id" && KW_END.has(this.cur.v.toLowerCase()))) this.i++;
      }
    }
    return out;
  }

  statement(): Stmt {
    const c = this.cur, comments = c.comments, line = c.line;
    if (this.kw("if")) return this.ifStmt(comments, line);
    if (this.kw("ц_начало")) {
      this.i++;
      const body = this.statements();
      if (!this.kw("ц_конец")) throw new Error("не найдено «ц_конец»" + this.where());
      this.i++;
      return { k: "loop", body, comments, line };
    }
    if (c.t === "id" && c.v === "require" && this.peek().t === "str") { this.i += 2; return { k: "command", name: "require", comments, line }; }
    if (c.t === "id" && this.peek().t === "p" && this.peek().v === "=") {
      const name = this.next().v; this.i++;
      return { k: "assign", name, expr: this.expr(), comments, line };
    }
    if (c.t === "id" && this.peek().t === "p" && this.peek().v === "(") {
      const e = this.expr();
      if (e.k !== "call") throw new Error("ожидался вызов оператора" + this.where());
      return { k: "call", call: e, comments, line };
    }
    if (c.t === "id") { this.i++; return { k: "command", name: c.v, comments, line }; }
    throw new Error(`неожиданный символ «${c.v}»${this.where()}`);
  }

  ifStmt(comments: string[], line: number): Stmt {
    this.i++; // if
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    let els: Stmt[] | null = null;
    branches.push({ cond: this.expr(), body: this.statements() });
    for (;;) {
      if (this.kw("elsif")) { this.i++; branches.push({ cond: this.expr(), body: this.statements() }); }
      else if (this.kw("else")) { this.i++; els = this.statements(); }
      else break;
    }
    if (!this.kw("end")) throw new Error("не найдено «end» у условия" + this.where());
    this.i++;
    return { k: "if", branches, els, comments, line };
  }

  // приоритеты: || < && < сравнения < + - < * / < унарные < постфикс
  expr(): Expr { return this.or(); }
  or(): Expr {
    let l = this.and();
    while (this.is("||")) { this.i++; l = { k: "bin", op: "||", l, r: this.and() }; }
    return l;
  }
  and(): Expr {
    let l = this.cmp();
    while (this.is("&&")) { this.i++; l = { k: "bin", op: "&&", l, r: this.cmp() }; }
    return l;
  }
  cmp(): Expr {
    let l = this.add();
    for (;;) {
      const t = this.cur;
      if (t.t !== "p" || !["==", "!=", "<", ">", "<=", ">="].includes(t.v)) break;
      this.i++;
      const r = this.add();
      const eq = (): Expr => ({ k: "call", name: "равно", args: [l, r] });
      if (t.v === "==") l = eq();
      else if (t.v === "!=") l = { k: "un", op: "!", x: eq() };
      else if (t.v === "<") l = { k: "bin", op: "<", l, r };
      else if (t.v === ">") l = { k: "bin", op: ">", l, r };
      else if (t.v === "<=") l = { k: "un", op: "!", x: { k: "bin", op: ">", l, r } };
      else l = { k: "un", op: "!", x: { k: "bin", op: "<", l, r } };
    }
    return l;
  }
  add(): Expr {
    let l = this.mul();
    while (this.cur.t === "p" && (this.cur.v === "+" || this.cur.v === "-")) { const op = this.next().v; l = { k: "bin", op, l, r: this.mul() }; }
    return l;
  }
  mul(): Expr {
    let l = this.unary();
    while (this.cur.t === "p" && (this.cur.v === "*" || this.cur.v === "/")) { const op = this.next().v; l = { k: "bin", op, l, r: this.unary() }; }
    return l;
  }
  unary(): Expr {
    if (this.cur.t === "p" && (this.cur.v === "-" || this.cur.v === "+")) { const op = this.next().v; return { k: "un", op, x: this.unary() }; }
    if (this.is("!")) { this.i++; return { k: "un", op: "!", x: this.unary() }; }
    if (this.is("~")) { this.i++; return { k: "call", name: "существует", args: [this.unary()] }; }
    return this.postfix();
  }
  postfix(): Expr {
    let e = this.primary();
    while (this.is(".") && this.peek().t === "id") { this.i++; e = { k: "prop", obj: e, prop: this.next().v }; }
    return e;
  }
  args(): Expr[] {
    const out: Expr[] = [];
    this.expect("(");
    if (!this.is(")")) {
      for (;;) {
        if (this.cur.t === "id" && this.peek().t === "p" && this.peek().v === "=") { // именованный параметр (записать)
          const name = this.next().v; this.i++;
          out.push({ k: "named", name, value: this.expr() });
        } else out.push(this.expr());
        if (this.is(",")) { this.i++; continue; }
        break;
      }
    }
    this.expect(")");
    return out;
  }
  primary(): Expr {
    const c = this.cur;
    if (c.t === "num") { this.i++; return { k: "num", v: c.v.startsWith(".") ? "0" + c.v : c.v }; }
    if (c.t === "str") { this.i++; return { k: "str", v: c.v }; }
    if (c.t === "p" && (c.v === "(" || c.v === "[")) { // скобки группировки и списки — одно и то же «paren», как в .ALG
      const close = c.v === "(" ? ")" : "]";
      this.i++;
      const items: Expr[] = [];
      if (!this.is(close)) for (;;) { items.push(this.expr()); if (this.is(",")) { this.i++; if (this.is(close)) break; continue; } break; }
      this.expect(close);
      return { k: "paren", items };
    }
    if (c.t === "id") {
      this.i++;
      if (this.is("(")) return callOf(c.v, this.args());
      return { k: "id", name: c.v };
    }
    throw new Error(`в выражении неожиданный символ «${c.v || "конец файла"}»${this.where()}`);
  }
}

/** Вызов оператора: приводит имена Ruby-варианта к тем, что знает общий переводчик. */
function callOf(name: string, args: Expr[]): Expr {
  const low = name.toLowerCase();
  const seg = (): Expr => ({ k: "seg", a: args[0], b: args[1] });
  if (low === "длн" && args.length === 2) return { k: "prop", obj: seg(), prop: "л" };
  if (low === "напр" && args.length === 2) return { k: "prop", obj: seg(), prop: "ф" };
  if (low === "напр1" && args.length === 2) return { k: "prop", obj: seg(), prop: "ф1" };
  if (low === "напр2" && args.length === 2) return { k: "prop", obj: seg(), prop: "ф2" };
  if (low === "записать") return { k: "call", name: "ЗАПИСАТЬ", args };
  const sp = /^(сплайн_к|сплайн_кк|сплайн_д)_(\d+)$/.exec(low);
  if (sp) return { k: "call", name: sp[1], bracket: sp[2], args };
  return { k: "call", name, args };
}

/** rz_N → рз_N, par_N → пар_N — так эти имена знает общий переводчик. */
function normName(v: string): string {
  let r = v.toLowerCase();
  r = r.replace(/^rz_?(\d+)$/, "рз_$1");
  r = r.replace(/(^|_)par_/g, "$1пар_");
  return r;
}

/** Переводит текст алгоритма на Ruby в наш скрипт. lineMap — строки скрипта → строки (объединённого) текста. */
export function rbToScript(source: string, opts: { title?: string; inputsAsConstants?: boolean } = {}): AlgImportResult {
  const warnings: string[] = [];
  const toks = lexRb(source);
  // В Leko регистр букв в именах переменных не важен; имена операторов (перед «(») не трогаем
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id") continue;
    const nx = toks[i + 1];
    if (nx && nx.t === "p" && nx.v === "(") continue;
    t.v = normName(t.v);
  }
  const prog = new RbParser(toks, warnings).program();
  const res = buildFromProg(prog, warnings, opts, "Ruby");
  // команда «размеры» и require — не ошибки
  res.warnings = res.warnings.filter((w) => true && w !== "");
  return res;
}
