import type { OrderIn, OrderOut } from "./order";

/**
 * Сохранённая модель: снимок «Заказа» (основа, элементы, опции, прибавки, припуски, мерки) с кодом «АЛГОРИТМ_00001».
 * Хранится в браузере; отмеченные галочкой «В каталог на сайте» попадают в файл каталога для сайта.
 */
export interface SavedModel {
  id: string;
  code: string;       // JBD41001_00001
  baseCode: string;   // JBD41001
  title: string;      // название для себя, можно оставить пустым
  created: string;    // ISO-дата
  snapshot: OrderOut;
  publish: boolean;   // отправлять на сайт (в каталог)
  paramText?: string; // список «имя = значение», из которого собрана модель (вкладка «Модели» → «Параметры списком»)
}

const KEY = "stroykroy.models1";

export function loadModels(): SavedModel[] {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
}
export function saveModels(list: SavedModel[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* хранилище недоступно — работа не должна падать */ }
}

/** Следующий код модели для этого алгоритма: JBD41001_00001, JBD41001_00002… */
export function nextModelCode(list: SavedModel[], baseCode: string): string {
  const esc = baseCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + esc + "_(\\d+)$", "i");
  const n = list.reduce((m, x) => { const r = re.exec(x.code); return r ? Math.max(m, Number(r[1])) : m; }, 0) + 1;
  return `${baseCode}_${String(n).padStart(5, "0")}`;
}

/** Снимок → то, что умеет применять «Загрузить заказ». */
export function snapshotToOrderIn(o: OrderOut): OrderIn {
  return {
    title: o.title, baseCode: o.baseCode,
    roles: Object.fromEntries(o.roles.map((r) => [r.title, r.code])),
    figureId: o.figureId, seam: o.seamOn ? o.seam : 0, height: o.height, bust: o.bust,
    options: o.options.map((x) => ({ algo: x.algo, code: x.code, value: x.value })),
    eases: o.eases.map((e) => ({ code: e.code, value: e.value })),
    allowances: o.allowances.map((a) => ({ code: a.code, value: a.value })),
    measures: Object.fromEntries(o.measures.map((m) => [m.code, m.value])),
  };
}

/** Что уходит на сайт по опубликованной модели. */
export function modelForSite(m: SavedModel) {
  const o = m.snapshot;
  return {
    code: m.code, baseCode: m.baseCode, title: m.title || m.code, created: m.created,
    roles: o.roles, options: o.options, eases: o.eases, allowances: o.allowances,
    seam: o.seamOn ? o.seam : 0, figureId: o.figureId, height: o.height, bust: o.bust,
  };
}

/** Список «имя = значение» по сохранённому набору (для моделей, сохранённых без списка): элементы, опции, прибавки. */
export function snapshotToParamText(o: OrderOut): string {
  const out: string[] = [`# ${o.baseCode}, размер ${o.figureId}`];
  for (const r of o.roles) {
    if (!r.code) continue;
    if (/^рукав$/i.test(r.title)) out.push(`рукав = ${r.code}`);
    else if (/^воротник$/i.test(r.title)) out.push(`воротник = ${r.code}`);
    else if (/^доп\. элементы$/i.test(r.title)) for (const c of r.code.split(/[,;\s]+/).filter(Boolean)) out.push(`элемент = ${c}`);
  }
  const seen = new Set<string>();
  for (const x of o.options) {
    if (seen.has(x.code)) continue;
    seen.add(x.code);
    out.push(`${x.code.replace(/^opt_/, "пар_")} = ${x.value}`);
  }
  for (const e of o.eases) out.push(`${e.code} = ${e.value}`);
  return out.join("\n");
}
