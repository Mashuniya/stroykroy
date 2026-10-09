import { leko, type Measurements, type Eases } from "@stroykroy/pattern-engine";
import { ELEMENT_ROLES, KIND_TITLES, type SavedConstruction, type ElementLink } from "./constructions.js";

type Run = ReturnType<typeof leko.runLekoScript>;
export type RunSettings = NonNullable<Parameters<typeof leko.runLekoScript>[5]>;
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

/** Связи основы: заданные дизайнером; пока не заданы — манжета подключается к опции «Низ рукава» (facing_s = манжета/окантовка). */
export function linksOf(list: SavedConstruction[], base: SavedConstruction): ElementLink[] {
  if (base.mode === "ready") return []; // готовое изделие: ничего не подключается
  if (base.links) return base.links.filter((l) => list.some((c) => c.id === l.element));
  if ((base.kind ?? "base") !== "base") return []; // у элементов связей по умолчанию нет
  const cuff = list.find((c) => c.kind === "cuff");
  return cuff ? [{ id: "auto-cuff", option: "facing_s", values: [1, 2], element: cuff.id }] : [];
}
/** Все элементы, подключаемые связями, включая вложенные (манжета рукава и т. п.). */
export function linkedIds(list: SavedConstruction[], root: SavedConstruction, seen: Set<string> = new Set([root.id])): string[] {
  const out: string[] = [];
  for (const l of linksOf(list, root)) {
    const c = list.find((x) => x.id === l.element);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c.id, ...linkedIds(list, c, seen));
  }
  return out;
}
const linkOn = (l: ElementLink, v: number | undefined): boolean => v !== undefined && (l.values.length ? l.values.includes(v) : v !== 0);

/** Ищет основу, к которой подключён элемент; нет такой — первую основу из списка (чтобы рукав можно было смотреть сразу). */
export function findBaseFor(list: SavedConstruction[], element: SavedConstruction): SavedConstruction | null {
  const bases = list.filter((c) => (c.kind ?? "base") === "base");
  return bases.find((b) => (b.attached && Object.values(b.attached).includes(element.id)) || linkedIds(list, b).includes(element.id) || Object.values(b.attached ?? {}).some((id) => { const s = list.find((x) => x.id === id); return !!s && linkedIds(list, s).includes(element.id); })) ?? bases.find((b) => b.attached && Object.keys(b.attached).length > 0) ?? bases[0] ?? null;
}

/** В Leko опции (пар_N, facing_s…) общие для всего изделия: выбрал у рукава «манжета» — манжета получила то же. Явно выбранное значение
 * переносится в остальные элементы цепочки с тем же именем (приоритет: выбранное построение, затем основа, затем элементы). */
function shareOptions(list: SavedConstruction[], base: SavedConstruction, currentId: string, vals: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const slotIds = ELEMENT_ROLES.map((r) => base.attached?.[r.kind]).filter((x): x is string => !!x && list.some((c) => c.id === x));
  const ids = Array.from(new Set([base.id, ...slotIds, ...linkedIds(list, base), ...slotIds.flatMap((id) => linkedIds(list, list.find((x) => x.id === id)!))]));
  const order = [currentId, ...ids.filter((i) => i !== currentId)].filter((i) => ids.includes(i));
  const shared: Record<string, number> = {};
  for (const id of order) for (const [k, v] of Object.entries(vals[id] ?? {})) if (!(k in shared)) shared[k] = v;
  const out: Record<string, Record<string, number>> = { ...vals };
  for (const id of ids) out[id] = { ...shared };
  return out;
}

function runBaseWithElements(list: SavedConstruction[], base: SavedConstruction, M: Measurements, P: Eases, vals: Record<string, Record<string, number>>, S?: RunSettings) {
  const own = leko.runLekoScript(base.script, M, P, vals[base.id], undefined, S);
  let exports: ExportMap = { ...own.exports };
  const elements: ElementRun[] = [];
  // Опции общие: если «Низ рукава» объявил рукав, манжета получает то же значение (по умолчанию рукав — «подгиб», и манжеты нет, пока не выбрана)
  const declared: Record<string, number> = {};
  for (const i of own.inputs) if (i.option) declared[i.name] = i.value;
  const runElement = (c: SavedConstruction, role: string) => {
    const result = leko.runLekoScript(c.script, M, P, { ...(vals[c.id] ?? {}), ...declared }, exports, S);
    for (const i of result.inputs) if (i.option && !(i.name in declared)) declared[i.name] = i.value;
    exports = { ...exports, ...result.exports };
    elements.push({ role, c, result });
  };
  // 1) элементы, которые выбрал пользователь (рукав, воротник…)
  for (const r of ELEMENT_ROLES) {
    const id = base.attached?.[r.kind];
    const c = id ? list.find((x) => x.id === id) : undefined;
    if (c) runElement(c, r.title);
  }
  // 2) скрытые связи: «если опция = значение — подключить элемент» (манжета, карманы, пояс…), в том числе вложенные: у элемента свои связи.
  //    Опцию смотрим по тому, что объявили основа и уже подключённые элементы
  const processLinks = (owner: SavedConstruction, depth = 0) => {
    if (depth > 6) return;
    for (const l of linksOf(list, owner)) {
      const c = list.find((x) => x.id === l.element);
      if (!c || elements.some((e) => e.c.id === c.id) || c.id === base.id) continue;
      const v = vals[base.id]?.[l.option] ?? declared[l.option];
      if (linkOn(l, v)) { runElement(c, KIND_TITLES[c.kind ?? "other"] ?? "Элемент"); processLinks(c, depth + 1); }
    }
  };
  for (const e of [...elements]) processLinks(e.c, 1);
  processLinks(base);
  return { own, exports, elements };
}

export function runChain(list: SavedConstruction[], current: SavedConstruction, M: Measurements, P: Eases, valsIn: Record<string, Record<string, number>>, S?: RunSettings): Chain {
  const baseForShare = (current.kind ?? "base") === "base" ? current : findBaseFor(list, current);
  const vals = baseForShare ? shareOptions(list, baseForShare, current.id, valsIn) : valsIn;
  if ((current.kind ?? "base") === "base") {
    const { own, exports, elements } = runBaseWithElements(list, current, M, P, vals, S);
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
  let inChain: ElementRun | undefined;
  if (base) {
    // значения, которые к этому элементу отдали основа и элементы, подключённые раньше него
    const b = runBaseWithElements(list, base, M, P, vals, S);
    imported = { ...b.own.exports };
    for (const e of b.elements) {
      if (e.c.id === current.id) { inChain = e; break; }
      imported = { ...imported, ...e.result.exports };
    }
  }
  const own = inChain ? inChain.result : leko.runLekoScript(current.script, M, P, vals[current.id], imported, S);
  return { base: null, own, exports: imported, elements: [], from: base, pieces: own.pieces };
}
