import { point, label, reverseLine, segment } from "../ops.js";
import { writePiece, isPiece } from "../piece.js";
import { runLekoScript } from "../script-runner.js";
import { renderScriptSvg } from "../render-script-svg.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES } from "../../types.js";

let failed = false;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("FAIL:", msg); failed = true; } else console.log("ok:", msg);
}
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const bbox = (pts: { x: number; y: number }[]) => ({
  x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)),
});

const A = point(0, 0), B = point(10, 0), C = point(10, 10), D = point(0, 10);

// --- квадрат 10×10, обход по часовой стрелке на экране, припуск 1 ---
{
  const pc = writePiece({ name: "SQ", contour: [A, B, C, D], allowance: 1 });
  assert(isPiece(pc), "writePiece возвращает деталь");
  assert(near(pc.area, 100), `площадь квадрата 10×10 = 100, получили ${pc.area}`);
  const bb = bbox(pc.allowance!.points);
  assert(near(bb.x0, -1) && near(bb.x1, 11) && near(bb.y0, -1) && near(bb.y1, 11), "припуск 1 см даёт контур от -1 до 11 по обеим осям");
  assert(pc.allowance!.points.length === 5, "контур припуска замкнут (4 угла + повтор первой)");
}
// --- тот же квадрат, но контур задан ПРОТИВ часовой стрелки — результат тот же ---
{
  const pc = writePiece({ name: "SQ", contour: [A, D, C, B], allowance: 1 });
  const bb = bbox(pc.allowance!.points);
  assert(near(bb.x0, -1) && near(bb.x1, 11) && near(bb.y0, -1) && near(bb.y1, 11), "направление обхода контура не важно — припуск всё равно наружу");
}
// --- контур из линий, одна из которых задана в обратную сторону (reverseLine) ---
{
  const top = segment(A, B), right = segment(B, C), bottom = segment(D, C), left = segment(D, A);
  const pc = writePiece({ name: "SQ2", contour: [top, right, reverseLine(bottom), left], allowance: 0.5 });
  assert(near(pc.area, 100, 1e-6), "контур из отрезков (одна линия развёрнута) собирается в квадрат");
}
// --- участки припуска: низ квадрата (C→D) без припуска, остальное 1 ---
{
  const pc = writePiece({ name: "Z", contour: [A, B, C, D], allowance: 1, allowanceZones: [[C, 0, 0, D]] });
  const bb = bbox(pc.allowance!.points);
  assert(near(bb.y1, 10), `на участке C→D припуск 0: нижняя граница y=10, получили ${bb.y1}`);
  assert(near(bb.x0, -1) && near(bb.y0, -1) && near(bb.x1, 11), "на остальных сторонах припуск 1 см");
}
// --- линейно меняющийся припуск по одной стороне: от 0 у A до 2 у B ---
{
  const pc = writePiece({ name: "T", contour: [A, B, C, D], allowance: 0, allowanceZones: [[A, 0, 2, B]] });
  const pts = pc.allowance!.points;
  const topY = pts.map((p) => p.y).reduce((m, y) => Math.min(m, y), Infinity);
  assert(near(topY, -2, 1e-6), `у конца участка припуск 2 см (верх y=-2), получили ${topY}`);
}
// --- надсечка: засечка наружу на верхней стороне ---
{
  const pc = writePiece({ name: "N", contour: [A, B, C, D], allowance: 1, notches: [point(5, 0)] });
  const n = pc.notches[0].points;
  assert(near(n[0].x, 5) && near(n[0].y, 0) && near(n[1].x, 5) && n[1].y < 0, "надсечка начинается на контуре и идёт наружу");
}
// --- внутренние линии, точки, метки ---
{
  const pc = writePiece({
    name: "I", contour: [A, B, C, D],
    inner: [[point(2, 2), point(8, 2)], point(5, 5), segment(point(2, 8), point(8, 8))],
    marks: [[2, 0, 2, 1, point(5, 3)], [3, 0, 2, 1, [point(5, 5), 90, 2]]],
    grain: [point(5, 5), 90],
  });
  assert(pc.inner.length === 4, `внутренних линий 4 (2 линии + 2 метки), получили ${pc.inner.length}`);
  assert(pc.innerPoints.length === 1, "одна внутренняя точка");
  assert(pc.grain !== null && near(pc.grain!.length, 15, 1e-6), "долевая — отрезок 15 см");
}
// --- метки: все 8 типов строятся, 9-й — понятная ошибка ---
{
  let ok = true;
  for (let t = 1; t <= 8; t++) { const m = label(point(0, 0), t, 0, 4, 2); if (m.points.length < 2) ok = false; }
  assert(ok, "метки типов 1-8 строятся");
  let thrown = false; try { label(point(0, 0), 9, 0, 1, 1); } catch { thrown = true; }
  assert(thrown, "метка типа 9 — ошибка с понятным текстом");
}
// --- ошибки ввода ---
{
  let thrown = false; try { writePiece({ name: "X", contour: [A] }); } catch { thrown = true; }
  assert(thrown, "контур из одной точки — ошибка");
  thrown = false; try { writePiece({ name: "X", contour: [A, B, C, D], allowance: 1, allowanceZones: [[point(99, 99), 0, 0, D]] }); } catch { thrown = true; }
  assert(thrown, "участок припуска с точкой не на контуре — ошибка");
}
// --- скрипт: деталь регистрируется и без присваивания (как ЗАПИСАТЬ в Leko), и с ним ---
{
  const code = `
    const a = point(0, 0); const b = point(10, 0); const c = point(10, 10); const d = point(0, 10);
    writePiece({ name: "ONE", contour: [a, b, c, d], allowance: 1 });
    const two = writePiece({ name: "TWO", contour: [a, b, c], allowance: 0.5 });
  `;
  const res = runLekoScript(code, DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES);
  assert(res.ошибка === null, "скрипт с writePiece выполняется без ошибок");
  assert(res.pieces.length === 2, `собрано 2 детали (одна без присваивания), получили ${res.pieces.length}`);
  const svg = renderScriptSvg(res.переменные, { pieces: res.pieces });
  assert((svg.match(/sv-piece/g) ?? []).length === 2, "обе детали нарисованы (без дублей)");
  assert(svg.includes('data-var="two"'), "деталь, присвоенная переменной, привязана к её имени (для клика → код)");
}

if (failed) { throw new Error("Есть провалившиеся проверки (см. вывод выше)."); }
console.log("\nВсе проверки writePiece пройдены.");
