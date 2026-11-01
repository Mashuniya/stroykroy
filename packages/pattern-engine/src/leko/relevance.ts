/**
 * Какие опции (input с option) вообще влияют на выкройку.
 * Построение разбирается построчно: каждое присваивание «переменная ← то, что читается справа, и условия блоков, в которых оно стоит».
 * Стоки — детали (writePiece), размеры изделия (spec) и export_*. Опция важна, если от неё есть путь к стоку.
 * Учитываются только те блоки if/else, которые при этом запуске реально выполнились (их помечает __cov), —
 * поэтому, например, опция обработки низа рукава не показывается, пока рукав не выбран, а ширина молнии — пока нет молнии.
 */
const CONTROL = /^(\s*)(\}\s*)?(else\s+if\s*\(.*\)|if\s*\(.*\)|else|for\s*\(.*\)|while\s*\(.*\))\s*\{\s*$/;
const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const ID = /[A-Za-z_$][\w$]*/g;

/** Метит выполненные блоки: в конец строки с «{» у if/else/for/while добавляется вызов __cov(номер строки). Число строк не меняется. */
export function instrumentCoverage(code: string): string {
  return code.split("\n").map((l, i) => (CONTROL.test(l) ? l.replace(/\{\s*$/, `{ __cov(${i});`) : l)).join("\n");
}

const ids = (s: string): string[] => s.match(ID) ?? [];
const clean = (s: string): string => s.replace(STR, '""').replace(/\/\/.*$/, "");
const balance = (s: string): number => { let b = 0; for (const ch of s) { if (ch === "(" || ch === "[" || ch === "{") b++; else if (ch === ")" || ch === "]" || ch === "}") b--; } return b; };
function splitTop(s: string): string[] {
  const out: string[] = []; let d = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") d++; else if (ch === ")" || ch === "]" || ch === "}") d--;
    if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function relevantNames(code: string, hits: Set<number>): Set<string> | null {
  const lines = code.split("\n");
  const deps = new Map<string, Set<string>>();
  const sinks = new Set<string>();
  let hasPieceSink = false;
  type Blk = { ids: Set<string>; hit: boolean };
  const stack: Blk[] = [];
  let lastPopped: Set<string> = new Set();
  const addDep = (name: string, from: Iterable<string>) => { let s = deps.get(name); if (!s) deps.set(name, (s = new Set())); for (const x of from) s.add(x); };
  const condIds = (): string[] => { const r: string[] = []; for (const b of stack) b.ids.forEach((x) => r.push(x)); return r; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("//")) continue;
    const m = CONTROL.exec(raw);
    if (m) {
      const closes = !!m[2];
      if (closes) lastPopped = stack.pop()?.ids ?? new Set();
      const head = clean(m[3]);
      const inner = head.slice(head.indexOf("(") + 1, head.lastIndexOf(")"));
      const cond = new Set<string>(head.startsWith("else") && closes ? lastPopped : []);
      if (head.startsWith("if") || head.startsWith("else if") || head.startsWith("while")) ids(inner).forEach((x) => cond.add(x));
      else if (head.startsWith("else")) lastPopped.forEach((x) => cond.add(x));
      stack.push({ ids: cond, hit: hits.has(i) });
      continue;
    }
    if (t === "}") { lastPopped = stack.pop()?.ids ?? new Set(); continue; }
    // обычный оператор — может занимать несколько строк
    let stmt = clean(raw);
    let j = i;
    while (balance(stmt) > 0 && j + 1 < lines.length) { j++; stmt += "\n" + clean(lines[j]); }
    i = j;
    if (stack.some((b) => !b.hit)) continue; // блок не выполнялся — оператор не работал
    const s = stmt.trim().replace(/^(let|const|var)\s+/, "");
    const cond = condIds();
    if (/^(writePiece|spec)\s*\(/.test(s)) { ids(s).forEach((x) => sinks.add(x)); cond.forEach((x) => sinks.add(x)); if (s.startsWith("writePiece")) hasPieceSink = true; continue; }
    const dm = /^\[([^\]]*)\]\s*=(?!=)([\s\S]*)$/.exec(s);
    if (dm) { const r = [...ids(dm[2]), ...cond]; for (const n of ids(dm[1])) { addDep(n, r); if (/^export_/.test(n)) sinks.add(n); } continue; }
    for (const part of splitTop(s)) {
      const am = /^\s*([A-Za-z_$][\w$]*)\s*(?:[+\-*/]?=)(?!=)([\s\S]*)$/.exec(part);
      if (!am) continue;
      addDep(am[1], [...ids(am[2]), ...cond]);
      if (/^export_/.test(am[1])) sinks.add(am[1]);
    }
  }
  if (!hasPieceSink) return null; // деталей нет (элемент отдаёт только значения) — ничего не скрываем
  const seen = new Set<string>(); const q = [...sinks];
  while (q.length) { const x = q.pop()!; if (seen.has(x)) continue; seen.add(x); deps.get(x)?.forEach((y) => { if (!seen.has(y)) q.push(y); }); }
  return seen;
}
