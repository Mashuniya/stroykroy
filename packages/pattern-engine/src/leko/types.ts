/**
 * Типы для построения выкройки — по образцу языка Leko (СПО «ЛЕКО»), но с
 * английскими именами операторов и полей (чтобы не переключать раскладку).
 * Семантика и система координат — как в оригинале:
 * http://lekala.info/leko/dn/802.pdf
 *
 * Координаты: X слева направо, Y сверху вниз, 1 единица = 1 см. Угол — от оси
 * X к оси Y в градусах; т.к. Y направлена вниз, положительное направление —
 * по часовой стрелке.
 */

export interface Point {
  x: number;
  y: number;
}

/** Отрезок / неявное [a:b] из Leko. Поля: p1/p2, x1/y1/x2/y2, dx/dy, angle1/angle2 (°), length. */
export interface Segment {
  p1: Point;
  p2: Point;
  x1: number; y1: number;
  x2: number; y2: number;
  dx: number; dy: number;
  angle1: number; // угол от p1 к p2
  angle2: number; // угол от p2 к p1 (= angle1+180)
  length: number;
}

/** Дуга: центр, радиус, начальный/конечный полярный угол (°), точки концов, касательные, длина. */
export interface Arc {
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
  p1: Point; // точка на startAngle
  p2: Point; // точка на endAngle
  tangentAngle1: number;
  tangentAngle2: number;
  length: number;
}

/** Ломаная — непрерывная кривая как список точек (упрощённо хранит отрезки, дуги, сплайны как точки). */
export interface Polyline {
  points: Point[];
  angle1: number; // касательная в начале
  angle2: number; // касательная в конце
  length: number;
}

export type Line = Segment | Arc | Polyline;

export function isPolyline(x: unknown): x is Polyline {
  return !!x && typeof x === "object" && Array.isArray((x as Polyline).points);
}
export function isSegment(x: unknown): x is Segment {
  // у дуги тоже есть p1/p2 (концы) — отличаем по наличию центра, иначе дуга считалась бы отрезком
  return !!x && typeof x === "object" && "p1" in x && "p2" in x && !("points" in x) && !("center" in x);
}
export function isArc(x: unknown): x is Arc {
  return !!x && typeof x === "object" && "center" in x && "radius" in x;
}

/** Приводит отрезок/дугу/ломаную к единому списку точек вдоль линии (для деления, откладывания вдоль, пересечений). */
export function linePoints(line: Line, steps = 24): Point[] {
  if (isPolyline(line)) return line.points;
  if (isSegment(line)) return [line.p1, line.p2];
  const pts: Point[] = [];
  const a1 = line.startAngle, a2 = line.endAngle;
  for (let i = 0; i <= steps; i++) {
    const a = a1 + ((a2 - a1) * i) / steps;
    const rad = (a * Math.PI) / 180;
    pts.push({ x: line.center.x + line.radius * Math.cos(rad), y: line.center.y + line.radius * Math.sin(rad) });
  }
  return pts;
}
