import { point, label, reverseLine, segment } from "../ops.js";
import { writePiece, isPiece, pieceKeys } from "../piece.js";
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

// --- центр детали, ключи, положение на листе ---
{
  const pc = writePiece({ name: "SQ", contour: [A, B, C, D] });
  assert(near(pc.center.x, 5) && near(pc.center.y, 5), `центр квадрата 10×10 = (5; 5), получили (${pc.center.x}; ${pc.center.y})`);
  const tri = writePiece({ name: "TRI", contour: [point(0, 0), point(9, 0), point(0, 9)] });
  assert(near(tri.center.x, 3) && near(tri.center.y, 3), "центр тяжести треугольника — в трети высоты, а не среднее вершин плотных дуг");
  const k = pieceKeys([pc, pc, tri, pc]);
  assert(k.join(",") === "SQ,SQ#1,TRI,SQ#2", `ключи одноимённых деталей различаются: ${k.join(",")}`);

  const vars = { a: A, b: B, c: C, d: D };
  const plain = renderScriptSvg(vars, { pieces: [pc], scale: 10 });
  assert(plain.includes('class="sv-handle"') && plain.includes('data-piece-index="0"'), "у детали есть крупная точка-ручка с номером детали");
  assert(!plain.includes("transform="), "без смещения transform не добавляется");
  const moved = renderScriptSvg(vars, { pieces: [pc], scale: 10, pieceTransforms: { SQ: { dx: 3, dy: -2, angle: 15 } } });
  assert(moved.includes("translate(30.00 -20.00) rotate(15.000"), "смещение 3,-2 см при масштабе 10 → translate(30 -20), поворот 15° вокруг центра");
  const withMargin = renderScriptSvg(vars, { pieces: [pc], scale: 10, margin: 300 });
  const w0 = Number(/width="(\d+)"/.exec(plain)![1]), w1 = Number(/width="(\d+)"/.exec(withMargin)![1]);
  assert(w1 === w0 + 600, `поле 300 px с каждой стороны: ширина ${w0} → ${w1}`);
  // при большом увеличении холст растёт вместе с содержимым (раньше обрезалось по 1000×800)
  const big = renderScriptSvg(vars, { pieces: [pc], scale: 200 });
  assert(Number(/width="(\d+)"/.exec(big)![1]) >= 2000, "при масштабе 200 px/см холст не меньше содержимого (нет обрезки)");
}

// --- припуски можно скрыть при рисовании (чертёж не «прыгает») ---
{
  const pc = writePiece({ name: "AL", contour: [A, B, C, D], allowance: 1 });
  const vars = { a: A, b: B, c: C, d: D };
  const on = renderScriptSvg(vars, { pieces: [pc], scale: 10 });
  const off = renderScriptSvg(vars, { pieces: [pc], scale: 10, showAllowance: false });
  assert(on.includes("stroke-dasharray=\"5 3\""), "припуски по умолчанию показаны (пунктир)");
  assert(!off.includes("stroke-dasharray=\"5 3\""), "showAllowance:false — пунктира припуска нет");
  assert(/width="(\d+)"/.exec(on)![1] === /width="(\d+)"/.exec(off)![1], "размер холста при выключении припусков не меняется");
  assert(off.includes('class="sv-mark"') && off.includes("data-piece-index"), "контур и ручка детали остаются");
}

// --- userInputs: пометка «что показывать пользователю» ---
{
  const run = (code: string) => runLekoScript(code, DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES);
  assert(run("const a = point(0, 0);").userInputs === null, "без userInputs — null (показывается всё)");
  const r = run('userInputs(["rz13", "PK_31_33"]);\nconst a = point(0, 0);');
  assert(r.ошибка === null && JSON.stringify(r.userInputs) === '["rz13","PK_31_33"]', "userInputs со списком ключей читается как список");
  const two = run('userInputs(["rz13"]);\nuserInputs(["rz40", "rz13"]);');
  assert(JSON.stringify(two.userInputs) === '["rz13","rz40"]', "несколько вызовов объединяются без повторов");
  const bad = run('userInputs(["rz99"]);');
  assert(bad.ошибка !== null && bad.ошибка.message.includes("«rz99»"), "неизвестный параметр — понятная ошибка с его именем");
  const notList = run("userInputs(5);");
  assert(notList.ошибка !== null && notList.ошибка.message.includes("список"), "не список — ошибка с примером");
}

if (failed) { throw new Error("Есть провалившиеся проверки (см. вывод выше)."); }
console.log("\nВсе проверки writePiece пройдены.");
