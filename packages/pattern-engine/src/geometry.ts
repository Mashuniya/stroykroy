import type { Point } from "./types.js";

export const deg2rad = (d: number): number => (d * Math.PI) / 180;

export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Пересечение двух окружностей — ровно та операция, которую в оригинале
 * методики выполняют циркулем ("засечка"). Возвращает 0, 1 или 2 точки.
 */
export function circleIntersect(c1: Point, r1: number, c2: Point, r2: number): Point[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const xm = c1.x + (a * dx) / d;
  const ym = c1.y + (a * dy) / d;
  return [
    { x: xm + (h * dy) / d, y: ym - (h * dx) / d },
    { x: xm - (h * dy) / d, y: ym + (h * dx) / d },
  ];
}

/** Пересечение окружности с вертикальной прямой x = lineX. */
export function circleVerticalLineIntersect(c: Point, r: number, lineX: number): Point[] {
  const dx = lineX - c.x;
  const under = r * r - dx * dx;
  if (under < 0) return [];
  const dy = Math.sqrt(under);
  return [{ x: lineX, y: c.y - dy }, { x: lineX, y: c.y + dy }];
}

/** Выбирает из кандидатов точку с минимальным значением scoreFn (или null). */
export function pick(cands: Point[], scoreFn: (p: Point) => number): Point | null {
  if (cands.length === 0) return null;
  return [...cands].sort((a, b) => scoreFn(a) - scoreFn(b))[0];
}

export function rotateAround(p: Point, c: Point, angleDeg: number): Point {
  const a = deg2rad(angleDeg);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {
    x: c.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: c.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}
