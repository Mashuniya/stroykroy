import type { Point, Segment, Polyline, Line } from "./types.js";
import { isText, type TextItem, linePoints } from "./types.js";
import { polyline, segment, label, layOff } from "./ops.js";

/**
 * writePiece — аналог оператора ЗАПИСАТЬ из языка Leko (справочник 802.pdf,
 * раздел 10 и 14.4): собирает из точек и линий готовую деталь — контур,
 * внутренние линии, метки, надсечки, долевую — и обводит её припуском на швы.
 */

export type ContourPart = Point | Line;
/** Положение метки: точка | [точка, угол, расстояние] | [точка, [[угол, расст], ...]] (как оператор отложить). */
export type MarkPlace = Point | [Point, number, number] | [Point, [number, number][]];

export interface PieceSpec {
  /** Имя детали (на чертеже подписывается). */
  name: string;
  /** Код детали (внутрипроизводственная кодировка, до 20 символов). */
  code?: string;
  /** Контур: точки и линии подряд; направление не важно (приводится к одному). Линию в обратную сторону — reverseLine(линия). */
  contour: ContourPart[];
  /** Внутренние линии: каждый элемент — точка (отдельная точка) | линия | массив [точки/линии] (одна ломаная). */
  inner?: (ContourPart | ContourPart[])[];
  /** Метки: [тип 1-8, угол, длина, ширина, положение] — см. label(). */
  marks?: [number, number, number, number, MarkPlace][];
  /** Надсечки: точки; ставится проекция точки на контур (короткая засечка наружу). */
  notches?: Point[];
  /** Долевая: [точка, угол°]; не задана — вертикально вниз, как в Leko. */
  grain?: [Point, number];
  /** Сколько раз кроить деталь (подпись «Крой: N шт.» на чертеже). */
  count?: number;
  /** Общий припуск на швы, см. */
  allowance?: number;
  /**
   * Припуск по участкам (как прибавка_у в Leko): [начальная точка, припуск у начала,
   * припуск у конца, конечная точка] — вдоль контура от начала к концу припуск меняется
   * линейно; вне участков действует общий. Точки должны лежать на контуре.
   */
  allowanceZones?: [Point | Line, number, number, Point | Line][];
  /** Номер цвета Leko 1-15 (см. таблицу в справочнике, 10.2). */
  color?: number;
  /** Полотно (материал) — только подпись. */
  fabric?: string;
}

export interface Piece {
  kind: "piece";
  name: string;
  /** Сколько раз кроить деталь. */
  count?: number;
  code?: string;
  fabric?: string;
  color: number;
  /** Замкнутый контур (первая точка повторена в конце). */
  outline: Polyline;
  /** Внешний контур с припусками (замкнутый) или null, если припусков нет. */
  allowance: Polyline | null;
  /** Внутренние линии и метки. */
  inner: Polyline[];
  /** Отдельные внутренние точки. */
  innerPoints: Point[];
  /** Надписи внутри детали (нарисовать_текст). */
  texts: TextItem[];
  /** Надсечки — короткие засечки. */
  notches: Polyline[];
  /** Номера в inner тех меток, что стоят на контуре (надсечки-палочки): без линии шва их не печатаем — остаётся высечка на припуске. */
  contourMarks?: number[];
  grain: Segment | null;
  /** Площадь детали по контуру, см². */
  area: number;
  /** Центр тяжести контура — тут рисуется крупная точка, за которую деталь можно взять и двигать. */
  center: Point;
}

/** Ключи деталей для хранения их положения: имя, а у повторяющихся имён — имя#1, имя#2… (порядок записи). */
export function pieceKeys(pieces: Piece[]): string[] {
  const seen: Record<string, number> = {};
  return pieces.map((pc) => { const n = seen[pc.name] ?? 0; seen[pc.name] = n + 1; return n === 0 ? pc.name : `${pc.name}#${n}`; });
}

/**
 * Высота надписи, при которой она целиком лежит внутри контура детали: не помещается — уменьшаем, пока не поместится.
 * Угол — как у надписей на чертеже (по часовой на экране); centered — точка в середине надписи, иначе надпись начинается от неё.
 * Точка вне контура (вогнутая деталь, надпись намеренно снаружи) — размер не меняем: уменьшение тут не поможет.
 */
export function fitTextHeight(poly: Point[], at: Point, angleDeg: number, chars: number, h0: number, centered = false, minH = 0.1): number {
  if (!(h0 > 0) || chars <= 0) return h0;
  const r = (angleDeg * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r), ux = dy, uy = -dx;
  const fits = (h: number) => {
    const w = chars * h * 0.68, s = centered ? -w / 2 : 0, v = centered ? -h / 2 : 0; // 0.68 — средняя ширина буквы относительно высоты, с запасом
    for (const a of [0, 0.25, 0.5, 0.75, 1]) for (const b of [0, 1]) {
      const along = s + a * w, up = v + b * h;
      if (!insidePoly({ x: at.x + dx * along + ux * up, y: at.y + dy * along + uy * up }, poly)) return false;
    }
    return true;
  };
  if (fits(h0)) return h0;
  if (!insidePoly(at, poly)) return h0;
  for (let h = h0 * 0.9; h > minH; h *= 0.9) if (fits(h)) return h;
  return minH;
}

/** Наконечник стрелки долевой на конце b: [крыло, b, крыло]. */
export function grainArrow(a: Point, b: Point): Point[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const h = Math.min(0.8, len * 0.3), w = h * 0.35;
  return [{ x: b.x - ux * h - uy * w, y: b.y - uy * h + ux * w }, b, { x: b.x - ux * h + uy * w, y: b.y - uy * h - ux * w }];
}

/**
 * Убирает из замкнутого контура «возвраты»: точки на одной прямой идут вперёд, назад и снова вперёд (бывает в алгоритмах Leko,
 * например ломаная листочки). На контуре их не видно — линии лежат одна на другой, а припуск от такого места даёт острый выступ.
 */
function dropSpurs(pts: Point[]): Point[] {
  const out = [...pts];
  for (let i = 0; out.length > 3 && i < out.length; ) {
    const n = out.length, a = out[(i + n - 1) % n], b = out[i], c = out[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    const same = lv < 1e-6 || lu < 1e-6;
    const back = !same && Math.abs(ux * vy - uy * vx) <= 1e-3 * lu * lv && ux * vx + uy * vy < 0;
    if (same || back) { out.splice(i, 1); i = Math.max(0, i - 1); } else i++;
  }
  return out.length >= 3 ? out : pts;
}

export function isPiece(x: unknown): x is Piece {
  return !!x && typeof x === "object" && (x as Piece).kind === "piece";
}

const EPS = 1e-9;
const d2r = (d: number) => (d * Math.PI) / 180;
const dist2 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const isPointLike = (x: unknown): x is Point =>
  !!x && typeof x === "object" && typeof (x as Point).x === "number" && typeof (x as Point).y === "number" && !("p1" in (x as object)) && !("points" in (x as object));

/** Центр тяжести многоугольника (площадной), а не среднее вершин: густые дуги не смещают центр. */
function insidePoly(pt: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function centroidOf(v: Point[]): Point {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
  }
  if (Math.abs(a) < EPS) return { x: v.reduce((m, p) => m + p.x, 0) / v.length, y: v.reduce((m, p) => m + p.y, 0) / v.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Знаковая площадь (формула шнурка). При y вниз положительна для обхода по часовой стрелке НА ЭКРАНЕ. */
function signedArea(v: Point[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function assemble(parts: ContourPart[]): Point[] {
  const pts: Point[] = [];
  for (const part of parts) {
    const add = isPointLike(part) ? [part] : linePoints(part as Line, 24);
    for (const p of add) {
      if (pts.length === 0 || dist2(p, pts[pts.length - 1]) > EPS) pts.push({ x: p.x, y: p.y });
    }
  }
  while (pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) <= EPS) pts.pop();
  return pts;
}

function nearestVertex(v: Point[], p: Point): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < v.length; i++) {
    const d = dist2(v[i], p);
    if (d < bd) { bd = d; best = i; }
  }
  if (bd > 2.25) throw new Error(`writePiece: точка (${p.x.toFixed(2)}; ${p.y.toFixed(2)}) для участка припуска не лежит на контуре (расстояние до ближайшей вершины ${Math.sqrt(bd).toFixed(2)} см)`);
  return best;
}

/** Припуск вдоль каждого ребра: [у начала, у конца]. */
function edgeAllowances(v: Point[], base: number, zones: PieceSpec["allowanceZones"], reversed: boolean): [number, number][] {
  const n = v.length;
  const ea: [number, number][] = v.map(() => [base, base]);
  for (const z of zones ?? []) {
    let [s, a1, a2, t] = z;
    const sp: Point = isPointLike(s) ? s : linePoints(s as Line)[0];
    const tp: Point = isPointLike(t) ? t : (() => { const tl = linePoints(t as Line); return tl[tl.length - 1]; })();
    let i0 = nearestVertex(v, sp), i1 = nearestVertex(v, tp);
    if (reversed) { [i0, i1] = [i1, i0]; [a1, a2] = [a2, a1]; } // контур развёрнут — участок идёт в обратную сторону
    if (i0 === i1) continue;
    const idx: number[] = [];
    for (let i = i0; i !== i1; i = (i + 1) % n) idx.push(i);
    const lens = idx.map((i) => dist2(v[i], v[(i + 1) % n]));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    idx.forEach((i, k) => {
      ea[i] = [a1 + ((a2 - a1) * acc) / total, a1 + ((a2 - a1) * (acc + lens[k])) / total];
      acc += lens[k];
    });
  }
  return ea;
}

/** Обводка контура припуском: для каждого ребра — смещённая линия, вершина — пересечение соседних смещённых линий. */
function offsetOutline(v: Point[], ea: [number, number][]): Point[] {
  const n = v.length;
  const dir: Point[] = [], nrm: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n];
    const L = dist2(a, b) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    dir.push({ x: ux, y: uy });
    nrm.push({ x: uy, y: -ux }); // наружу при обходе по часовой стрелке на экране (площадь > 0)
  }
  const off0 = (i: number): Point => ({ x: v[i].x + nrm[i].x * ea[i][0], y: v[i].y + nrm[i].y * ea[i][0] });
  const off1 = (i: number): Point => { const b = v[(i + 1) % n]; return { x: b.x + nrm[i].x * ea[i][1], y: b.y + nrm[i].y * ea[i][1] }; };
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const e0 = (i + n - 1) % n, e1 = i;
    const p1 = off1(e0), q1 = off0(e1);
    const d1 = { x: p1.x - off0(e0).x, y: p1.y - off0(e0).y };
    const d2 = { x: off1(e1).x - q1.x, y: off1(e1).y - q1.y };
    const l1 = Math.hypot(d1.x, d1.y) || 1, l2 = Math.hypot(d2.x, d2.y) || 1;
    const u1 = { x: d1.x / l1, y: d1.y / l1 }, u2 = { x: d2.x / l2, y: d2.y / l2 };
    const cr = u1.x * u2.y - u1.y * u2.x;
    const amax = Math.max(Math.abs(ea[e0][1]), Math.abs(ea[e1][0]));
    if (amax < EPS) { out.push({ x: v[i].x, y: v[i].y }); continue; }
    if (Math.abs(cr) < 1e-9) { out.push({ x: (p1.x + q1.x) / 2, y: (p1.y + q1.y) / 2 }); continue; }
    const t = ((q1.x - p1.x) * u2.y - (q1.y - p1.y) * u2.x) / cr;
    const X = { x: p1.x + t * u1.x, y: p1.y + t * u1.y };
    if (dist2(X, v[i]) > 4 * amax) { out.push(p1, q1); } // слишком острый угол — срезаем (как в Leko)
    else out.push(X);
  }
  return out;
}

function nearestOnContour(v: Point[], p: Point): { pt: Point; edge: number } {
  let best = { pt: v[0], edge: 0 }, bd = Infinity;
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2));
    const q = { x: a.x + t * ex, y: a.y + t * ey };
    const d = dist2(p, q);
    if (d < bd) { bd = d; best = { pt: q, edge: i }; }
  }
  return best;
}

export function writePiece(spec: PieceSpec): Piece {
  if (!spec || !Array.isArray(spec.contour) || spec.contour.length < 2) throw new Error("writePiece: нужен контур — минимум 2 элемента");
  if (spec.contour.some((c) => c === undefined || c === null)) {
    throw new Error(`writePiece «${spec.name}»: в контуре есть несуществующая переменная (линия или точка не построена в этом варианте)`);
  }
  let v = dropSpurs(assemble(spec.contour));
  if (v.length < 3) throw new Error("writePiece: контур должен содержать минимум 3 разные точки");
  let area = signedArea(v);
  let reversed = false;
  if (area < 0) { v = [...v].reverse(); area = -area; reversed = true; } // приводим к обходу по часовой стрелке
  const closed = polyline(...v, v[0]);

  // припуски
  const base = spec.allowance ?? 0;
  let allowance: Polyline | null = null;
  let ea: [number, number][] = v.map(() => [base, base]);
  if (base > 0 || (spec.allowanceZones && spec.allowanceZones.length)) {
    ea = edgeAllowances(v, base, spec.allowanceZones, reversed);
    const o = offsetOutline(v, ea);
    allowance = polyline(...o, o[0]);
  }

  // внутренние линии и точки
  const inner: Polyline[] = [];
  const innerPoints: Point[] = [];
  const texts: TextItem[] = [];
  const innerMarks: { idx: number; center: Point }[] = []; // метки (метка → внтр), чтобы узнать надсечки на контуре
  for (const raw of spec.inner ?? []) {
    const item = raw as unknown;
    if (item === undefined || item === null) continue; // несуществующая в этом варианте переменная — пропускаем, как Leko
    if (isText(item)) { texts.push(item); continue; }
    if (Array.isArray(item)) {
      const parts = item.filter((x) => x !== undefined && x !== null);
      texts.push(...parts.filter(isText));
      const rest = parts.filter((x) => !isText(x)) as (Point | Line)[];
      if (rest.length === 0) continue;
      if (rest.length === 1 && isPointLike(rest[0])) innerPoints.push(rest[0] as Point);
      else {
        const mc = rest.length === 1 ? (rest[0] as { markCenter?: Point; markType?: number }) : {};
        if (mc.markCenter && mc.markType !== 18 && mc.markType !== 19) innerMarks.push({ idx: inner.length, center: mc.markCenter });
        inner.push(polyline(...rest));
      }
    } else if (isPointLike(item)) innerPoints.push(item as Point);
    else {
      const mc = (item as { markCenter?: Point; markType?: number });
      if (mc.markCenter && mc.markType !== 18 && mc.markType !== 19) innerMarks.push({ idx: inner.length, center: mc.markCenter });
      inner.push(polyline(...linePoints(item as Line, 24)));
    }
  }
  // метки
  const innerLineCount = inner.length; // до меток: дальше в inner только рисунки меток
  const markCenters: Point[] = [];
  const contourMarks: number[] = [];
  for (const m of innerMarks) if (dist2(nearestOnContour(v, m.center).pt, m.center) < 0.2) { contourMarks.push(m.idx); if (allowance) markCenters.push(m.center); }
  for (const [type, angle, len, width, place] of spec.marks ?? []) {
    let center: Point;
    if (isPointLike(place)) center = place;
    else if (Array.isArray(place[1])) center = layOff(place[0], place[1] as [number, number][]);
    else center = layOff(place[0], place[1] as number, place[2] as number);
    if (allowance && type !== 18 && type !== 19) markCenters.push(center); // метка на контуре → высечка напротив на припуске
    if (type !== 18 && type !== 19 && dist2(nearestOnContour(v, center).pt, center) < 0.2) contourMarks.push(inner.length);
    let mk = label(center, type, angle, len, width);
    if (type === 18 || type === 19) {
      // долевая стрелка не должна выходить за контур лекала: укорачиваем, пока вся не поместится
      for (let k = 0.9; k > 0.15 && !mk.points.every((q) => insidePoly(q, v)); k -= 0.1) mk = label(center, type, angle, len * k, width);
    }
    inner.push(mk);
  }
  // надсечки. Без припуска — короткая засечка наружу от контура (как раньше).
  // С припуском — высечка-галочка на линии раскроя напротив точки: глубина — половина припуска, но не больше 0,5 см
  // (широкий припуск, например подгиб, — тоже 0,5), раствор узкий. Ставятся напротив заданных надсечек, меток на контуре
  // и концов внутренних линий, которые выходят на контур (линия кармана, талии, сгиба…). На углах контура не ставятся.
  const notches: Polyline[] = [];
  const cands: Point[] = [...(spec.notches ?? [])];
  if (allowance) {
    const ON = 0.2; // кривые (пройма, горловина) в контуре — ломаной, точка на кривой может отстоять от неё на 1–2 мм
    const onContour = (p: Point) => dist2(nearestOnContour(v, p).pt, p) < ON;
    for (const m of markCenters) if (onContour(m)) cands.push(m);
    for (const l of inner.slice(0, innerLineCount)) {
      const pts = l.points;
      if (pts.length < 2) continue;
      for (const e of [pts[0], pts[pts.length - 1]]) if (onContour(e)) cands.push(e);
    }
  }
  const turn = (i: number) => {
    const p0 = v[(i + v.length - 1) % v.length], p1 = v[i], p2 = v[(i + 1) % v.length];
    const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x), a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let d = Math.abs(a2 - a1) * 180 / Math.PI; if (d > 180) d = 360 - d;
    return d;
  };
  const placed: Point[] = [];
  for (const np of cands) {
    const { pt, edge } = nearestOnContour(v, np);
    const a = v[edge], b = v[(edge + 1) % v.length];
    const L = dist2(a, b) || 1;
    const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
    const nx = ty, ny = -tx; // наружу
    if (!allowance) {
      notches.push(polyline(pt, { x: pt.x + nx * 0.4, y: pt.y + ny * 0.4 }));
      continue;
    }
    if (placed.some((q) => dist2(q, pt) < 0.3)) continue; // уже есть рядом
    // на углу контура (плечо, низ бокового шва…) не ставим
    const vi = v.findIndex((q) => dist2(q, pt) < 0.1);
    if (vi >= 0 && turn(vi) > 25) continue;
    const t = Math.max(0, Math.min(1, dist2(a, pt) / L));
    const aLocal = ea[edge][0] + (ea[edge][1] - ea[edge][0]) * t;
    if (aLocal < 0.05) continue; // здесь припуска нет (сгиб) — высечка не нужна
    // точка на линии раскроя напротив: ближайшая к отложенной по нормали
    const guess = { x: pt.x + nx * aLocal, y: pt.y + ny * aLocal };
    const cut = nearestOnContour(allowance.points.slice(0, -1), guess);
    const ca = allowance.points[cut.edge], cb = allowance.points[(cut.edge + 1) % (allowance.points.length - 1)];
    const cl = dist2(ca, cb) || 1;
    const ux = (cb.x - ca.x) / cl, uy = (cb.y - ca.y) / cl; // вдоль линии раскроя
    const inx = -uy, iny = ux; // внутрь детали (обход по часовой)
    const depth = Math.min(aLocal / 2, 0.5);
    const half = Math.min(0.15, depth * 0.4); // узкий раствор
    const c = cut.pt;
    notches.push(polyline({ x: c.x - ux * half, y: c.y - uy * half }, { x: c.x + inx * depth, y: c.y + iny * depth }, { x: c.x + ux * half, y: c.y + uy * half }));
    placed.push(pt);
  }
  // долевая
  let grain: Segment | null = null;
  {
    // не задана — вертикально вниз; в стороне от середины, чтобы не лечь на линию сгиба и на подпись детали
    const mid = centroidOf(v), xs = v.map((q) => q.x), aside = { x: mid.x + (Math.max(...xs) - Math.min(...xs)) * 0.25, y: mid.y };
    const [gp, ga] = spec.grain ?? [insidePoly(aside, v) ? aside : mid, 90];
    const r = d2r(ga), cos = Math.cos(r), sin = Math.sin(r);
    const ends = (h: number, t: number): Point[] => [{ x: gp.x + (t - h) * cos, y: gp.y + (t - h) * sin }, { x: gp.x + (t + h) * cos, y: gp.y + (t + h) * sin }];
    // отрезок 15 см через точку; точка часто лежит у края детали — тогда он сдвигается вдоль своего направления внутрь и укорачивается, только если иначе не помещается
    let best = ends(1, 0);
    search: for (let half = 7.5; half >= 0.25; half -= half > 1 ? 0.5 : 0.25) {
      for (let s = 0; s <= 7.5; s += 0.5) for (const t of s ? [s, -s] : [0]) {
        const e = ends(half, t);
        if (e.every((q) => insidePoly(q, v))) { best = e; break search; }
      }
    }
    grain = segment(best[0], best[1]);
  }

  return {
    kind: "piece",
    name: spec.name,
    count: spec.count,
    code: spec.code,
    fabric: spec.fabric,
    color: spec.color ?? 1,
    outline: closed,
    allowance,
    inner,
    innerPoints,
    texts,
    notches,
    contourMarks,
    grain,
    area,
    center: centroidOf(v),
  };
}

/** Охват детали (контур и припуск), см. */
export function pieceBounds(pieces: Piece[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pc of pieces) for (const p of [...pc.outline.points, ...(pc.allowance?.points ?? [])]) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Копия детали, сдвинутая на (dx, dy) см. Нужна, чтобы деталь элемента (рукав) легла рядом с деталями основы. */
export function shiftPiece(pc: Piece, dx: number, dy: number, rename?: string): Piece {
  const mp = (p: { x: number; y: number }) => ({ ...p, x: p.x + dx, y: p.y + dy });
  const ml = <T extends { points: { x: number; y: number }[] }>(l: T): T => ({ ...l, points: l.points.map(mp) });
  return {
    ...pc,
    name: rename ?? pc.name,
    outline: ml(pc.outline),
    allowance: pc.allowance ? ml(pc.allowance) : null,
    inner: pc.inner.map(ml),
    innerPoints: pc.innerPoints.map(mp),
    texts: pc.texts.map((t) => ({ ...t, point: mp(t.point) })),
    notches: pc.notches.map(ml),
    grain: pc.grain ? segment(mp(pc.grain.p1), mp(pc.grain.p2)) : null,
    center: mp(pc.center),
  };
}
