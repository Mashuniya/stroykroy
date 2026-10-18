import type { Point } from "./types.js";
import type { Piece } from "./piece.js";
import { pieceKeys } from "./piece.js";
import type { PieceTransform } from "./render-script-svg.js";
import { parseTtf, type TtfFont } from "./ttf.js";

/**
 * Выгрузка деталей: DXF и PDF. Координаты везде в сантиметрах. Деталь выгружается так, как лежит
 * на листе в студии (смещение и поворот, которые вы задали мышью и стрелками), с припуском или без.
 */

export interface ExportOptions {
  /** Выгружать припуски на швы. По умолчанию да. */
  allowance?: boolean;
  /** Положение деталей на листе (ключ детали → смещение в см и поворот в °). */
  transforms?: Record<string, PieceTransform>;
  /**
   * Разложить детали без наложений. По умолчанию да: если на листе детали накладываются друг на друга
   * (как в построении, где спинка и перед стыкуются по боковому шву), в файле они разложены в ряд с зазором.
   * Если вы сами расставили их без наложений, ваше положение сохраняется.
   */
  separate?: boolean;
  /** «cad» — обычный DXF (слои: контур, припуск, внутренние линии, надсечки…); «clo» — упрощённый для CLO3D и других 3D-программ. */
  target?: "cad" | "clo" | "aama";
  /** Заголовок — печатается в углу PDF (латиницей: русские буквы транслитерируются). */
  title?: string;
  /** Крупный бледный знак на каждом листе PDF (например «StroyKroy · заказ 125»; русские буквы транслитерируются). */
  stamp?: string;
  /**
   * Шрифт для русских надписей в PDF (TrueType). Без него надписи транслитерируются латиницей.
   * deflate — сжатие (например zlib.deflateSync из Node); без него шрифт вшивается без сжатия.
   */
  font?: PdfFontData;
}

export interface PdfFontData { regular: Uint8Array; bold?: Uint8Array; deflate?: (b: Uint8Array) => Uint8Array }

interface Placed {
  name: string;
  color: number;
  center: Point;
  outline: Point[];
  allowance: Point[] | null;
  inner: Point[][];
  innerPoints: Point[];
  notches: Point[][];
  grain: [Point, Point] | null;
  count?: number;
  texts: { text: string; point: Point; height: number; angle: number }[];
}

const EPS = 1e-9;

/** Применяет положение детали на листе: поворот вокруг её центра (по часовой на экране) и сдвиг. */
function placeWith(pieces: Piece[], opts: ExportOptions, transforms: Record<string, PieceTransform> | undefined): Placed[] {
  if (pieces.length === 0) throw new Error("Нет деталей для выгрузки — запишите деталь оператором writePiece.");
  const keys = pieceKeys(pieces);
  return pieces.map((pc, i) => {
    const xf = transforms?.[keys[i]] ?? { dx: 0, dy: 0, angle: 0 };
    const r = (xf.angle * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const map = (p: Point): Point => {
      const x = p.x - pc.center.x, y = p.y - pc.center.y;
      return { x: pc.center.x + x * cos - y * sin + xf.dx, y: pc.center.y + x * sin + y * cos + xf.dy };
    };
    return {
      name: pc.name,
      count: pc.count,
      color: pc.color,
      center: map(pc.center),
      outline: pc.outline.points.map(map),
      allowance: opts.allowance === false || !pc.allowance ? null : pc.allowance.points.map(map),
      inner: pc.inner.map((l) => l.points.map(map)),
      innerPoints: pc.innerPoints.map(map),
      notches: pc.notches.map((n) => n.points.map(map)),
      grain: pc.grain ? [map(pc.grain.p1), map(pc.grain.p2)] : null,
      texts: pc.texts.map((t) => ({ text: t.text, point: map(t.point), height: t.height, angle: t.angle + xf.angle })),
    };
  });
}

// ---------------------------------------------------------------- геометрия для раскладки и проверок

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const stripClose = (pts: Point[]): Point[] => (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-9 ? pts.slice(0, -1) : pts);
const cutPolygon = (p: Placed): Point[] => stripClose(p.allowance ?? p.outline);

function pointInPoly(pt: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function ptSegDist(p: Point, a: Point, b: Point): number {
  const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
  return dist(p, { x: a.x + t * ex, y: a.y + t * ey });
}
function segsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}
/** Наименьшее расстояние между двумя отрезками (0, если пересекаются). */
function segSegDist(a: Point, b: Point, c: Point, d: Point): number {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b));
}
/** Расстояние между двумя многоугольниками: 0, если пересекаются или один лежит внутри другого. */
function polyDistance(A: Point[], B: Point[]): number {
  if (pointInPoly(A[0], B) || pointInPoly(B[0], A)) return 0;
  let m = Infinity;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    const d = segSegDist(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]);
    if (d < m) m = d;
    if (m === 0) return 0;
  }
  return m;
}
const MIN_PIECE_GAP = 0.1; // см: ближе — считаем, что детали накладываются/слиплись

function anyOverlap(placed: Placed[]): boolean {
  const polys = placed.map(cutPolygon);
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (polyDistance(polys[i], polys[j]) < MIN_PIECE_GAP) return true;
  return false;
}

/** Накладываются ли детали друг на друга (с учётом включённых припусков и положения на листе). */
export function piecesOverlap(pieces: Piece[], opts: ExportOptions = {}): boolean {
  const placed = placeWith(pieces, opts, opts.transforms);
  return placed.length > 1 && anyOverlap(placed);
}

/**
 * Раскладка деталей в ряд без наложений (полками): слева направо в том порядке, в котором они стоят на чертеже,
 * между деталями зазор gap (2 см), при ширине ряда больше maxWidth (150 см — ширина ткани) начинается новый ряд.
 * Поворот деталей не меняется. Возвращает положение каждой детали (ключ → смещение и поворот).
 */
export function arrangePieces(pieces: Piece[], opts: ExportOptions & { gap?: number; maxWidth?: number } = {}): Record<string, PieceTransform> {
  const keys = pieceKeys(pieces);
  const cur = placeWith(pieces, opts, opts.transforms);
  const gap = opts.gap ?? 2, maxW = opts.maxWidth ?? 150;
  const boxes = cur.map((p, i) => ({ i, b: boundsOf([p]) }));
  const all = boundsOf(cur);
  const order = [...boxes].sort((a, c) => a.b.minX + a.b.maxX - (c.b.minX + c.b.maxX) || a.i - c.i);
  const out: Record<string, PieceTransform> = {};
  let x = 0, y = 0, rowH = 0;
  for (const { i, b } of order) {
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (x > 0 && x + w > maxW) { y += rowH + gap; x = 0; rowH = 0; }
    const old = opts.transforms?.[keys[i]] ?? { dx: 0, dy: 0, angle: 0 };
    out[keys[i]] = { dx: old.dx + (all.minX + x - b.minX), dy: old.dy + (all.minY + y - b.minY), angle: old.angle };
    x += w + gap; rowH = Math.max(rowH, h);
  }
  return out;
}

/** Положение деталей для файла: как на листе, а если детали накладываются — раскладка без наложений. */
function placePieces(pieces: Piece[], opts: ExportOptions): { placed: Placed[]; arranged: boolean } {
  const placed = placeWith(pieces, opts, opts.transforms);
  if (opts.separate !== false && placed.length > 1 && anyOverlap(placed)) {
    return { placed: placeWith(pieces, opts, arrangePieces(pieces, opts)), arranged: true };
  }
  return { placed, arranged: false };
}

/** Что произойдёт при выгрузке: наложились ли детали (тогда они будут разложены) и сколько острых концов вытачек притуплено (режим CLO3D). */
export function exportLayoutInfo(pieces: Piece[], opts: ExportOptions = {}): { overlapped: boolean; blunted: number } {
  const { placed, arranged } = placePieces(pieces, opts);
  const blunted = opts.target === "clo" ? placed.reduce((n, p) => n + cloPolygon(p).blunted, 0) : 0;
  return { overlapped: arranged, blunted };
}

function boundsOf(placed: Placed[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: Point) => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; };
  for (const p of placed) { p.outline.forEach(add); p.allowance?.forEach(add); p.inner.forEach((l) => l.forEach(add)); p.notches.forEach((l) => l.forEach(add)); }
  return { minX, minY, maxX, maxY };
}

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
/** Подписи в PDF/DXF — только латиница (стандартные шрифты PDF и R12 не содержат кириллицы): «Спинка» → «Spinka». */
export function translit(s: string): string {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    if (CYR[low] !== undefined) { const t = CYR[low]; out += ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1); }
    else if (/[\x20-\x7e]/.test(ch)) out += ch;
    else out += "_";
  }
  return out;
}

// Палитра Leko (номер цвета 1-15) — как в рисовании на экране.
const HEX: Record<number, string> = {
  1: "#1a3a8a", 2: "#1e8a3c", 3: "#1a8a9a", 4: "#b32020", 5: "#7a2a9a", 6: "#7a4a1a", 7: "#9a9a9a", 8: "#555555",
  9: "#2a5aff", 10: "#22b34a", 11: "#00a8c8", 12: "#e0301e", 13: "#b03ad0", 14: "#d8a800", 15: "#222222",
};
const rgb = (color: number): [number, number, number] => {
  const h = (HEX[color] ?? HEX[1]).slice(1);
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};
// Индексы цветов AutoCAD (ACI) для DXF.
const ACI: Record<number, number> = { 1: 5, 2: 3, 3: 4, 4: 1, 5: 6, 6: 30, 7: 9, 8: 8, 9: 5, 10: 3, 11: 4, 12: 1, 13: 6, 14: 2, 15: 7 };

// ==================================================================== DXF

const f4 = (x: number) => (Math.abs(x) < EPS ? "0" : x.toFixed(4).replace(/\.?0+$/, ""));


/**
 * Каркас DXF R12 «как у AutoCAD»: полный HEADER, таблицы VPORT/LTYPE/LAYER/STYLE/VIEW/UCS, пустая секция BLOCKS.
 * Строгие читалки (старые CLO, Illustrator, CorelDRAW, онлайн-просмотрщики) без этих разделов могут показать пустой лист или «квадраты».
 */
function dxfSkeleton(g: (c: number, v: string | number) => void, ext: { minX: number; minY: number; maxX: number; maxY: number }, ltypes: boolean, layers: [string, number, string][]): void {
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSBASE"); g(10, 0); g(20, 0); g(30, 0);
  g(9, "$EXTMIN"); g(10, f4(ext.minX)); g(20, f4(ext.minY)); g(30, 0);
  g(9, "$EXTMAX"); g(10, f4(ext.maxX)); g(20, f4(ext.maxY)); g(30, 0);
  g(9, "$LIMMIN"); g(10, f4(ext.minX)); g(20, f4(ext.minY));
  g(9, "$LIMMAX"); g(10, f4(ext.maxX)); g(20, f4(ext.maxY));
  g(9, "$ORTHOMODE"); g(70, 0);
  g(9, "$LTSCALE"); g(40, 1);
  g(9, "$TEXTSTYLE"); g(7, "STANDARD");
  g(9, "$CLAYER"); g(8, "0");
  g(9, "$CELTYPE"); g(6, "BYLAYER");
  g(9, "$CECOLOR"); g(62, 256);
  g(9, "$UNITMODE"); g(70, 0);
  g(9, "$LUNITS"); g(70, 2);
  g(9, "$LUPREC"); g(70, 4);
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "TABLES");
  const cx = (ext.minX + ext.maxX) / 2, cy = (ext.minY + ext.maxY) / 2, h = Math.max(10, ext.maxY - ext.minY) * 1.1;
  g(0, "TABLE"); g(2, "VPORT"); g(70, 1);
  g(0, "VPORT"); g(2, "*ACTIVE"); g(70, 0); g(10, 0); g(20, 0); g(11, 1); g(21, 1); g(12, f4(cx)); g(22, f4(cy)); g(13, 0); g(23, 0); g(14, 1); g(24, 1); g(15, 0); g(25, 0);
  g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0); g(40, f4(h)); g(41, 1.5); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0); g(71, 0); g(72, 100); g(73, 1); g(74, 3); g(75, 0); g(76, 0); g(77, 0); g(78, 0);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, ltypes ? 2 : 1);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  if (ltypes) { g(0, "LTYPE"); g(2, "DASHED"); g(70, 0); g(3, "Dashed"); g(72, 65); g(73, 2); g(40, 0.75); g(49, 0.5); g(49, -0.25); }
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
  for (const [name, color, lt] of layers) { g(0, "LAYER"); g(2, name); g(70, 0); g(62, color); g(6, lt); }
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "STYLE"); g(70, 1);
  g(0, "STYLE"); g(2, "STANDARD"); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 0.2); g(3, "txt"); g(4, "");
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "VIEW"); g(70, 0); g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "UCS"); g(70, 0); g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "BLOCKS"); g(0, "ENDSEC");
}

/**
 * DXF (AutoCAD R12, ASCII — открывается практически любой САПР и раскройной программой).
 * Единицы — сантиметры. Слои: CONTOUR (контур), ALLOWANCE (припуск, штриховая), INNER (внутренние линии и метки),
 * NOTCH (надсечки), GRAIN (долевая), TEXT (имя детали). Ось Y направлена вверх, как принято в DXF.
 */
export function exportDxf(pieces: Piece[], opts: ExportOptions = {}): string {
  const { placed } = placePieces(pieces, opts);
  if (opts.target === "clo") return exportDxfClo(placed);
  if (opts.target === "aama") return exportDxfAama(placed);
  const b = boundsOf(placed);
  const L: string[] = [];
  const g = (code: number, value: string | number) => { L.push(String(code), String(value)); };
  const Y = (y: number) => -y; // экранная Y вниз → DXF Y вверх

  const layers: [string, number, string][] = [["0", 7, "CONTINUOUS"], ["CONTOUR", 5, "CONTINUOUS"], ["ALLOWANCE", 1, "DASHED"], ["INNER", 3, "CONTINUOUS"], ["NOTCH", 5, "CONTINUOUS"], ["GRAIN", 8, "CONTINUOUS"], ["TEXT", 7, "CONTINUOUS"]];
  dxfSkeleton(g, { minX: b.minX, minY: Y(b.maxY), maxX: b.maxX, maxY: Y(b.minY) }, true, layers);

  g(0, "SECTION"); g(2, "ENTITIES");
  const poly = (layer: string, pts: Point[], closed: boolean, color?: number) => {
    g(0, "POLYLINE"); g(8, layer); if (color !== undefined) g(62, color); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, f4(p.x)); g(20, f4(Y(p.y))); g(30, 0); }
    g(0, "SEQEND"); g(8, layer);
  };
  const line = (layer: string, a: Point, c: Point, color?: number) => {
    g(0, "LINE"); g(8, layer); if (color !== undefined) g(62, color);
    g(10, f4(a.x)); g(20, f4(Y(a.y))); g(30, 0); g(11, f4(c.x)); g(21, f4(Y(c.y))); g(31, 0);
  };
  // Точка построения — маленький крестик из двух линий (0,3 см): объекты POINT CLO и другие программы рисуют квадратами
  const cross = (q: Point, col: number) => { line("INNER", { x: q.x - 0.15, y: q.y }, { x: q.x + 0.15, y: q.y }, col); line("INNER", { x: q.x, y: q.y - 0.15 }, { x: q.x, y: q.y + 0.15 }, col); };
  for (const p of placed) {
    const col = ACI[p.color] ?? 5;
    const closedPts = (pts: Point[]) => (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6 ? pts.slice(0, -1) : pts);
    poly("CONTOUR", simplifyRing(closedPts(p.outline), SIMPLIFY_TOL), true, col);
    if (p.allowance) poly("ALLOWANCE", simplifyRing(closedPts(p.allowance), SIMPLIFY_TOL), true, col);
    // Линии из одной точки или нулевой длины (метки-«точки» построения) не выгружаем как линии: CLO и другие рисуют их квадратами.
    // Одиночные точки пишем как POINT, повторяющиеся линии — один раз.
    const seenInner = new Set<string>();
    for (const l of p.inner) {
      const sl = simplifyLine(l, SIMPLIFY_TOL);
      let len = 0;
      for (let i = 1; i < sl.length; i++) len += dist(sl[i - 1], sl[i]);
      const key = sl.map((q) => f4(q.x) + "," + f4(q.y)).join(";");
      if (seenInner.has(key)) continue;
      seenInner.add(key);
      if (sl.length < 2 || len < 0.05) {
        if (sl[0]) cross(sl[0], col);
        continue;
      }
      poly("INNER", sl, false, col);
    }
    for (const ip of p.innerPoints) cross(ip, col);
    for (const n of p.notches) if (n.length >= 2) line("NOTCH", n[0], n[n.length - 1], col);
    if (p.grain) line("GRAIN", p.grain[0], p.grain[1], 8);
    for (const t of p.texts) { if (!t.text.trim()) continue; g(0, "TEXT"); g(8, "TEXT"); g(10, f4(t.point.x)); g(20, f4(Y(t.point.y))); g(30, 0); g(40, f4(Math.max(0.3, t.height))); g(1, translit(t.text)); g(50, f4(-t.angle)); }
    g(0, "TEXT"); g(8, "TEXT"); g(10, f4(p.center.x)); g(20, f4(Y(p.center.y) - 2)); g(30, 0); g(40, 1.2); g(1, translit(p.name)); g(72, 1); g(11, f4(p.center.x)); g(21, f4(Y(p.center.y) - 2)); g(31, 0);
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------- DXF для CLO3D


/**
 * Прореживание вершин (Дуглас — Пёкер): кривая, снятая сотней мелких звеньев, превращается в несколько десятков
 * с отклонением не больше tol см (0,2 мм). Углы и концы линий сохраняются. Программы показывают каждую вершину точкой,
 * и сотни точек на плавных линиях только мешают редактировать лекала.
 */
function simplifyLine(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i++) { const d = ptSegDist(pts[i], pts[a], pts[b]); if (d > wd) { wd = d; worst = i; } }
    if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** То же для замкнутого контура: режем его по двум самым далёким вершинам и прореживаем обе половины. */
function simplifyRing(pts: Point[], tol: number): Point[] {
  if (pts.length < 8) return pts;
  let ia = 0, ib = 0, best = -1;
  const step = Math.max(1, Math.floor(pts.length / 60));
  for (let i = 0; i < pts.length; i += step) for (let j = i + 1; j < pts.length; j += step) { const d = dist(pts[i], pts[j]); if (d > best) { best = d; ia = i; ib = j; } }
  const first = pts.slice(ia, ib + 1), second = [...pts.slice(ib), ...pts.slice(0, ia + 1)];
  const a = simplifyLine(first, tol), b = simplifyLine(second, tol);
  return [...a, ...b.slice(1, -1)];
}
const SIMPLIFY_TOL = 0.02;

/** Убирает подряд идущие вершины ближе minEdge (миллиметровые звенья сетку 3D-программ только путают). */
function cleanPolygon(poly: Point[], minEdge: number): Point[] {
  const out: Point[] = [];
  for (const p of poly) if (out.length === 0 || dist(out[out.length - 1], p) >= minEdge) out.push(p);
  while (out.length > 3 && dist(out[0], out[out.length - 1]) < minEdge) out.pop();
  return out;
}
const areaOf = (poly: Point[]) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };

/**
 * Убирает петли: места, где контур сам себя пересекает (маленькие «ласточкины хвосты» в углах линии припуска).
 * CLO не может построить деталь по такому контуру и рисует вместо неё прямоугольник. Из двух частей контура
 * между пересечением выбрасывается та, что охватывает меньшую площадь.
 */
export function removeLoops(ring: Point[]): Point[] {
  let r = ring.slice();
  // «Шипы»: вершина, в которой контур разворачивается почти на 180° (острый залом припуска во внутреннем углу), — выбрасываем
  for (let guard = 0; guard < 200 && r.length > 4; guard++) {
    let spike = -1;
    for (let k = 0; k < r.length; k++) {
      const a = r[(k - 1 + r.length) % r.length], c = r[k], b = r[(k + 1) % r.length];
      const a1 = Math.atan2(c.y - a.y, c.x - a.x), a2 = Math.atan2(b.y - c.y, b.x - c.x);
      let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
      // только короткие шипы (звено до 5 мм): настоящий острый конец вытачки или выреза имеет длинные стороны и сохраняется
      if (turn > (150 * Math.PI) / 180 && Math.min(dist(a, c), dist(c, b)) < 0.5) { spike = k; break; }
    }
    if (spike < 0) break;
    r.splice(spike, 1);
  }
  const cross = (a: Point, b: Point, c: Point, d: Point): Point | null => {
    const d1x = b.x - a.x, d1y = b.y - a.y, d2x = d.x - c.x, d2y = d.y - c.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den, u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / den;
    return t > 0 && t < 1 && u > 0 && u < 1 ? { x: a.x + t * d1x, y: a.y + t * d1y } : null;
  };
  for (let guard = 0; guard < 200; guard++) {
    const n = r.length;
    let found: { i: number; j: number; x: Point } | null = null;
    outer: for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const x = cross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n]);
        if (x) { found = { i, j, x }; break outer; }
      }
    }
    if (!found) break;
    const { i, j, x } = found;
    const loop = [x, ...r.slice(i + 1, j + 1)];
    const rest = [...r.slice(0, i + 1), x, ...r.slice(j + 1)];
    r = Math.abs(areaOf(loop)) < Math.abs(areaOf(rest)) ? rest : loop;
  }
  return r;
}

/**
 * Острый вырез (конец вытачки) уже width — это «щель» уже, чем шаг сетки 3D-симуляции: граница сама себя пересекает.
 * Такой конец притупляется: вершина заменяется отрезком шириной width поперёк выреза. Контур — против часовой стрелки.
 */
function bluntWedges(poly: Point[], width = 0.6, maxAngleDeg = 40): { poly: Point[]; blunted: number } {
  const n = poly.length, out: Point[] = [];
  let blunted = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[(i - 1 + n) % n], c = poly[i], q = poly[(i + 1) % n];
    const v1 = { x: p.x - c.x, y: p.y - c.y }, v2 = { x: q.x - c.x, y: q.y - c.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    const theta = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2))));
    const cross = (c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x); // < 0 — вершина «вогнутая» (вырез)
    if (cross < 0 && theta < (maxAngleDeg * Math.PI) / 180) {
      const s = width / 2 / Math.sin(theta / 2);
      if (s < l1 * 0.9 && s < l2 * 0.9) {
        out.push({ x: c.x + (v1.x / l1) * s, y: c.y + (v1.y / l1) * s }, { x: c.x + (v2.x / l2) * s, y: c.y + (v2.y / l2) * s });
        blunted++;
        continue;
      }
    }
    out.push(c);
  }
  return { poly: out, blunted };
}

/** Внешний (раскройный) контур детали в координатах DXF (Y вверх), очищенный, против часовой стрелки, с притупленными вытачками. */
function cloPolygon(p: Placed): { poly: Point[]; blunted: number } {
  let poly = removeLoops(simplifyRing(cleanPolygon(cutPolygon(p).map((q) => ({ x: q.x, y: -q.y })), 0.1), SIMPLIFY_TOL));
  if (areaOf(poly) < 0) poly = poly.slice().reverse();
  return bluntWedges(poly);
}

/** Линия лежит целиком внутри контура, не касаясь границы ближе margin. */
function strictlyInside(pts: Point[], poly: Point[], margin = 0.05): boolean {
  for (const p of pts) {
    if (!pointInPoly(p, poly)) return false;
    for (let i = 0; i < poly.length; i++) if (ptSegDist(p, poly[i], poly[(i + 1) % poly.length]) < margin) return false;
  }
  for (let k = 1; k < pts.length; k++) for (let i = 0; i < poly.length; i++) if (segsCross(pts[k - 1], pts[k], poly[i], poly[(i + 1) % poly.length])) return false;
  return true;
}

/**
 * DXF для CLO3D (и других 3D-программ, строящих сетку по границе детали). Отличия от обычного DXF:
 * на деталь — ОДИН замкнутый контур (раскройный: с припуском, если он включён; иначе контур по линии шва), без вложенных
 * контуров, которые касаются границы на вытачках; острые концы вытачек притуплены до 6 мм; лишних мелких звеньев нет;
 * контур идёт против часовой стрелки; слой контура называется по детали (Spinka, Pered…). Внутренние линии, долевая и
 * подпись записываются только если лежат целиком внутри контура. Надсечки не выгружаются (они пересекают границу).
 */
function exportDxfClo(placed: Placed[]): string {
  const L: string[] = [];
  const g = (code: number, value: string | number) => { L.push(String(code), String(value)); };
  const Y = (p: Point): Point => ({ x: p.x, y: -p.y });
  const names: string[] = [];
  placed.forEach((p, i) => {
    let n = translit(p.name).replace(/[^A-Za-z0-9_]/g, "_") || `piece${i + 1}`;
    if (names.includes(n)) n = `${n}_${i + 1}`;
    names.push(n);
  });
  const polys = placed.map(cloPolygon);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { poly } of polys) for (const p of poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }

  const layerNames = ["0", ...names, "GRAIN", "INTERNAL", "TEXT"];
  dxfSkeleton(g, { minX, minY, maxX, maxY }, false, layerNames.map((n, i): [string, number, string] => [n, i === 0 || n === "TEXT" ? 7 : n === "GRAIN" ? 8 : n === "INTERNAL" ? 3 : 5, "CONTINUOUS"]));

  g(0, "SECTION"); g(2, "ENTITIES");
  const poly = (layer: string, pts: Point[], closed: boolean) => {
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, f4(p.x)); g(20, f4(p.y)); g(30, 0); }
    g(0, "SEQEND"); g(8, layer);
  };
  // Контур детали — LWPOLYLINE: старый CLO (7.x) принимает его, а замкнутую POLYLINE с вершинами и отдельные отрезки игнорирует
  // (проверено на тестовом файле: из четырёх способов записи открылся только этот)
  const lwpoly = (layer: string, pts: Point[]) => {
    g(0, "LWPOLYLINE"); g(8, layer); g(90, pts.length); g(70, 1);
    for (const p of pts) { g(10, f4(p.x)); g(20, f4(p.y)); }
  };
  placed.forEach((p, i) => {
    const cut = polys[i].poly;
    lwpoly(names[i], cut);
    if (p.grain) {
      const a = Y(p.grain[0]), c = Y(p.grain[1]);
      if (strictlyInside([a, c], cut)) { g(0, "LINE"); g(8, "GRAIN"); g(10, f4(a.x)); g(20, f4(a.y)); g(30, 0); g(11, f4(c.x)); g(21, f4(c.y)); g(31, 0); }
    }
    // Мелочь (метки 1 см, кружки 0,5 см — центры пуговиц, концы петель) CLO показывает отдельными «деталями»-квадратиками, поэтому
    // внутренними линиями оставляем только настоящие линии длиной от 3 см
    for (const l of p.inner) {
      const pts = simplifyLine(l.map(Y), SIMPLIFY_TOL);
      let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      // Размах линии (по большей стороне охватывающего прямоугольника) тоже от 3 см: петли 2×0,5 см имеют длину обхода больше 3 см,
      // но CLO всё равно показывает их отдельными «деталями»-прямоугольниками
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (pts.length >= 2 && len >= 3 && span >= 3 && strictlyInside(pts, cut)) poly("INTERNAL", pts, false);
    }
    // одиночные точки построения в файл для CLO не пишем: объекты POINT программа показывает квадратами
    const c = Y(p.center);
    if (strictlyInside([c], cut, 1)) { g(0, "TEXT"); g(8, "TEXT"); g(10, f4(c.x)); g(20, f4(c.y - 2)); g(30, 0); g(40, 1.2); g(1, translit(p.name)); g(72, 1); g(11, f4(c.x)); g(21, f4(c.y - 2)); g(31, 0); }
  });
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\n") + "\n";
}


// ---------------------------------------------------------------- DXF ANSI/AAMA (ASTM D6673)

/**
 * DXF в формате ANSI/AAMA (ASTM D6673): так выгружают лекала Lectra Modaris, Gerber, Optitex и принимают CLO3D, Marvelous Designer и др.
 * Устройство сверено с реальным файлом Modaris: R12, пустая секция TABLES; каждая деталь — отдельный BLOCK (имя «деталь-S_размер»),
 * в ENTITIES — INSERT с положением блока на листе и текстовый заголовок стиля. Единицы — миллиметры, Y вверх.
 * Слои: 1 — линия раскроя (с припуском; если припуска нет — линия шва), 14 — линия шва (при наличии припуска),
 * 2 — угловые точки, 3 — точки кривых, 4 — надсечки (POINT: z — длина в мм, 50 — угол направления внутрь детали),
 * 7 — долевая, 8 — внутренние линии, 13 — отверстия/точки построения. Подписи детали («Piece Name:», «Size:», «Quantity:» …) — TEXT на слое 1.
 * Точки идут по порядку обхода контура; у угловых точек, надсечек и концов внутренних линий — метка «# n» со своим номером
 * (в файлах Modaris это номер правила градации; у нас размер один, таблицы градации нет).
 */
function exportDxfAama(placed: Placed[]): string {
  const L: string[] = [];
  const g = (code: number, value: string | number) => { L.push(String(code).padStart(3, " "), String(value)); };
  const mm = (v: number) => (v * 10).toFixed(4);
  const names: string[] = [];
  placed.forEach((p, i) => {
    let n = translit(p.name).replace(/[^A-Za-z0-9_]/g, "_") || `piece${i + 1}`;
    if (names.includes(n)) n = `${n}_${i + 1}`;
    names.push(n);
  });

  // комментарии перед первой секцией, как в файлах Modaris
  for (const c of ["Version : StroyKroy", "DXF Mode : Rule", "Notch Superposition : No", "Notch Permutation : Same Tool", "Slidding Notch : No", "Curve Precision : Smooth", "Inter Notch Grading : No", "All Sizes Precision : No", "Export Tolerance : 1.000000"]) { g(999, c); }
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "BLOCKS");

  const inserts: { name: string; x: number; y: number }[] = [];
  placed.forEach((p, i) => {
    const flip = (q: Point): Point => ({ x: q.x, y: -q.y }); // экран (Y вниз) → Y вверх, см
    const cut = removeLoops(simplifyRing(cutPolygon(p).map(flip), SIMPLIFY_TOL));
    const sew = p.allowance ? removeLoops(simplifyRing(stripClose(p.outline).map(flip), SIMPLIFY_TOL)) : null;
    // блок строим от левого нижнего угла линии раскроя; положение на листе записывается в INSERT
    const ox = Math.min(...cut.map((q) => q.x)), oy = Math.min(...cut.map((q) => q.y));
    const T = (q: Point): Point => ({ x: q.x - ox, y: q.y - oy });
    const blockName = `${names[i]}-S_1`;
    inserts.push({ name: blockName, x: ox, y: oy });
    g(0, "BLOCK"); g(8, "1"); g(2, blockName); g(10, "0.0000"); g(20, "0.0000"); g(70, 0);

    const poly = (layer: string, pts: Point[], closed: boolean) => {
      g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, closed ? 1 : 0);
      for (const q of pts) { const t = T(q); g(0, "VERTEX"); g(8, layer); g(10, mm(t.x)); g(20, mm(t.y)); g(42, "0.0000"); }
      g(0, "SEQEND");
    };
    const point = (layer: string, q: Point, extra?: [number, string][]) => {
      const t = T(q); g(0, "POINT"); g(8, layer); g(10, mm(t.x)); g(20, mm(t.y)); for (const [c, v] of extra ?? []) g(c, v);
    };
    const text = (layer: string, x: number, y: number, h: number, str: string) => { g(0, "TEXT"); g(8, layer); g(10, x.toFixed(4)); g(20, y.toFixed(4)); g(40, h.toFixed(4)); g(1, str); };

    // линии: шов (14), раскрой (1), внутренние (8) — порядок как в файлах Modaris
    const inners = p.inner.map((l) => simplifyLine(l.map(flip), SIMPLIFY_TOL)).filter((l) => l.length >= 2);
    if (sew) poly("14", sew, true);
    poly("1", cut, true);
    for (const l of inners) poly("8", l, false);
    // точки по порядку обхода контура, как в файлах Modaris: линия шва (14), затем линия раскроя (1); угловые — слой 2, точки кривых — слой 3
    const classify = (ring: Point[]) => ring.map((c, k) => {
      const prev = ring[(k - 1 + ring.length) % ring.length], next = ring[(k + 1) % ring.length];
      const a1 = Math.atan2(c.y - prev.y, c.x - prev.x), a2 = Math.atan2(next.y - c.y, next.x - c.x);
      let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
      return { q: c, corner: turn > (25 * Math.PI) / 180 };
    });
    // метки «# n»: у каждой метки свой номер (у Modaris номер — это номер точки в таблице правил градации)
    let nid = 0;
    const labels: { layers: string[]; q: Point; id: number }[] = [];
    let grainIds: [number, number] | null = null;
    if (p.grain) grainIds = [++nid, ++nid];
    for (const [ring, layer] of [...(sew ? [[sew, "14"]] : []), [cut, "1"]] as [Point[], string][]) {
      for (const v of classify(ring)) {
        point(v.corner ? "2" : "3", v.q);
        if (v.corner) labels.push({ layers: ["2", layer], q: v.q, id: ++nid });
      }
    }
    // надсечки: точка на линии раскроя, длина (мм) и направление внутрь детали
    const ring = cutPolygon(p).map(flip);
    for (const n of p.notches) {
      if (n.length < 2) continue;
      const a = flip(n[0]), b = flip(n[n.length - 1]);
      const da = Math.min(...ring.map((q, k) => ptSegDist(a, q, ring[(k + 1) % ring.length])));
      const db = Math.min(...ring.map((q, k) => ptSegDist(b, q, ring[(k + 1) % ring.length])));
      const [near, inward] = da <= db ? [a, b] : [b, a];
      // точка надсечки — на самой линии раскроя (ближайшая точка контура)
      let on = near, bestD = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const u = ring[k], v = ring[(k + 1) % ring.length];
        const ex = v.x - u.x, ey = v.y - u.y, l2 = ex * ex + ey * ey || 1;
        const tt = Math.max(0, Math.min(1, ((near.x - u.x) * ex + (near.y - u.y) * ey) / l2));
        const q = { x: u.x + ex * tt, y: u.y + ey * tt }, d = dist(near, q);
        if (d < bestD) { bestD = d; on = q; }
      }
      const len = Math.max(5, dist(near, inward) * 10);
      point("4", on, [[30, len.toFixed(4)], [50, ((Math.atan2(inward.y - on.y, inward.x - on.x) * 180) / Math.PI).toFixed(4)]]);
      labels.push({ layers: ["4"], q: on, id: ++nid });
    }
    // внутренние линии: концы — угловые точки (слой 2, с меткой), промежуточные — точки кривой (слой 3)
    // Внутренние линии: концы и места излома (поворот больше 25°) — угловые точки с меткой (слой 2), плавные промежуточные — слой 3.
    // Если излом записать точкой кривой, CLO «сглаживает» линию сплайном: стрелка долевой и петли превращаются в длинные кривые.
    for (const l of inners) {
      l.forEach((q, k) => {
        let corner = k === 0 || k === l.length - 1;
        if (!corner) {
          const a = l[k - 1], b = l[k + 1];
          const a1 = Math.atan2(q.y - a.y, q.x - a.x), a2 = Math.atan2(b.y - q.y, b.x - q.x);
          let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
          corner = turn > (25 * Math.PI) / 180;
        }
        point(corner ? "2" : "3", q);
        if (corner) labels.push({ layers: ["2", "8"], q, id: ++nid });
      });
    }
    // метки в том же порядке, что и у Modaris: долевая, затем точки
    const label = (layer: string, q: Point, id: number) => { const t = T(q); text(layer, t.x * 10, t.y * 10, 8, `# ${id}`); };
    if (p.grain && grainIds) {
      const ga = T(flip(p.grain[0])), gb = T(flip(p.grain[1]));
      text("7", ga.x * 10, ga.y * 10, 8, `# ${grainIds[0]}`);
      text("7", gb.x * 10, gb.y * 10, 8, `# ${grainIds[1]}`);
    }
    for (const lb of labels) for (const ly of lb.layers) label(ly, lb.q, lb.id);
    // подписи детали, как в файлах Modaris: под деталью
    const tx = 0, ty0 = -10;
    text("1", tx, ty0, 8, `Piece Name: ${names[i]}`);
    text("1", tx, ty0 - 10, 8, "Size: 1");
    text("1", tx, ty0 - 20, 8, `Quantity: ${p.count && p.count > 0 ? p.count : 1}`);
    text("1", tx, ty0 - 30, 8, "Annotation: ");
    text("1", tx, ty0 - 40, 8, "Category: ");
    if (p.grain) {
      const ga = T(flip(p.grain[0])), gb = T(flip(p.grain[1]));
      g(0, "LINE"); g(8, "7"); g(10, mm(ga.x)); g(20, mm(ga.y)); g(11, mm(gb.x)); g(21, mm(gb.y));
    }
    g(0, "ENDBLK");
  });
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  for (const it of inserts) { g(0, "INSERT"); g(8, "1"); g(2, it.name); g(10, mm(it.x)); g(20, mm(it.y)); }
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const head = ["Style Name: StroyKroy", `Creation Date: ${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()}`, `Creation Time: ${two(now.getHours())}:${two(now.getMinutes())}`,
    "Author: StroyKroy", "Sample Size: 1", "Grade Rule Table: StroyKroy", "Units: METRIC"];
  head.forEach((h, k) => { g(0, "TEXT"); g(8, "1"); g(10, "-10.0000"); g(20, (12 + k * 10).toFixed(4)); g(40, "8.0000"); g(1, h); });
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\n") + "\n";
}

/**
 * Файл таблицы градации ANSI/AAMA (.rul) к DXF-AAMA. Выгружается один размер, поэтому правило одно — «# 1» с нулевым смещением.
 * CLO3D и другие программы читают DXF-AAMA вместе с .rul одного имени.
 */
export function exportAamaRule(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return [
    "ANSI/AAMA VERSION:V8R1 ",
    "AUTHOR: StroyKroy",
    `CREATION DATE: ${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()}`,
    `CREATION TIME: ${two(now.getHours())}:${two(now.getMinutes())}`,
    "UNITS: METRIC",
    "GRADE RULE TABLE: StroyKroy",
    "NUMBER OF SIZES: 1",
    "SIZE LIST: 1",
    "SAMPLE SIZE: 1",
    "RULE: DELTA 1",
    "     0.0000,     0.0000",
    "END",
    "",
  ].join("\n");
}

// ==================================================================== PDF

const PT = 72 / 2.54; // пунктов PDF в сантиметре
const num = (x: number) => (Math.abs(x) < 1e-6 ? "0" : x.toFixed(2).replace(/\.?0+$/, ""));
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

type ToPage = (p: Point) => [number, number];

const ASCII_FALLBACK: Record<string, string> = { "→": "->", "←": "<-", "↓": "v", "↑": "^", "·": "-", "—": "-", "–": "-", "«": "\"", "»": "\"" };

/** Шрифты PDF: вшитый TrueType (русский текст) или стандартный Helvetica с транслитерацией. */
class FontKit {
  private faces: { font: TtfFont; ttf: Uint8Array; used: Map<number, number> }[] = [];
  readonly hasBold: boolean;
  constructor(private data?: PdfFontData) {
    if (data) {
      const mk = (ttf: Uint8Array) => ({ font: parseTtf(ttf), ttf, used: new Map<number, number>() });
      this.faces.push(mk(data.regular));
      this.hasBold = !!data.bold;
      if (data.bold) this.faces.push(mk(data.bold));
    } else this.hasBold = false;
  }
  get embedded() { return !!this.data; }
  private face(bold: boolean) { return this.faces[bold && this.hasBold ? 1 : 0]; }
  private ascii(t: string) { return translit([...t].map((ch) => ASCII_FALLBACK[ch] ?? ch).join("")); }
  width(bold: boolean, text: string, size: number): number {
    if (!this.data) return this.ascii(text).length * size * (bold ? 0.6 : 0.55);
    const f = this.face(bold).font;
    let w = 0;
    for (const ch of text) w += f.advance(f.glyphOf(ch.codePointAt(0)!));
    return (w / f.unitsPerEm) * size;
  }
  /** Строка для оператора Tj. */
  show(bold: boolean, text: string): string {
    if (!this.data) return `(${esc(this.ascii(text))}) Tj`;
    const fc = this.face(bold);
    let hex = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!, g = fc.font.glyphOf(cp);
      if (g) fc.used.set(g, cp);
      hex += g.toString(16).padStart(4, "0");
    }
    return `<${hex}> Tj`;
  }
  /** Объекты вшитых шрифтов: дописывает в objs и возвращает тела объектов 3 и 4 (F1, F2). */
  emit(add: (body: string) => number): [string, string] | null {
    if (!this.data) return null;
    const bin = (u8: Uint8Array) => { let r = ""; for (let i = 0; i < u8.length; i += 8192) r += String.fromCharCode(...u8.subarray(i, i + 8192)); return r; };
    const tops = this.faces.map((fc, idx) => {
      const f = fc.font, k = 1000 / f.unitsPerEm;
      const name = `SKFont${idx === 0 ? "R" : "B"}`;
      const sub = f.subset(fc.used.keys());
      const packed = this.data!.deflate ? this.data!.deflate(sub) : sub;
      const file = add(`<< /Length ${packed.length} /Length1 ${sub.length}${this.data!.deflate ? " /Filter /FlateDecode" : ""} >>\nstream\n${bin(packed)}\nendstream`);
      const fd = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${f.bbox.map((x) => Math.round(x * k)).join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * k)} /Descent ${Math.round(f.descent * k)} /CapHeight ${Math.round(f.ascent * k * 0.73)} /StemV ${idx === 0 ? 80 : 140} /FontFile2 ${file} 0 R >>`);
      const gids = [...fc.used.keys()].sort((x, y) => x - y);
      const W = gids.map((g) => `${g} [${Math.round(f.advance(g) * k)}]`).join(" ");
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /CIDToGIDMap /Identity /DW 600 /W [${W}] >>`);
      const hex4 = (n: number) => n.toString(16).padStart(4, "0");
      const pairs = gids.map((g) => `<${hex4(g)}> <${hex4(fc.used.get(g)!)}>`);
      let bf = "";
      for (let i = 0; i < pairs.length; i += 100) { const part = pairs.slice(i, i + 100); bf += `${part.length} beginbfchar\n${part.join("\n")}\nendbfchar\n`; }
      const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${bf}endcmap CMapName currentdict /CMap defineresource pop end end`;
      const tu = add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
      return `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`;
    });
    return [tops[0], tops[1] ?? tops[0]];
  }
}

/** Одна надпись: левый нижний угол текста в (x, y) пунктов. */
const txt = (kit: FontKit, bold: boolean, size: number, x: number, y: number, s: string) =>
  `BT /F${bold ? 2 : 1} ${size} Tf ${num(x)} ${num(y)} Td ${kit.show(bold, s)} ET`;

/** Операторы PDF для всех деталей; toPage переводит сантиметры чертежа в пункты страницы. */
function drawOps(placed: Placed[], toPage: ToPage, kit: FontKit): string {
  const o: string[] = [];
  const path = (pts: Point[], close: boolean) => {
    pts.forEach((p, i) => { const [x, y] = toPage(p); o.push(`${num(x)} ${num(y)} ${i === 0 ? "m" : "l"}`); });
    if (close) o.push("h");
  };
  for (const p of placed) {
    const [r, g, b] = rgb(p.color);
    if (p.allowance) { o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 0.6 w [6 4] 0 d`); path(p.allowance, true); o.push("S Q"); }
    o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 0.5 w`);
    for (const l of p.inner) { path(l, false); o.push("S"); }
    o.push("Q");
    o.push(`q ${num(r)} ${num(g)} ${num(b)} rg ${num(r)} ${num(g)} ${num(b)} RG`);
    for (const ip of p.innerPoints) { const [x, y] = toPage(ip); o.push(`${num(x - 1.2)} ${num(y - 1.2)} 2.4 2.4 re f`); }
    o.push("Q");
    o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 0.9 w`);
    for (const n of p.notches) { path(n, false); o.push("S"); }
    o.push("Q");
    if (p.grain) { o.push(`q 0.35 0.35 0.35 RG 0.5 w [1 3] 0 d`); path(p.grain, false); o.push("S Q"); }
    o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 1.1 w`); path(p.outline, true); o.push("S Q");
    const [tx, ty] = toPage({ x: p.center.x, y: p.center.y });
    const cnt = p.count && p.count > 0 ? `Крой: ${p.count} шт.` : "";
    const nameLine = txt(kit, true, 10, tx - kit.width(true, p.name, 10) / 2, ty + (cnt ? 1 : -3), p.name);
    const cntLine = cnt ? txt(kit, false, 8.5, tx - kit.width(false, cnt, 8.5) / 2, ty - 10, cnt) : "";
    o.push(`q ${num(r)} ${num(g)} ${num(b)} rg ${nameLine} ${cntLine} Q`);
  }
  return o.join("\n");
}

/** 10-сантиметровая контрольная линия по ширине: по ней проверяют, что при печати не включено масштабирование. */
function rulerOps(x: number, y: number, kit: FontKit): string {
  const L = 10 * PT;
  return `q 0 0 0 RG 0.8 w ${num(x)} ${num(y)} m ${num(x + L)} ${num(y)} l S ${num(x)} ${num(y - 3)} m ${num(x)} ${num(y + 3)} l S ${num(x + L)} ${num(y - 3)} m ${num(x + L)} ${num(y + 3)} l S ${txt(kit, false, 7, x + L + 6, y - 2.5, "10 см по ширине — проверьте, что печать в масштабе 100%")} Q`;
}

/** То же по высоте: вертикальная линия 10 см, подпись повёрнута вдоль неё. */
function rulerVOps(x: number, yTop: number, kit: FontKit): string {
  const L = 10 * PT, yBot = yTop - L;
  const label = "10 см по высоте";
  const tw = kit.width(false, label, 7);
  const lab = `BT /F1 7 Tf 0 1 -1 0 ${num(x + 11)} ${num(yTop - L / 2 - tw / 2)} Tm ${kit.show(false, label)} ET`;
  return `q 0 0 0 RG 0.8 w ${num(x)} ${num(yTop)} m ${num(x)} ${num(yBot)} l S ${num(x - 3)} ${num(yTop)} m ${num(x + 3)} ${num(yTop)} l S ${num(x - 3)} ${num(yBot)} m ${num(x + 3)} ${num(yBot)} l S ${lab} Q`;
}

/** Крупный бледный знак по диагонали листа в трёх местах: виден на любом фрагменте, лежит под чертежом. */
function stampOps(w: number, h: number, text: string | undefined, kit: FontKit): string {
  if (!text) return "";
  const ang = Math.atan2(h, w) * 0.9; // вдоль диагонали листа
  const c = Math.cos(ang), sn = Math.sin(ang);
  const size = Math.max(14, Math.min(48, (Math.hypot(w, h) * 0.8) / Math.max(1, kit.width(true, text, 1))));
  const half = kit.width(true, text, size) / 2;
  const out: string[] = [];
  for (const fy of [0.2, 0.5, 0.8]) {
    const cx = w / 2, cy = h * fy;
    const x = cx - half * c + size * 0.3 * sn, y = cy - half * sn - size * 0.3 * c;
    out.push(`q 0.86 g BT /F2 ${num(size)} Tf ${c.toFixed(4)} ${sn.toFixed(4)} ${(-sn).toFixed(4)} ${c.toFixed(4)} ${num(x)} ${num(y)} Tm ${kit.show(true, text)} ET Q`);
  }
  return out.join("\n");
}

function buildPdf(pages: { w: number; h: number; content: string }[], title: string, kit: FontKit): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES_PLACEHOLDER");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  let hexTitle = "FEFF";
  for (let i = 0; i < title.length; i++) hexTitle += title.charCodeAt(i).toString(16).padStart(4, "0");
  const infoNo = add(`<< /Title <${hexTitle}> /Producer (StroyKroy) >>`);
  const kids: number[] = [];
  const f2 = kit.embedded && !kit.hasBold ? 3 : 4;
  for (const pg of pages) {
    const contentNo = objs.length + 2;
    const pageNo = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}] /Resources << /Font << /F1 3 0 R /F2 ${f2} 0 R >> >> /Contents ${contentNo} 0 R >>`);
    add(`<< /Length ${pg.content.length} >>\nstream\n${pg.content}\nendstream`);
    kids.push(pageNo);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const tops = kit.emit(add);
  if (tops) { objs[2] = tops[0]; objs[3] = tops[1]; }

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff; // строки хранят байты (шрифт — двоичный)
  return bytes;
}

/** PDF в натуральную величину на одном листе по размеру деталей (для плоттера или печати на заказ). */
export function exportPdf(pieces: Piece[], opts: ExportOptions = {}): Uint8Array {
  const kit = new FontKit(opts.font);
  const { placed } = placePieces(pieces, opts);
  const b = boundsOf(placed);
  const mg = 1.5; // поле, см
  const wCm = b.maxX - b.minX + 2 * mg, hCm = b.maxY - b.minY + 2 * mg + 1.5;
  const w = wCm * PT, h = hCm * PT;
  if (w > 14400 || h > 14400) throw new Error("Детали не помещаются на одном листе PDF (больше 5 м) — используйте PDF по листам A4.");
  const toPage: ToPage = (p) => [(p.x - b.minX + mg) * PT, h - (p.y - b.minY + mg + 1.5) * PT];
  const head = `q 0.3 g ${txt(kit, false, 8, mg * PT, h - 0.9 * PT, `${opts.title ?? "СтройКрой"} · в натуральную величину 1:1`)} Q`;
  const vr = hCm >= 14 ? rulerVOps(w - 0.8 * PT, h - 2 * PT, kit) : "";
  const content = [stampOps(w, h, opts.stamp, kit), head, drawOps(placed, toPage, kit), rulerOps(mg * PT, 0.8 * PT, kit), vr].join("\n");
  return buildPdf([{ w, h, content }], opts.title ?? "StroyKroy", kit);
}

export function exportPdfA4(pieces: Piece[], opts: ExportOptions = {}): Uint8Array {
  const kit = new FontKit(opts.font);
  const { placed } = placePieces(pieces, opts);
  const b = boundsOf(placed);
  const PW = 595.276, PH = 841.89, mgPt = 1 * PT;
  const tw = (PW - 2 * mgPt) / PT, th = (PH - 2 * mgPt) / PT; // печатная область листа, см
  const overlap = 1;
  const x0 = b.minX - 0.5, y0 = b.minY - 0.5;
  const W = b.maxX - b.minX + 1, H = b.maxY - b.minY + 1;
  const nx = Math.max(1, Math.ceil((W - overlap) / (tw - overlap))), ny = Math.max(1, Math.ceil((H - overlap) / (th - overlap)));

  // отрезки для проверки «в листе что-то есть»
  const segs: [Point, Point][] = [];
  const addPoly = (pts: Point[]) => { for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]); };
  for (const p of placed) { addPoly(p.outline); if (p.allowance) addPoly(p.allowance); p.inner.forEach(addPoly); p.notches.forEach(addPoly); if (p.grain) addPoly(p.grain); }
  const hits = (rx0: number, ry0: number, rx1: number, ry1: number) =>
    segs.some(([a, c]) => Math.max(a.x, c.x) >= rx0 && Math.min(a.x, c.x) <= rx1 && Math.max(a.y, c.y) >= ry0 && Math.min(a.y, c.y) <= ry1);

  const tiles: { r: number; c: number }[] = [];
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const tx = x0 + c * (tw - overlap), ty = y0 + r * (th - overlap);
    if (hits(tx, ty, tx + tw, ty + th)) tiles.push({ r, c });
  }
  const total = tiles.length;
  const pages = tiles.map(({ r, c }, idx) => {
    const tx = x0 + c * (tw - overlap), ty = y0 + r * (th - overlap);
    const toPage: ToPage = (p) => [mgPt + (p.x - tx) * PT, PH - mgPt - (p.y - ty) * PT];
    const clip = `q ${num(mgPt)} ${num(mgPt)} ${num(tw * PT)} ${num(th * PT)} re W n`;
    const frame = `q 0.6 G 0.4 w ${num(mgPt)} ${num(mgPt)} ${num(tw * PT)} ${num(th * PT)} re S Q`;
    const label = `Лист ${r + 1}-${c + 1} · стр. ${idx + 1} из ${total} · ${opts.title ?? "СтройКрой"} · печатать в масштабе 100%`;
    const arrows: string[] = [];
    if (c < nx - 1) arrows.push(txt(kit, false, 8, PW - mgPt - 8 - kit.width(false, `→ ${r + 1}-${c + 2}`, 8), PH / 2, `→ ${r + 1}-${c + 2}`));
    if (c > 0) arrows.push(txt(kit, false, 8, mgPt + 2, PH / 2, `← ${r + 1}-${c}`));
    if (r < ny - 1) arrows.push(txt(kit, false, 8, PW / 2 - 14, mgPt - 10, `↓ ${r + 2}-${c + 1}`));
    if (r > 0) arrows.push(txt(kit, false, 8, PW / 2 - 14, PH - mgPt + 4, `↑ ${r}-${c + 1}`));
    const content = [
      stampOps(PW, PH, opts.stamp, kit), clip, drawOps(placed, toPage, kit), "Q", frame,
      `q 0.3 g ${txt(kit, false, 7, mgPt, PH - mgPt + 14, label)} Q`,
      `q 0.3 g ${arrows.join(" ")} Q`,
      rulerOps(mgPt, 8, kit),
      rulerVOps(PW - 20, PH - mgPt - 6, kit),
    ].join("\n");
    return { w: PW, h: PH, content };
  });
  return buildPdf(pages, opts.title ?? "StroyKroy", kit);
}
