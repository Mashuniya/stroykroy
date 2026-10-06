import type { Point, Segment, Arc, Polyline, Line } from "./types.js";
import { linePoints, isPolyline } from "./types.js";

const d2r = (d: number) => (d * Math.PI) / 180;
const r2d = (r: number) => (r * 180) / Math.PI;

// ========== Арифметические функции (как в Leko, раздел 1.4 справочника) ==========
export const ABS = Math.abs;
export const ATAN = (x: number) => r2d(Math.atan(x));
export const COS = (deg: number) => Math.cos(d2r(deg));
export const SIN = (deg: number) => Math.sin(d2r(deg));
export const EXP = Math.exp;
export const LN = Math.log;
export const ROUND = Math.round;
export const SQRT = Math.sqrt;
export const SQR = (x: number) => x * x;
export const TRUNC = Math.trunc;

// ========== point ==========
export function point(x: number, y: number): Point {
  return { x, y };
}

// ========== segment / [a:b] ==========
export function segment(p1: Point, p2: Point): Segment {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  const angle1 = r2d(Math.atan2(dy, dx));
  return { p1, p2, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, dx, dy, angle1, angle2: angle1 + 180, length };
}
/** Неявное [a:b] из Leko — используйте seg(a,b).length / seg(a,b).angle1 вместо [a:b].л / [a:b].ф1. */
export const seg = segment;
/** |a:b| — просто расстояние между точками. */
export function dist(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// ========== arc ==========
export function arc(center: Point, radius: number, startAngle: number, endAngle: number): Arc {
  const p1 = { x: center.x + radius * Math.cos(d2r(startAngle)), y: center.y + radius * Math.sin(d2r(startAngle)) };
  const p2 = { x: center.x + radius * Math.cos(d2r(endAngle)), y: center.y + radius * Math.sin(d2r(endAngle)) };
  const tangentAngle1 = startAngle + 90, tangentAngle2 = endAngle + 90;
  const length = Math.abs(d2r(endAngle - startAngle)) * radius;
  return { center, radius, startAngle, endAngle, p1, p2, tangentAngle1, tangentAngle2, length };
}

// ========== polyline ==========
export function polyline(...parts: (Point | Line)[]): Polyline {
  const points: Point[] = [];
  for (const part of parts) {
    const pts = "x" in part && "y" in part && !("p1" in part) ? [part as Point] : linePoints(part as Line);
    for (const p of pts) {
      if (points.length === 0 || Math.hypot(p.x - points[points.length - 1].x, p.y - points[points.length - 1].y) > 1e-9) {
        points.push(p);
      }
    }
  }
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const angle1 = points.length > 1 ? r2d(Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x)) : 0;
  const n = points.length;
  const angle2 = n > 1 ? r2d(Math.atan2(points[n - 1].y - points[n - 2].y, points[n - 1].x - points[n - 2].x)) : 0;
  return { points, angle1, angle2, length };
}
/** Знак "-" перед линией при сборке контура/ломаной в Leko — разворот направления. */
export function reverseLine(line: Line): Line {
  const pts = [...linePoints(line)].reverse();
  return polyline(...pts);
}

// ========== splineK / splineKK (сплайн_к / сплайн_кк) ==========
/**
 * splineK(p1, p2, tangent1, tangent2, k, steps=10) — плавная кривая через p1 и p2
 * с заданными углами касательных на концах (°) и коэффициентом выпуклости k
 * (раздел 1.9 справочника). Построена как кубическая кривая Безье: расстояние
 * контрольных точек от концов = k * |p1 p2|. При k=0 вырождается в прямую
 * (контрольные точки совпадают с концами) — как и описано в справочнике.
 * При увеличении k кривая становится более выпуклой.
 *
 * ⚠ В справочнике нет явной формулы, только словесное описание поведения —
 * числа (K=1.2 ≈ четверть окружности и т.п.) НЕ гарантированно совпадают с
 * оригиналом Leko, только общее поведение (0→прямая, рост→выпуклость).
 */
export function splineK(p1: Point, p2: Point, tangent1: number, tangent2: number, k: number, steps = 10): Polyline {
  const L = dist(p1, p2);
  const d = k * L;
  const c1 = { x: p1.x + d * Math.cos(d2r(tangent1)), y: p1.y + d * Math.sin(d2r(tangent1)) };
  const c2 = { x: p2.x - d * Math.cos(d2r(tangent2)), y: p2.y - d * Math.sin(d2r(tangent2)) };
  return bezierPolyline(p1, c1, c2, p2, steps);
}
/** splineKK — то же самое, но с отдельным коэффициентом асимметрии k2 (при k2=1 совпадает со splineK). */
export function splineKK(p1: Point, p2: Point, tangent1: number, tangent2: number, k1: number, k2: number, steps = 10): Polyline {
  const L = dist(p1, p2);
  const d1 = k1 * L, d2 = k1 * k2 * L;
  const c1 = { x: p1.x + d1 * Math.cos(d2r(tangent1)), y: p1.y + d1 * Math.sin(d2r(tangent1)) };
  const c2 = { x: p2.x - d2 * Math.cos(d2r(tangent2)), y: p2.y - d2 * Math.sin(d2r(tangent2)) };
  return bezierPolyline(p1, c1, c2, p2, steps);
}
function bezierPolyline(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): Polyline {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return polyline(...pts);
}

// ========== layOff (отложить) ==========
/**
 * layOff(point, angle, distance) → новая точка.
 * Поддерживает и цепочку: layOff(point, [[angle1,dist1],[angle2,dist2], ...]).
 */
export function layOff(p: Point, angleOrSteps: number | [number, number][], distance?: number): Point {
  if (Array.isArray(angleOrSteps)) {
    let cur = p;
    for (const [angle, d] of angleOrSteps) {
      cur = { x: cur.x + d * Math.cos(d2r(angle)), y: cur.y + d * Math.sin(d2r(angle)) };
    }
    return cur;
  }
  const d = distance ?? 0;
  return { x: p.x + d * Math.cos(d2r(angleOrSteps)), y: p.y + d * Math.sin(d2r(angleOrSteps)) };
}

/** layOffAlong — расстояние вдоль дуги/сплайна/ломаной (от начала). */
export function layOffAlong(line: Line, distance: number): Point {
  const pts = linePoints(line, 200);
  if (distance <= 0) return pts[0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + s >= distance) {
      const t = (distance - acc) / s;
      return { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
    }
    acc += s;
  }
  throw new Error("layOffAlong: расстояние больше длины линии");
}

// ========== split / splitByDirection ==========
export interface SplitResult {
  point: Point;
  part1: Polyline;
  part2: Polyline;
}
export function split(line: Line, distance: number): SplitResult {
  const pts = linePoints(line, 200);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + s >= distance) {
      const t = s === 0 ? 0 : (distance - acc) / s;
      const p = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
      return { point: p, part1: polyline(...pts.slice(0, i), p), part2: polyline(p, ...pts.slice(i)) };
    }
    acc += s;
  }
  throw new Error("split: расстояние больше длины линии");
}
/** splitByDirection — делит линию точкой пересечения с направлением (p, angle). */
export function splitByDirection(line: Line, p: Point, angle: number): SplitResult {
  const hit = intersectLineAndDirection(line, p, angle);
  if (!hit) throw new Error("splitByDirection: нет пересечения с направлением");
  const distance = nearestDistanceAlong(line, hit);
  return split(line, distance);
}
/** Проверка "можно ли разделить" без выполнения. */
export function canSplitByDirection(line: Line, p: Point, angle: number): boolean {
  return intersectLineAndDirection(line, p, angle) !== null;
}
function nearestDistanceAlong(line: Line, p: Point): number {
  const pts = linePoints(line, 200);
  let best = Infinity, acc = 0, bestAcc = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const t = s === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - pts[i - 1].x) * (pts[i].x - pts[i - 1].x) + (p.y - pts[i - 1].y) * (pts[i].y - pts[i - 1].y)) / (s * s)));
    const proj = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
    const d = Math.hypot(p.x - proj.x, p.y - proj.y);
    if (d < best) { best = d; bestAcc = acc + t * s; }
    acc += s;
  }
  return bestAcc;
}

// ========== intersect / intersectDirections / intersectCircles / intersectCircleDirection ==========
function intersect2Directions(p1: Point, angle1: number, p2: Point, angle2: number): Point | null {
  const d1x = Math.cos(d2r(angle1)), d1y = Math.sin(d2r(angle1));
  const d2x = Math.cos(d2r(angle2)), d2y = Math.sin(d2r(angle2));
  const det = d1x * -d2y - -d2x * d1y;
  if (Math.abs(det) < 1e-12) return null;
  const bx = p2.x - p1.x, by = p2.y - p1.y;
  const t = (bx * -d2y - -d2x * by) / det;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}
/** intersectDirections — пересечение двух направлений (p1,angle1) и (p2,angle2). */
export function intersectDirections(p1: Point, angle1: number, p2: Point, angle2: number): Point {
  const p = intersect2Directions(p1, angle1, p2, angle2);
  if (!p) throw new Error("Отсутствует пересечение (intersectDirections: направления параллельны)");
  return p;
}
function intersectLineAndDirection(line: Line, p: Point, angle: number): Point | null {
  const pts = linePoints(line, 400);
  const d = { x: Math.cos(d2r(angle)), y: Math.sin(d2r(angle)) };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ex = b.x - a.x, ey = b.y - a.y;
    const det = ex * -d.y - -d.x * ey;
    if (Math.abs(det) < 1e-12) continue;
    const bx = p.x - a.x, by = p.y - a.y;
    const t = (bx * -d.y - -d.x * by) / det;
    if (t >= -1e-9 && t <= 1 + 1e-9) return { x: a.x + t * ex, y: a.y + t * ey };
  }
  return null;
}
/** intersect — пересечение двух линий (отрезок/дуга/ломаная), заданных как объекты. */
export function intersect(l1: Line, l2: Line): Point {
  const pts1 = linePoints(l1, 200), pts2 = linePoints(l2, 200);
  for (let i = 1; i < pts1.length; i++) {
    for (let j = 1; j < pts2.length; j++) {
      const p = intersectSegSeg(pts1[i - 1], pts1[i], pts2[j - 1], pts2[j]);
      if (p) return p;
    }
  }
  throw new Error("Отсутствует пересечение");
}
function intersectSegSeg(a: Point, b: Point, c: Point, d: Point): Point | null {
  const ex = b.x - a.x, ey = b.y - a.y, fx = d.x - c.x, fy = d.y - c.y;
  const det = ex * -fy - -fx * ey;
  if (Math.abs(det) < 1e-12) return null;
  const bx = c.x - a.x, by = c.y - a.y;
  const t = (bx * -fy - -fx * by) / det;
  const s = (ex * by - ey * bx) / det;
  if (t < -1e-9 || t > 1 + 1e-9 || s < -1e-9 || s > 1 + 1e-9) return null;
  return { x: a.x + t * ex, y: a.y + t * ey };
}
/** intersectCircles — пересечение двух окружностей; sign=1|-1 выбирает одну из двух точек. */
export function intersectCircles(c1: Point, r1: number, c2: Point, r2: number, sign: number): Point {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) throw new Error("Отсутствует пересечение (intersectCircles)");
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const xm = c1.x + (a * dx) / d, ym = c1.y + (a * dy) / d;
  const p1 = { x: xm + (h * dy) / d, y: ym - (h * dx) / d };
  const p2 = { x: xm - (h * dy) / d, y: ym + (h * dx) / d };
  return sign >= 0 ? p1 : p2;
}
/** intersectCircleDirection — пересечение окружности и направления; sign=1|-1 выбирает точку. */
export function intersectCircleDirection(c: Point, r: number, p: Point, angle: number, sign: number): Point {
  const dx = Math.cos(d2r(angle)), dy = Math.sin(d2r(angle));
  const fx = p.x - c.x, fy = p.y - c.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) throw new Error("Отсутствует пересечение (intersectCircleDirection)");
  const sq = Math.sqrt(disc);
  const t1 = (-b + sq) / (2 * a), t2 = (-b - sq) / (2 * a);
  const p1 = { x: p.x + t1 * dx, y: p.y + t1 * dy };
  const p2 = { x: p.x + t2 * dx, y: p.y + t2 * dy };
  return sign >= 0 ? p1 : p2;
}

// ========== filletArc (сопряжение_д) ==========
/**
 * filletArc(p1, angle1, p2, angle2, r) → дуга, касательная к обеим линиям (радиус r).
 * ВАЖНО: сторона смещения — эвристика "влево от направления" для обеих линий.
 * Если дуга окажется не с той стороны — разверните angle1/angle2 на 180° при вызове.
 */
export function filletArc(p1: Point, angle1: number, p2: Point, angle2: number, r: number): Arc {
  const n1 = angle1 + 90, n2 = angle2 + 90;
  const o1 = { x: p1.x + r * Math.cos(d2r(n1)), y: p1.y + r * Math.sin(d2r(n1)) };
  const o2 = { x: p2.x + r * Math.cos(d2r(n2)), y: p2.y + r * Math.sin(d2r(n2)) };
  const center = intersect2Directions(o1, angle1, o2, angle2);
  if (!center) throw new Error("filletArc: линии параллельны — дуга не строится");
  const t1 = projectOntoLine(center, p1, angle1);
  const t2 = projectOntoLine(center, p2, angle2);
  const a1 = r2d(Math.atan2(t1.y - center.y, t1.x - center.x));
  const a2 = r2d(Math.atan2(t2.y - center.y, t2.x - center.x));
  return arc(center, r, a1, a2);
}
function projectOntoLine(p: Point, linePt: Point, angle: number): Point {
  const dx = Math.cos(d2r(angle)), dy = Math.sin(d2r(angle));
  const t = (p.x - linePt.x) * dx + (p.y - linePt.y) * dy;
  return { x: linePt.x + t * dx, y: linePt.y + t * dy };
}

// ========== mirror / mirrorPoint / translate / rotate ==========
function reflectPoint(p: Point, axis: Segment): Point {
  const dx = axis.dx, dy = axis.dy;
  const len2 = dx * dx + dy * dy;
  const vx = p.x - axis.p1.x, vy = p.y - axis.p1.y;
  const t = (vx * dx + vy * dy) / len2;
  const projx = axis.p1.x + t * dx, projy = axis.p1.y + t * dy;
  return { x: 2 * projx - p.x, y: 2 * projy - p.y };
}
/** mirror — осевая симметрия относительно отрезка (списком точек). */
export function mirror(points: Point[], axis: Segment): Point[] {
  return points.map((p) => reflectPoint(p, axis));
}
/** mirrorPoint — центральная симметрия относительно точки. */
export function mirrorPoint(points: Point[], center: Point): Point[] {
  return points.map((p) => ({ x: 2 * center.x - p.x, y: 2 * center.y - p.y }));
}
/** translate — перенос на вектор, заданный отрезком (или точкой — вектор от начала координат). */
export function translate(points: Point[], vector: Segment | Point): Point[] {
  const dx = "dx" in vector ? vector.dx : vector.x;
  const dy = "dy" in vector ? vector.dy : vector.y;
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}
/** rotate — поворот вокруг точки на угол, °. */
export function rotate(points: Point[], center: Point, angleDeg: number): Point[] {
  const a = d2r(angleDeg);
  const cos = Math.cos(a), sin = Math.sin(a);
  return points.map((p) => {
    const dx = p.x - center.x, dy = p.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  });
}

// ========== sizeFn (л_фнк) — табличная линейная интерполяция с линейной экстраполяцией ==========
export function sizeFn(value: number, table: [number, number][]): number {
  const pts = [...table].sort((a, b) => a[0] - b[0]);
  if (pts.length === 1) return pts[0][1];
  if (value <= pts[0][0]) {
    const [x0, y0] = pts[0], [x1, y1] = pts[1];
    return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0);
  }
  if (value >= pts[pts.length - 1][0]) {
    const [x0, y0] = pts[pts.length - 2], [x1, y1] = pts[pts.length - 1];
    return y1 + ((value - x1) * (y1 - y0)) / (x1 - x0);
  }
  for (let i = 1; i < pts.length; i++) {
    if (value <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

// ========== Сравнения (равно/больше/меньше округляют до целого — как в Leko) ==========
export const greater = (a: number, b: number) => a > b;
export const less = (a: number, b: number) => a < b;
export const equal = (a: number, b: number) => Math.round(a) === Math.round(b);
export const greaterR = (a: number, b: number) => Math.round(a) > Math.round(b);
export const lessR = (a: number, b: number) => Math.round(a) < Math.round(b);

// ========== exists (существует) ==========
/**
 * exists(x) — проверка, задан ли параметр (раздел 7 справочника, шаблон
 * "если ~par то par:=0 конец_если"). В реальном Leko переменные берутся из
 * общей таблицы, и необъявленная переменная просто "не существует". В JS
 * такого нет — необъявленный идентификатор кидает ReferenceError раньше,
 * чем вы успеете его проверить. ПОЭТОМУ: если параметр может быть не задан,
 * объявляйте его заранее как `let par_19;` (без значения = undefined), и
 * exists(par_19) будет работать как положено.
 */
export function exists(x: unknown): boolean {
  return x !== undefined && x !== null;
}

// ========== fit (совместить) ==========
/**
 * fit(shape, shapeP1, shapeP2, targetP1, targetP2) — раздел 8.15 справочника.
 * Переносит, поворачивает и масштабирует фигуру так, чтобы её точка shapeP1
 * легла на targetP1, а shapeP2 — на targetP2. Удобно для готовых фигурных
 * линий (рельефов, воланов и т.п.), которые нужно "натянуть" между двумя
 * точками на чертеже независимо от их исходного размера.
 */
export function fit(shape: Line, shapeP1: Point, shapeP2: Point, targetP1: Point, targetP2: Point): Polyline {
  const oldVecAngle = r2d(Math.atan2(shapeP2.y - shapeP1.y, shapeP2.x - shapeP1.x));
  const oldLen = dist(shapeP1, shapeP2);
  const newVecAngle = r2d(Math.atan2(targetP2.y - targetP1.y, targetP2.x - targetP1.x));
  const newLen = dist(targetP1, targetP2);
  if (oldLen < 1e-9) throw new Error("fit: shapeP1 и shapeP2 совпадают — не могу определить масштаб/поворот");
  const scale = newLen / oldLen;
  const angleDelta = newVecAngle - oldVecAngle;
  const rad = d2r(angleDelta);
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const pts = linePoints(shape).map((p) => {
    const dx = (p.x - shapeP1.x) * scale, dy = (p.y - shapeP1.y) * scale;
    const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
    return { x: targetP1.x + rx, y: targetP1.y + ry };
  });
  return polyline(...pts);
}

// ========== label (метка) ==========
/**
 * label(center, type, angle, len, width) — раздел 10.1 справочника: маленькая
 * внутренняя метка на лекале (разметка петель, карманов и т.п.). Контур метки
 * задаётся относительно прямоугольника len×width с центром в center, повёрнутого
 * на angle (°). Типы: 1 — отрезок, 2 — прямоугольник, 3 — крестик (+),
 * 4 — Т-образная, 5 — крестовина (×), 6 — уголок, 7 — треугольник, 8 — Н-образная.
 * ⚠ Формы 3-8 восстановлены по названиям из справочника (самих картинок там нет):
 * если у вас в Leko «крестик» и «крестовина» выглядят наоборот — скажите, поменяю.
 */
export function label(center: Point, type: number, angle: number, len: number, width: number): Polyline {
  const rad = d2r(angle);
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const toWorld = (lx: number, ly: number): Point => ({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
  const L = len / 2, W = width / 2;
  const shapes: Record<number, [number, number][]> = {
    1: [[-L, 0], [L, 0]],
    2: [[-L, -W], [L, -W], [L, W], [-L, W], [-L, -W]],
    3: [[-L, 0], [L, 0], [0, 0], [0, -W], [0, W]],
    4: [[-L, -W], [L, -W], [0, -W], [0, W]],
    5: [[-L, -W], [L, W], [0, 0], [-L, W], [L, -W]],
    6: [[-L, -W], [-L, W], [L, W]],
    7: [[-L, W], [L, W], [0, -W], [-L, W]],
    8: [[-L, -W], [-L, W], [-L, 0], [L, 0], [L, -W], [L, W]],
  };
  const shape = shapes[type];
  if (!shape) throw new Error(`label: тип метки ${type} не реализован (есть 1-8)`);
  return polyline(...shape.map(([x, y]) => toWorld(x, y)));
}

// ========== outline (упрощённый аналог ЗАПИСАТЬ — для предпросмотра контура лекала) ==========
/**
 * outline(name, ...parts) — собирает готовый контур лекала в замкнутую
 * ломаную (для отрисовки отдельным, более жирным контуром). Это НЕ полный
 * аналог оператора ЗАПИСАТЬ из раздела 10 справочника (там ещё код лекала,
 * внутренние линии, долевая, прибавки на швы, маркировка) — просто способ
 * увидеть итоговый контур целиком, отдельно от вспомогательных построений.
 */
export function outline(name: string, ...parts: (Point | Line)[]): Polyline & { name: string } {
  const open = polyline(...parts);
  const closed = open.points.length > 0 ? polyline(...open.points, open.points[0]) : open;
  return Object.assign(closed, { name });
}

/**
 * Угол при вершине B треугольника A-B-C (⚠ реконструкция по способу
 * использования в примерах пользователя — формального определения в
 * справочнике не нашлось, не гарантированно совпадает с оригиналом).
 */
export function angleAt(A: Point, B: Point, C: Point): number {
  const a1 = Math.atan2(A.y - B.y, A.x - B.x);
  const a2 = Math.atan2(C.y - B.y, C.x - B.x);
  let diff = r2d(a2 - a1);
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return Math.abs(diff);
}
