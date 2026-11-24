/**
 * Движок вязального модуля: контур детали (см) → сетка петель и рядов.
 *
 * Ничего не знает про React и про Leko: на вход — замкнутый контур в сантиметрах
 * (как у Piece.outline), на выход — количество петель по каждому ряду, участки
 * и проверка по игольнице.
 *
 * Координаты — как в движке выкроек: X вправо, Y вниз, 1 единица = 1 см.
 * Низ детали — максимальный Y, верх — минимальный.
 */

export type Pt = { x: number; y: number };

/** Минимум, который нужен от Piece: имя и замкнутый контур. */
export interface PieceLike {
  name: string;
  outline: { points: Pt[] };
}

export interface Gauge {
  /** Петель на 10 см. */
  stsPer10: number;
  /** Рядов на 10 см. */
  rowsPer10: number;
  /** Рабочая ширина игольницы, игл. Для KH910 — 200. */
  needles: number;
}

export interface KnitRow {
  /** Номер ряда, 1 — первый от низа детали. */
  row: number;
  /** Суммарная ширина полотна (без разрывов). */
  widthCm: number;
  /** Внешний габарит по игольнице: от левой до правой границы. */
  spanCm: number;
  stitches: number;
  /** Сколько игл займёт внешний габарит. */
  spanStitches: number;
  /** В ряду несколько отрезков полотна (например, горловина разрезала деталь). */
  split: boolean;
  /** Левая и правая границы контура в см. */
  leftCm?: number;
  rightCm?: number;
  leftStitches?: number;
  rightStitches?: number;
}

export interface KnitSection {
  fromRow: number;
  toRow: number;
  rows: number;
  stitches: number;
  /** Изменение относительно предыдущего участка: +2, −1, null у первого. */
  delta: number | null;
  widthCm: number;
  split: boolean;
}

/** Строка «технологии»: ряд, в котором меняется число петель. */
export interface KnitChange {
  row: number;
  stitches: number;
  /** На сколько изменилось число петель на всю ширину (null — первый ряд). */
  delta: number | null;
  prevStitches: number | null;
  /** start — первый ряд, edge — кромка, center — горловина, split/join — разрыв контура. */
  kind: "start" | "edge" | "split" | "join" | "center";
  /** Изменение по левой/правой кромке, петель. */
  leftDelta: number | null;
  rightDelta: number | null;
  /** Открылась/закрылась горловина: закрывать надо центр, а не кромку. */
  center: boolean;
  centerStitches: number | null;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PieceAnalysis {
  name: string;
  points: Pt[];
  bounds: Bounds;
  /** Деталь дана на половину и зеркалится (по сгибу). */
  fold: boolean;
  /** Координата линии сгиба, см (для симметричной половинки). */
  foldX: number;
  rows: number;
  /** Полная ширина с учётом зеркала. */
  widthCm: number;
  heightCm: number;
  areaCm2: number;
  maxStitches: number;
  /** Максимум по внешнему габариту — именно он должен влезать в игольницу. */
  maxSpanStitches: number;
  minStitches: number;
  firstStitches: number;
  fits: boolean;
  /** На сколько петель выходит за игольницу (0 — влезает). */
  over: number;
  rowWidths: KnitRow[];
  sections: KnitSection[];
  /** Только ряды, где число петель меняется, — то, что удобно выписать на бумажку. */
  changes: KnitChange[];
  error?: string;
}

const EMPTY_BOUNDS: Bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/** Деталь на половину: в имени обычно есть «по сгибу», «fold» или «половина». */
export function detectFold(name: string): boolean {
  return /(по\s*сгибу|fold|half|половин)/i.test(name);
}

/**
 * Линия сгиба — длинная вертикальная кромка у левой или правой границы детали.
 * Нужна для схемы: зеркалить половину надо вокруг неё, а не вокруг середины габарита.
 */
export function detectFoldAxis(points: Pt[], bounds: Bounds): number {
  const h = bounds.maxY - bounds.minY;
  if (!(h > 0)) return bounds.minX;
  let best: number | null = null;
  let bestLen = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > 0.05 || dy < h * 0.5) continue;
    const edgeX = (a.x + b.x) / 2;
    const atSide = Math.min(Math.abs(edgeX - bounds.minX), Math.abs(edgeX - bounds.maxX));
    if (atSide > 0.05) continue;
    if (dy > bestLen) {
      bestLen = dy;
      best = edgeX;
    }
  }
  return best ?? bounds.minX;
}

export function analyzePiece(
  piece: PieceLike,
  gauge: Gauge,
  fold: boolean = detectFold(piece.name),
): PieceAnalysis {
  const points = cleanPoints(piece?.outline?.points ?? []);
  const base: PieceAnalysis = {
    name: piece?.name ?? "Деталь",
    points,
    bounds: EMPTY_BOUNDS,
    fold,
    foldX: 0,
    rows: 0,
    widthCm: 0,
    heightCm: 0,
    areaCm2: 0,
    maxStitches: 0,
    maxSpanStitches: 0,
    minStitches: 0,
    firstStitches: 0,
    fits: true,
    over: 0,
    rowWidths: [],
    sections: [],
    changes: [],
  };

  if (points.length < 3) {
    return { ...base, error: "В контуре меньше трёх точек — проверьте построение." };
  }
  if (!(gauge.stsPer10 > 0) || !(gauge.rowsPer10 > 0)) {
    return { ...base, error: "Укажите плотность: петли и ряды на 10 см." };
  }

  const bounds = boundsOf(points);
  const foldX = detectFoldAxis(points, bounds);
  const heightCm = bounds.maxY - bounds.minY;
  const baseWidthCm = bounds.maxX - bounds.minX;
  const widthCm = baseWidthCm * (fold ? 2 : 1);

  if (!(heightCm > 0) || !(baseWidthCm > 0)) {
    return { ...base, bounds, error: "Контур вырожден: нулевая ширина или высота." };
  }

  const stsPerCm = gauge.stsPer10 / 10;
  const rowsPerCm = gauge.rowsPer10 / 10;
  const rows = Math.max(1, Math.round(heightCm * rowsPerCm));
  const rowH = heightCm / rows;

  const rowWidths: KnitRow[] = [];
  let maxStitches = 0;
  let maxSpanStitches = 0;
  let minStitches = Number.POSITIVE_INFINITY;

  for (let i = 0; i < rows; i++) {
    // Середина ряда: так горизонтальные участки у низа и верха не теряются.
    const y = bounds.maxY - (i + 0.5) * rowH;
    const xs = intersections(points, y).sort((a, b) => a - b);
    let fullWidthCm = 0;
    let split = false;
    let leftCm = 0;
    let rightCm = 0;
    let leftStitches = 0;
    let rightStitches = 0;

    if (xs.length >= 2) {
      // Ширина по внешним границам: в строке «горловина открылась» это даёт
      // ровно то закрытие центра, которое видно на машине.
      leftCm = xs[0];
      rightCm = xs[xs.length - 1];
      const w = rightCm - leftCm;
      fullWidthCm = w * (fold ? 2 : 1);
      split = xs.length >= 4;
      leftStitches = Math.round((leftCm - bounds.minX) * stsPerCm);
      rightStitches = Math.round((rightCm - bounds.minX) * stsPerCm);
    }

    const stitches = Math.max(1, Math.round(fullWidthCm * stsPerCm));
    rowWidths.push({
      row: i + 1,
      widthCm: round2(fullWidthCm),
      spanCm: round2(fullWidthCm),
      stitches,
      spanStitches: stitches,
      split,
      leftCm: round2(leftCm),
      rightCm: round2(rightCm),
      leftStitches,
      rightStitches,
    });
    maxStitches = Math.max(maxStitches, stitches);
    maxSpanStitches = Math.max(maxSpanStitches, stitches);
    minStitches = Math.min(minStitches, stitches);
  }

  if (!Number.isFinite(minStitches)) minStitches = 0;

  const sections = buildSections(rowWidths);
  const foldStitches = Math.round((foldX - bounds.minX) * stsPerCm);
  const changes = buildChanges(sections, rowWidths, fold, foldStitches);
  const needles = gauge.needles > 0 ? Math.floor(gauge.needles) : Number.POSITIVE_INFINITY;
  const over = Math.max(0, maxSpanStitches - needles);

  return {
    ...base,
    points,
    bounds,
    fold,
    foldX,
    rows,
    widthCm: round2(widthCm),
    heightCm: round2(heightCm),
    areaCm2: round2(Math.abs(shoelace(points)) * (fold ? 2 : 1)),
    maxStitches,
    maxSpanStitches,
    minStitches,
    firstStitches: rowWidths[0]?.stitches ?? 0,
    fits: over === 0,
    over,
    rowWidths,
    sections,
    changes,
  };
}

/** Из участков — только строки, где меняется число петель. */
export function buildChanges(
  sections: KnitSection[],
  rows: KnitRow[] = [],
  fold = false,
  foldStitches = 0,
): KnitChange[] {
  return sections.map((s, i) => {
    const prev = i > 0 ? sections[i - 1] : null;
    let kind: KnitChange["kind"] = "start";
    if (prev) {
      if (s.split && !prev.split) kind = "split";
      else if (!s.split && prev.split) kind = "join";
      else kind = "edge";
    }

    let leftDelta: number | null = null;
    let rightDelta: number | null = null;
    let center = false;
    let centerStitches: number | null = null;

    const curRow = rows[s.fromRow - 1];
    const prevRow = prev ? rows[prev.toRow - 1] : null;
    if (curRow && prevRow) {
      const cl = curRow.leftStitches ?? 0;
      const cr = curRow.rightStitches ?? 0;
      const pl = prevRow.leftStitches ?? 0;
      const pr = prevRow.rightStitches ?? 0;
      leftDelta = cl - pl;
      rightDelta = cr - pr;

      if (fold) {
        const foldAtLeft = Math.abs(cl - foldStitches) <= Math.abs(cr - foldStitches);
        const prevFoldEdge = foldAtLeft ? pl : pr;
        // Насколько кромка горловины отошла от линии сгиба: это и есть половина
        // центрального закрытия. Срабатывает только пока кромка ещё у сгиба —
        // иначе плечевой скос вверху тоже считался бы горловиной.
        const centerHalf = foldAtLeft ? cl - pl : pr - cr;
        if (centerHalf >= 3 && Math.abs(prevFoldEdge - foldStitches) <= 3) {
          center = true;
          centerStitches = centerHalf * 2;
          kind = "center";
        }
      } else if (prev) {
        // Перед/полочка: горловина может открыться центром, когда обе внешние
        // кромки стоят, а ширина падает сразу на группу петель.
        const totalDelta = s.stitches - prev.stitches;
        if (Math.abs(totalDelta) >= 8 && Math.abs(leftDelta) <= 1 && Math.abs(rightDelta) <= 1) {
          center = true;
          centerStitches = Math.abs(totalDelta);
          kind = "center";
        }
      }
    }

    return {
      row: s.fromRow,
      stitches: s.stitches,
      delta: prev ? s.stitches - prev.stitches : null,
      prevStitches: prev ? prev.stitches : null,
      kind,
      leftDelta,
      rightDelta,
      center,
      centerStitches,
    };
  });
}

/** Непрерывные участки с одинаковым числом петель. */
export function buildSections(rows: KnitRow[]): KnitSection[] {
  const sections: KnitSection[] = [];
  if (rows.length === 0) return sections;

  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    const boundary = i === rows.length || rows[i].stitches !== rows[start].stitches;
    if (!boundary) continue;

    const stitches = rows[start].stitches;
    const prev = sections.length > 0 ? sections[sections.length - 1].stitches : null;
    sections.push({
      fromRow: rows[start].row,
      toRow: rows[i - 1].row,
      rows: i - start,
      stitches,
      delta: prev === null ? null : stitches - prev,
      widthCm: rows[start].widthCm,
      split: rows[start].split,
    });
    start = i;
  }
  return sections;
}

/** Точки контура без повторов и без замыкающей точки. */
export function cleanPoints(raw: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of raw) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) out.pop();
  }
  return out;
}

export function boundsOf(points: Pt[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** Пересечения горизонтальной линии с контуром (полуоткрытое правило, без двойного счёта вершин). */
export function intersections(points: Pt[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const crosses = (a.y <= y && b.y > y) || (b.y <= y && a.y > y);
    if (!crosses) continue;
    const t = (y - a.y) / (b.y - a.y);
    xs.push(a.x + t * (b.x - a.x));
  }
  return xs;
}

/** Площадь многоугольника по формуле шнурков, см². */
export function shoelace(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
