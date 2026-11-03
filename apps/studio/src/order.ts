import type { Cell, Sheet } from "./xlsxLite";

/**
 * «Заказ»: набор алгоритмов (основа, рукав, воротник…), набор опций и набор прибавок/припусков для конкретного изделия.
 * Хранится в .xlsx (листы «Заказ», «Опции», «Прибавки», «Мерки»): его можно открыть в Excel, поправить значения и загрузить обратно.
 */
export interface OrderOut {
  title: string; date: string;
  baseCode: string; baseName: string;
  roles: { title: string; code: string; note: string }[];
  linked: string[];
  figureId: string; seam: number; seamOn: boolean; height: number; bust: number;
  options: { algo: string; code: string; title: string; value: number; label: string }[];
  eases: { code: string; title: string; value: number; min: number | null; max: number | null; unit: string }[];
  allowances: { code: string; title: string; value: number; max: number }[];
  measures: { code: string; title: string; value: number }[];
}

const SH_ORDER = "Заказ", SH_OPT = "Опции", SH_EASE = "Прибавки", SH_MEAS = "Мерки";

export function buildOrderSheets(o: OrderOut): Sheet[] {
  const order: Cell[][] = [
    ["Параметр", "Значение", "Пояснение"],
    ["Название заказа", o.title, "любое: клиент, номер заказа"],
    ["Дата", o.date, ""],
    ["Основа", o.baseCode, o.baseName],
    ...o.roles.map((r): Cell[] => [r.title, r.code, r.note]),
    ["Подключается по опциям", o.linked.join(", "), "пояс, манжета и т. п.: появляются сами, когда в «Опциях» выбраны нужные значения (только для сведения)"],
    ["Типовая фигура", o.figureId, "если «свои мерки» — значения на листе «Мерки»"],
    ["Рост, см", o.height, ""],
    ["Обхват груди, см", o.bust, ""],
    ["Припуск на швы, см", o.seamOn ? o.seam : 0, "0 — без припусков"],
  ];
  const opts: Cell[][] = [["Алгоритм", "Код опции", "Название", "Значение", "Что это значение"], ...o.options.map((x): Cell[] => [x.algo, x.code, x.title, x.value, x.label])];
  const eases: Cell[][] = [["Вид", "Код", "Название", "Значение", "От", "До", "Ед."],
    ...o.eases.map((e): Cell[] => ["прибавка", e.code, e.title, e.value, e.min, e.max, e.unit]),
    ...o.allowances.map((a): Cell[] => ["припуск", a.code, a.title, a.value, 0, a.max, "см"])];
  const meas: Cell[][] = [["Код", "Название", "Значение, см"], ...o.measures.map((m): Cell[] => [m.code, m.title, m.value])];
  return [
    { name: SH_ORDER, rows: order, widths: [28, 26, 70] },
    { name: SH_OPT, rows: opts, widths: [22, 18, 38, 12, 34] },
    { name: SH_EASE, rows: eases, widths: [12, 36, 40, 12, 10, 10, 8] },
    { name: SH_MEAS, rows: meas, widths: [12, 44, 14] },
  ];
}

export interface OrderIn {
  title: string; baseCode: string;
  roles: Record<string, string>; // название вида («Рукав») → код алгоритма или ""
  figureId: string; seam: number | null; height: number | null; bust: number | null;
  options: { algo: string; code: string; value: number }[];
  eases: { code: string; value: number }[];
  allowances: { code: string; value: number }[];
  measures: Record<string, number>;
}

const str = (c: Cell): string => (c === null || c === undefined ? "" : String(c).trim());
const num = (c: Cell): number | null => { if (typeof c === "number") return Number.isFinite(c) ? c : null; const n = Number(str(c).replace(",", ".")); return str(c) !== "" && Number.isFinite(n) ? n : null; };
const sheetOf = (sheets: Sheet[], name: string) => sheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());

export function parseOrderSheets(sheets: Sheet[]): OrderIn {
  const ord = sheetOf(sheets, SH_ORDER);
  if (!ord) throw new Error(`В файле нет листа «${SH_ORDER}» — это не заказ СтройКрой`);
  const kv = new Map<string, Cell>(); const roles: Record<string, string> = {};
  const ROLE = new Set(["рукав", "воротник", "другой элемент", "доп. элементы"]);
  for (const r of ord.rows.slice(1)) {
    const k = str(r[0]); if (!k) continue;
    kv.set(k.toLowerCase(), r[1]);
    if (ROLE.has(k.toLowerCase())) roles[k] = str(r[1]);
  }
  const baseCode = str(kv.get("основа"));
  if (!baseCode) throw new Error("В листе «Заказ» не указана основа");
  const opts = sheetOf(sheets, SH_OPT)?.rows.slice(1).map((r) => ({ algo: str(r[0]), code: str(r[1]), value: num(r[3]) })).filter((x): x is { algo: string; code: string; value: number } => !!x.code && x.value !== null) ?? [];
  const eases: OrderIn["eases"] = [], allowances: OrderIn["allowances"] = [];
  for (const r of sheetOf(sheets, SH_EASE)?.rows.slice(1) ?? []) {
    const kind = str(r[0]).toLowerCase(), code = str(r[1]), v = num(r[3]);
    if (!code || v === null) continue;
    if (kind.startsWith("припуск")) allowances.push({ code, value: v }); else if (kind.startsWith("прибав")) eases.push({ code, value: v });
  }
  const measures: Record<string, number> = {};
  for (const r of sheetOf(sheets, SH_MEAS)?.rows.slice(1) ?? []) { const code = str(r[0]), v = num(r[2]); if (code && v !== null) measures[code] = v; }
  return {
    title: str(kv.get("название заказа")), baseCode, roles,
    figureId: str(kv.get("типовая фигура")), seam: num(kv.get("припуск на швы, см") ?? null),
    height: num(kv.get("рост, см") ?? null), bust: num(kv.get("обхват груди, см") ?? null),
    options: opts, eases, allowances, measures,
  };
}

const norm = (s: string) => s.trim().toUpperCase();
/** Алгоритм по коду: имя совпадает или оканчивается кодом («Рукав WSL21001»), либо это файл в базе (WSL21001.rb). */
export function findByCode<T extends { name: string; repoFile?: string; kind?: string }>(list: T[], code: string, kinds?: string[]): T | undefined {
  const c = norm(code.replace(/\.(rb|alg)$/i, ""));
  if (!c) return undefined;
  const pool = kinds ? list.filter((x) => kinds.includes(x.kind ?? "base")) : list;
  const base = (x: T) => norm((x.repoFile ?? "").replace(/^.*\//, "").replace(/\.(rb|alg)$/i, ""));
  return pool.find((x) => norm(x.name) === c) ?? pool.find((x) => base(x) === c) ?? pool.find((x) => norm(x.name).endsWith(" " + c));
}
