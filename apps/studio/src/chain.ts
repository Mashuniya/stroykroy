import { leko, type Measurements, type Eases } from "@stroykroy/pattern-engine";
import { ELEMENT_ROLES, type SavedConstruction } from "./constructions.js";

type Run = ReturnType<typeof leko.runLekoScript>;
export type ExportMap = Record<string, number | string>;

export interface ElementRun {
  role: string;        // «Рукав»…
  c: SavedConstruction;
  result: Run;
}
export interface Chain {
  base: SavedConstruction | null;
  /** Результат самого выбранного построения (для элемента — с подставленными import_*). */
  own: Run;
  /** Что отдала основа (и предыдущие элементы). */
  exports: ExportMap;
  /** Элементы, подключённые к выбранной основе (для выбранного элемента пусто). */
  elements: ElementRun[];
  /** Для выбранного элемента: от какой основы получены значения. */
  from: SavedConstruction | null;
  /** Итоговые детали: свои + детали элементов, сдвинутые вправо от деталей основы. */
  pieces: Run["pieces"];
}

/** Ищет основу, к которой подключён элемент; нет такой — первую основу из списка (чтобы рукав можно было смотреть сразу). */
export function findBaseFor(list: SavedConstruction[], element: SavedConstruction): SavedConstruction | null {
  const bases = list.filter((c) => (c.kind ?? "base") === "base");
  return bases.find((b) => b.attached && Object.values(b.attached).includes(element.id)) ?? bases.find((b) => b.attached && Object.keys(b.attached).length > 0) ?? bases[0] ?? null;
}

/** В Leko опции (пар_N, facing_s…) общие для всего изделия: выбрал у рукава «манжета» — манжета получила то же. Явно выбранное значение
 * переносится в остальные элементы цепочки с тем же именем (приоритет: выбранное построение, затем основа, затем элементы). */
function shareOptions(list: SavedConstruction[], base: SavedConstruction, currentId: string, vals: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const ids = [base.id, ...ELEMENT_ROLES.map((r) => base.attached?.[r.kind]).filter((x): x is string => !!x && list.some((c) => c.id === x))];
  const order = [currentId, ...ids.filter((i) => i !== currentId)].filter((i) => ids.includes(i));
  const shared: Record<string, number> = {};
  for (const id of order) for (const [k, v] of Object.entries(vals[id] ?? {})) if (!(k in shared)) shared[k] = v;
  const out: Record<string, Record<string, number>> = { ...vals };
  for (const id of ids) out[id] = { ...shared };
  return out;
}

function runBaseWithElements(list: SavedConstruction[], base: SavedConstruction, M: Measurements, P: Eases, vals: Record<string, Record<string, number>>) {
  const own = leko.runLekoScript(base.script, M, P, vals[base.id]);
  let exports: ExportMap = { ...own.exports };
  const elements: ElementRun[] = [];
  for (const r of ELEMENT_ROLES) {
    const id = base.attached?.[r.kind];
    const c = id ? list.find((x) => x.id === id) : undefined;
    if (!c) continue;
    const result = leko.runLekoScript(c.script, M, P, vals[c.id], exports);
    exports = { ...exports, ...result.exports };
    elements.push({ role: r.title, c, result });
  }
  return { own, exports, elements };
}

export function runChain(list: SavedConstruction[], current: SavedConstruction, M: Measurements, P: Eases, valsIn: Record<string, Record<string, number>>): Chain {
  const baseForShare = (current.kind ?? "base") === "base" ? current : findBaseFor(list, current);
  const vals = baseForShare ? shareOptions(list, baseForShare, current.id, valsIn) : valsIn;
  if ((current.kind ?? "base") === "base") {
    const { own, exports, elements } = runBaseWithElements(list, current, M, P, vals);
    let pieces = own.pieces;
    const used = new Set(own.pieces.map((p) => p.name));
    let right = leko.pieceBounds(own.pieces);
    for (const e of elements) {
      for (const pc of e.result.pieces) {
        const b = leko.pieceBounds([pc]);
        const name = used.has(pc.name) ? `${pc.name} · ${e.c.name}` : pc.name;
        used.add(name);
        // деталь элемента кладём правее всего, что уже лежит на листе, верхними краями вровень
        const dx = right && b ? right.maxX + 6 - b.minX : 0;
        const dy = right && b ? right.minY - b.minY : 0;
        const moved = leko.shiftPiece(pc, dx, dy, name);
        pieces = [...pieces, moved];
        const nb = leko.pieceBounds([moved]);
        if (nb) right = right ? { ...right, maxX: Math.max(right.maxX, nb.maxX) } : nb;
      }
    }
    return { base: current, own, exports, elements, from: null, pieces };
  }
  const base = findBaseFor(list, current);
  let imported: ExportMap = {};
  if (base) {
    // значения, которые к этому элементу отдали основа и элементы, стоящие в порядке раньше него
    const b = runBaseWithElements(list, base, M, P, vals);
    imported = { ...b.own.exports };
    for (const r of ELEMENT_ROLES) {
      const id = base.attached?.[r.kind];
      if (id === current.id) break;
      const e = b.elements.find((x) => x.c.id === id);
      if (e) imported = { ...imported, ...e.result.exports };
    }
  }
  const own = leko.runLekoScript(current.script, M, P, vals[current.id], imported);
  return { base: null, own, exports: imported, elements: [], from: base, pieces: own.pieces };
}
