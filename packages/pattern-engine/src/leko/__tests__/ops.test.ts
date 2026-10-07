import { point, segment, polyline, arc, layOff, intersectDirections, intersectCircles,
  filletArc, sizeFn, mirror, rotate, translate, split, splineK, splineKK,
  exists, fit, label, outline } from "../ops.js";
import { isSegment, isArc, linePoints } from "../types.js";

let failed = false;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("FAIL:", msg); failed = true; } else console.log("ok:", msg);
}
function approx(a: number, b: number, eps = 0.01): boolean { return Math.abs(a - b) < eps; }
function approxPt(a: { x: number; y: number }, b: { x: number; y: number }, eps = 0.01): boolean {
  return approx(a.x, b.x, eps) && approx(a.y, b.y, eps);
}

// --- Раздел 1.6 справочника: пример опорных точек спинки ---
{
  const Сш = 37, Пшр = 1;
  const a0 = point(0, 0);
  const a2 = point(a0.x + 0.33 * Сш + Пшр, a0.y);
  const a = point(a0.x, a0.y + 0.35 * (0.33 * Сш + Пшр));
  assert(approx(a2.x, 13.21), "раздел 1.6: a2.x = 0.33*Сш+Пшр");
  assert(approx(a.y, 4.62), "раздел 1.6: a.y = 0.35*(0.33*Сш+Пшр)");
}

// --- Раздел 8.8: intersectDirections( (1,1),0, (2,2),90 ) = (2,1) ---
{
  const p1 = point(1, 1), p2 = point(2, 2);
  const p3 = intersectDirections(p1, 0, p2, 90);
  assert(approxPt(p3, { x: 2, y: 1 }), `intersectDirections базовый пример даёт (2,1), получили (${p3.x.toFixed(2)},${p3.y.toFixed(2)})`);
}

// --- Раздел 14.2: sizeFn, таблица экстраполяции (80,0.01)-(100,0.05) ---
{
  const f = (p: number) => sizeFn(p, [[80, 0.01], [100, 0.05]]);
  assert(approx(f(60), -0.03), `sizeFn(60) = -0.03, получили ${f(60).toFixed(3)}`);
  assert(approx(f(70), -0.01), `sizeFn(70) = -0.01, получили ${f(70).toFixed(3)}`);
  assert(approx(f(90), 0.03), `sizeFn(90) = 0.03, получили ${f(90).toFixed(3)}`);
  assert(approx(f(110), 0.07), `sizeFn(110) = 0.07, получили ${f(110).toFixed(3)}`);
  assert(approx(f(130), 0.11), `sizeFn(130) = 0.11, получили ${f(130).toFixed(3)}`);
}
{
  const f = (p: number) => sizeFn(p, [[10, 0.01], [80, 0.01], [100, 0.05], [160, 0.05]]);
  assert(approx(f(60), 0.01), `sizeFn(60) с ограничением = 0.01, получили ${f(60).toFixed(3)}`);
  assert(approx(f(110), 0.05), `sizeFn(110) с ограничением = 0.05, получили ${f(110).toFixed(3)}`);
  assert(approx(f(130), 0.05), `sizeFn(130) с ограничением = 0.05, получили ${f(130).toFixed(3)}`);
}

// --- segment: длина и угол ---
{
  const s = segment(point(0, 0), point(10, 0));
  assert(approx(s.length, 10), "segment: длина (10,0)");
  assert(approx(s.angle1, 0), "segment: угол горизонтального = 0°");
}
{
  const s = segment(point(0, 0), point(0, 10));
  assert(approx(s.angle1, 90), "segment: угол вертикального вниз = 90° (Y вниз, по часовой)");
}

// --- layOff: под 0° и 90° ---
{
  const p0 = layOff(point(5, 5), 0, 10);
  assert(approxPt(p0, { x: 15, y: 5 }), "layOff угол=0: вправо");
  const p90 = layOff(point(5, 5), 90, 10);
  assert(approxPt(p90, { x: 5, y: 15 }), "layOff угол=90: вниз");
}

// --- intersectCircles: окружности радиусом 7 с центрами (0,0) и (10,0) пересекаются в (5, ±y) ---
{
  const p = intersectCircles(point(0, 0), 7, point(10, 0), 7, 1);
  assert(approx(p.x, 5), `intersectCircles: x=5, получили ${p.x.toFixed(2)}`);
  const p2 = intersectCircles(point(0, 0), 7, point(10, 0), 7, -1);
  assert(approx(p2.y, -p.y), "intersectCircles: sign=-1 даёт зеркальную точку по Y");
}

// --- filletArc: две перпендикулярные линии, радиус 5 ---
{
  const p1 = point(0, 0), p2 = point(20, 0);
  const d = filletArc(p1, 0, p2, 90, 5);
  assert(approx(d.radius, 5), "filletArc: радиус сохранён");
  const distToLine1 = Math.abs(d.center.y - p1.y);
  assert(approx(distToLine1, 5, 0.1), `filletArc: центр на расстоянии R от линии1, получили ${distToLine1.toFixed(2)}`);
}

// --- mirror / rotate / translate ---
{
  const axis = segment(point(0, 0), point(0, 10));
  const [p] = mirror([point(5, 3)], axis);
  assert(approxPt(p, { x: -5, y: 3 }), "mirror относительно вертикальной оси X=0");
}
{
  const [p] = rotate([point(10, 0)], point(0, 0), 90);
  assert(approxPt(p, { x: 0, y: 10 }, 0.1), `rotate на 90° вокруг начала координат: (10,0)->(0,10), получили (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
}
{
  const [p] = translate([point(1, 1)], point(5, 5));
  assert(approxPt(p, { x: 6, y: 6 }), "translate на вектор точки (5,5)");
}

// --- split: делим отрезок длины 10 пополам ---
{
  const s = segment(point(0, 0), point(10, 0));
  const { point: mid } = split(s, 5);
  assert(approxPt(mid, { x: 5, y: 0 }), "split отрезок 10 см пополам -> точка (5,0)");
}

// --- splineK: при k=0 вырождается в прямую линию между p1 и p2 ---
{
  const s = splineK(point(0, 0), point(10, 0), 0, 180, 0, 8);
  const allOnLine = s.points.every((p) => approx(p.y, 0, 0.001));
  assert(allOnLine, "splineK k=0: все точки лежат на прямой (y=0)");
  assert(approxPt(s.points[0], { x: 0, y: 0 }) && approxPt(s.points[s.points.length - 1], { x: 10, y: 0 }), "splineK k=0: концы совпадают с заданными точками");
}

// --- splineK: касательная в начале кривой точно совпадает с заданным углом (производная кубической Безье) ---
{
  const s = splineK(point(0, 0), point(10, 10), 0, 90, 1, 200);
  const p0 = s.points[0], p1 = s.points[1];
  const actualAngle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  assert(approx(actualAngle, 0, 1), `splineK: касательная в начале ≈ заданный угол 0°, получили ${actualAngle.toFixed(2)}°`);
}

// --- splineK: рост k увеличивает длину кривой (более выпуклая) ---
{
  const short = splineK(point(0, 0), point(10, 0), 45, 135, 0.3, 30);
  const long = splineK(point(0, 0), point(10, 0), 45, 135, 1.2, 30);
  assert(long.length > short.length, `splineK: длина растёт с k (0.3→${short.length.toFixed(2)}, 1.2→${long.length.toFixed(2)})`);
}

// --- splineKK: при k2=1 совпадает со splineK ---
{
  const a = splineK(point(0, 0), point(10, 5), 10, 170, 0.8, 10);
  const b = splineKK(point(0, 0), point(10, 5), 10, 170, 0.8, 1, 10);
  const same = a.points.every((p, i) => approxPt(p, b.points[i]));
  assert(same, "splineKK с k2=1 совпадает со splineK");
}

// --- exists ---
{
  let par_19: number | undefined;
  assert(exists(par_19) === false, "exists: необъявленное значение (undefined) -> false");
  par_19 = 5;
  assert(exists(par_19) === true, "exists: заданное значение -> true");
}

// --- fit: растягиваем отрезок (0,0)-(1,0) на новые точки (10,10)-(20,10) (сдвиг+масштаб x10) ---
{
  const shape = segment(point(0, 0), point(1, 0));
  const r = fit(shape, point(0, 0), point(1, 0), point(10, 10), point(20, 10));
  assert(approxPt(r.points[0], { x: 10, y: 10 }), "fit: первая точка легла на targetP1");
  assert(approxPt(r.points[1], { x: 20, y: 10 }), "fit: вторая точка легла на targetP2");
}
// --- fit: с поворотом на 90° ---
{
  const shape = segment(point(0, 0), point(10, 0));
  const r = fit(shape, point(0, 0), point(10, 0), point(0, 0), point(0, 10));
  assert(approxPt(r.points[1], { x: 0, y: 10 }, 0.05), `fit с поворотом 90°: получили (${r.points[1].x.toFixed(2)},${r.points[1].y.toFixed(2)})`);
}

// --- label: прямоугольник 4x2 без поворота вокруг (5,5) ---
{
  const m = label(point(5, 5), 2, 0, 4, 2);
  assert(approxPt(m.points[0], { x: 3, y: 4 }), `label прямоугольник: первый угол (3,4), получили (${m.points[0].x.toFixed(2)},${m.points[0].y.toFixed(2)})`);
}

// --- outline: замыкает контур на первую точку ---
{
  const c = outline("test", point(0, 0), point(10, 0), point(10, 10));
  const first = c.points[0], last = c.points[c.points.length - 1];
  assert(approxPt(first, last), "outline: контур замкнут (последняя точка = первая)");
  assert(c.name === "test", "outline: имя сохранено");
}

// --- регрессия: дуга НЕ должна считаться отрезком (у неё тоже есть p1/p2) — иначе рисовалась прямой ---
{
  const a = arc(point(0, 0), 5, 0, 90);
  assert(isArc(a) && !isSegment(a), "дуга распознаётся как дуга, а не как отрезок");
  assert(linePoints(a).length > 2, "linePoints(дуга) даёт ломаную из многих точек, а не 2 конца");
  const mid = split(a, a.length / 2).point;
  assert(approx(Math.hypot(mid.x, mid.y), 5, 0.02), "split дуги пополам даёт точку на окружности");
}

// --- углы как в Leko: диапазон [0°, 360°), у отрезка .ф2 = .ф1 (направление в конце) ---
{
  const sg = segment(point(0, 0), point(-10, -10));
  assert(approx(sg.angle1, 225, 1e-9), `ф1 отрезка в диапазоне 0..360 (225), получили ${sg.angle1}`);
  assert(approx(sg.angle2, sg.angle1, 1e-9), "ф2 отрезка = ф1");
  const pl = polyline(point(0, 0), point(0, -5), point(-5, -5));
  assert(approx(pl.angle1, 270, 1e-9) && approx(pl.angle2, 180, 1e-9), "ф1/ф2 ломаной в диапазоне 0..360");
}

if (failed) { throw new Error("Есть провалившиеся проверки (см. вывод выше)."); }
console.log("\nВсе проверки операторов пройдены (включая числовые примеры из официального справочника Leko).");
