import type { Point } from "./types.js";
import type { Piece } from "./piece.js";
import { pieceKeys } from "./piece.js";
import type { PieceTransform } from "./render-script-svg.js";

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
  target?: "cad" | "clo";
  /** Заголовок — печатается в углу PDF (латиницей: русские буквы транслитерируются). */
  title?: string;
}

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
 * DXF (AutoCAD R12, ASCII — открывается практически любой САПР и раскройной программой).
 * Единицы — сантиметры. Слои: CONTOUR (контур), ALLOWANCE (припуск, штриховая), INNER (внутренние линии и метки),
 * NOTCH (надсечки), GRAIN (долевая), TEXT (имя детали). Ось Y направлена вверх, как принято в DXF.
 */
export function exportDxf(pieces: Piece[], opts: ExportOptions = {}): string {
  const { placed } = placePieces(pieces, opts);
  if (opts.target === "clo") return exportDxfClo(placed);
  const b = boundsOf(placed);
  const L: string[] = [];
  const g = (code: number, value: string | number) => { L.push(String(code), String(value)); };
  const Y = (y: number) => -y; // экранная Y вниз → DXF Y вверх

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$EXTMIN"); g(10, f4(b.minX)); g(20, f4(Y(b.maxY)));
  g(9, "$EXTMAX"); g(10, f4(b.maxX)); g(20, f4(Y(b.minY)));
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "LTYPE"); g(2, "DASHED"); g(70, 0); g(3, "Dashed"); g(72, 65); g(73, 2); g(40, 0.75); g(49, 0.5); g(49, -0.25);
  g(0, "ENDTAB");
  const layers: [string, number, string][] = [["0", 7, "CONTINUOUS"], ["CONTOUR", 5, "CONTINUOUS"], ["ALLOWANCE", 1, "DASHED"], ["INNER", 3, "CONTINUOUS"], ["NOTCH", 5, "CONTINUOUS"], ["GRAIN", 8, "CONTINUOUS"], ["TEXT", 7, "CONTINUOUS"]];
  g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
  for (const [name, color, lt] of layers) { g(0, "LAYER"); g(2, name); g(70, 0); g(62, color); g(6, lt); }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

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
  for (const p of placed) {
    const col = ACI[p.color] ?? 5;
    const closedPts = (pts: Point[]) => (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6 ? pts.slice(0, -1) : pts);
    poly("CONTOUR", closedPts(p.outline), true, col);
    if (p.allowance) poly("ALLOWANCE", closedPts(p.allowance), true, col);
    for (const l of p.inner) poly("INNER", l, false, col);
    for (const ip of p.innerPoints) { g(0, "POINT"); g(8, "INNER"); g(62, col); g(10, f4(ip.x)); g(20, f4(Y(ip.y))); g(30, 0); }
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

/** Убирает подряд идущие вершины ближе minEdge (миллиметровые звенья сетку 3D-программ только путают). */
function cleanPolygon(poly: Point[], minEdge: number): Point[] {
  const out: Point[] = [];
  for (const p of poly) if (out.length === 0 || dist(out[out.length - 1], p) >= minEdge) out.push(p);
  while (out.length > 3 && dist(out[0], out[out.length - 1]) < minEdge) out.pop();
  return out;
}
const areaOf = (poly: Point[]) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };

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
  let poly = cleanPolygon(cutPolygon(p).map((q) => ({ x: q.x, y: -q.y })), 0.1);
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

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$EXTMIN"); g(10, f4(minX)); g(20, f4(minY));
  g(9, "$EXTMAX"); g(10, f4(maxX)); g(20, f4(maxY));
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 1);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "ENDTAB");
  const layers = ["0", ...names, "GRAIN", "INTERNAL", "TEXT"];
  g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
  layers.forEach((n, i) => { g(0, "LAYER"); g(2, n); g(70, 0); g(62, i === 0 || n === "TEXT" ? 7 : n === "GRAIN" ? 8 : n === "INTERNAL" ? 3 : 5); g(6, "CONTINUOUS"); });
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  const poly = (layer: string, pts: Point[], closed: boolean) => {
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, f4(p.x)); g(20, f4(p.y)); g(30, 0); }
    g(0, "SEQEND"); g(8, layer);
  };
  placed.forEach((p, i) => {
    const cut = polys[i].poly;
    poly(names[i], cut, true);
    if (p.grain) {
      const a = Y(p.grain[0]), c = Y(p.grain[1]);
      if (strictlyInside([a, c], cut)) { g(0, "LINE"); g(8, "GRAIN"); g(10, f4(a.x)); g(20, f4(a.y)); g(30, 0); g(11, f4(c.x)); g(21, f4(c.y)); g(31, 0); }
    }
    for (const l of p.inner) { const pts = l.map(Y); if (pts.length >= 2 && strictlyInside(pts, cut)) poly("INTERNAL", pts, false); }
    for (const ip of p.innerPoints) { const q = Y(ip); if (strictlyInside([q], cut)) { g(0, "POINT"); g(8, "INTERNAL"); g(10, f4(q.x)); g(20, f4(q.y)); g(30, 0); } }
    const c = Y(p.center);
    if (strictlyInside([c], cut, 1)) { g(0, "TEXT"); g(8, "TEXT"); g(10, f4(c.x)); g(20, f4(c.y - 2)); g(30, 0); g(40, 1.2); g(1, translit(p.name)); g(72, 1); g(11, f4(c.x)); g(21, f4(c.y - 2)); g(31, 0); }
  });
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\n") + "\n";
}

// ==================================================================== PDF

const PT = 72 / 2.54; // пунктов PDF в сантиметре
const num = (x: number) => (Math.abs(x) < 1e-6 ? "0" : x.toFixed(2).replace(/\.?0+$/, ""));
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

type ToPage = (p: Point) => [number, number];

/** Операторы PDF для всех деталей; toPage переводит сантиметры чертежа в пункты страницы. */
function drawOps(placed: Placed[], toPage: ToPage): string {
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
    const label = translit(p.name);
    o.push(`q ${num(r)} ${num(g)} ${num(b)} rg BT /F2 10 Tf ${num(tx - label.length * 2.8)} ${num(ty - 3)} Td (${esc(label)}) Tj ET Q`);
  }
  return o.join("\n");
}

/** 10-сантиметровая контрольная линия: по ней проверяют, что при печати не включено масштабирование. */
function rulerOps(x: number, y: number): string {
  const L = 10 * PT;
  return `q 0 0 0 RG 0.8 w ${num(x)} ${num(y)} m ${num(x + L)} ${num(y)} l S ${num(x)} ${num(y - 3)} m ${num(x)} ${num(y + 3)} l S ${num(x + L)} ${num(y - 3)} m ${num(x + L)} ${num(y + 3)} l S BT /F1 7 Tf ${num(x + L + 6)} ${num(y - 2.5)} Td (10 cm - check print scale 100%) Tj ET Q`;
}

function buildPdf(pages: { w: number; h: number; content: string }[], title: string): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES_PLACEHOLDER");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const infoNo = add(`<< /Title (${esc(translit(title))}) /Producer (StroyKroy) >>`);
  const kids: number[] = [];
  for (const pg of pages) {
    const contentNo = objs.length + 2;
    const pageNo = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
    add(`<< /Length ${pg.content.length} >>\nstream\n${pg.content}\nendstream`);
    kids.push(pageNo);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff; // весь файл — ASCII
  return bytes;
}

/** PDF в натуральную величину на одном листе по размеру деталей (для плоттера или печати на заказ). */
export function exportPdf(pieces: Piece[], opts: ExportOptions = {}): Uint8Array {
  const { placed } = placePieces(pieces, opts);
  const b = boundsOf(placed);
  const mg = 1.5; // поле, см
  const wCm = b.maxX - b.minX + 2 * mg, hCm = b.maxY - b.minY + 2 * mg + 1.5;
  const w = wCm * PT, h = hCm * PT;
  if (w > 14400 || h > 14400) throw new Error("Детали не помещаются на одном листе PDF (больше 5 м) — используйте PDF по листам A4.");
  const toPage: ToPage = (p) => [(p.x - b.minX + mg) * PT, h - (p.y - b.minY + mg + 1.5) * PT];
  const head = `q 0.3 g BT /F1 8 Tf ${num(mg * PT)} ${num(h - 0.9 * PT)} Td (${esc(translit(opts.title ?? "StroyKroy"))} - 1:1) Tj ET Q`;
  const content = [head, drawOps(placed, toPage), rulerOps(mg * PT, 0.8 * PT)].join("\n");
  return buildPdf([{ w, h, content }], opts.title ?? "StroyKroy");
}

/** PDF мозаикой по листам A4 (210×297 мм) с нахлёстом 1 см — печатается на домашнем принтере, листы склеиваются по меткам. */
export function exportPdfA4(pieces: Piece[], opts: ExportOptions = {}): Uint8Array {
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
    const label = `Sheet ${r + 1}-${c + 1} - page ${idx + 1} of ${total} - ${translit(opts.title ?? "StroyKroy")} - print at 100%`;
    const arrows: string[] = [];
    if (c < nx - 1) arrows.push(`BT /F1 8 Tf ${num(PW - mgPt - 52)} ${num(PH / 2)} Td (-> ${r + 1}-${c + 2}) Tj ET`);
    if (c > 0) arrows.push(`BT /F1 8 Tf ${num(mgPt + 2)} ${num(PH / 2)} Td (<- ${r + 1}-${c}) Tj ET`);
    if (r < ny - 1) arrows.push(`BT /F1 8 Tf ${num(PW / 2 - 14)} ${num(mgPt - 10)} Td (v ${r + 2}-${c + 1}) Tj ET`);
    if (r > 0) arrows.push(`BT /F1 8 Tf ${num(PW / 2 - 14)} ${num(PH - mgPt + 4)} Td (^ ${r}-${c + 1}) Tj ET`);
    const content = [
      clip, drawOps(placed, toPage), "Q", frame,
      `q 0.3 g BT /F1 7 Tf ${num(mgPt)} ${num(PH - mgPt + 14)} Td (${esc(label)}) Tj ET Q`,
      `q 0.3 g ${arrows.join(" ")} Q`,
      rulerOps(mgPt, 8),
    ].join("\n");
    return { w: PW, h: PH, content };
  });
  return buildPdf(pages, opts.title ?? "StroyKroy");
}
