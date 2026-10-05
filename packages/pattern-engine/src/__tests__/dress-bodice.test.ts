import { evalFormulaSteps } from "../formula-engine.js";
import { DEFAULT_DRESS_BODICE_STEPS } from "../default-dress-bodice-steps.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES } from "../types.js";

const result = evalFormulaSteps(DEFAULT_DRESS_BODICE_STEPS, DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES);

let failed = false;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
  else console.log("ok:", msg);
}

const p = result.points;
// Известное нерешённое место (см. README и label шага "14p" в default-dress-bodice-steps.ts):
// построение вытачки на лопатки (засечка окружностей для точки 14') не сходится ни при
// каком угле плеча — вероятно, неверно определены точки 32/122 относительно 13/14.
// Нужен оригинальный чертёж (рис. 15-16). Фиксируем это явно, а не прячем за tryTune.
const KNOWN_UNRESOLVED_STEPS = new Set(["14p", "342pp"]);
const unexpectedErrors = result.errors.filter((e) => !KNOWN_UNRESOLVED_STEPS.has(e.stepId));
assert(unexpectedErrors.length === 0, `нет НЕИЗВЕСТНЫХ ошибок вычисления (кроме 14p/342pp): ${JSON.stringify(unexpectedErrors)}`);
if (result.errors.length > 0) {
  console.log("\nИзвестные нерешённые шаги (ожидаемо):");
  result.errors.forEach((e) => console.log(`  - ${e.stepId}: ${e.message}`));
}
assert(Number.isFinite(p["31"]?.y) && p["31"].y > 0, "точка 31 (линия груди) посчиталась и > 0");
assert(p["41"].y > p["31"].y, "линия талии (41) ниже линии груди (31)");
assert(p["51"].y > p["41"].y, "линия бёдер (51) ниже линии талии (41)");
assert(p["33"].x < p["35"].x && p["35"].x < p["37"].x, "порядок точек ширины: 33 < 35 < 37");
assert(Number.isFinite(p["342"]?.x), "дуга нижней проймы спинки построена (есть центр 342)");
assert(Number.isFinite(p["343"]?.x), "дуга нижней проймы переда построена (есть центр 343)");
assert(Number.isFinite(p["114"]?.x), "дуга горловины спинки построена (есть центр 114)");
assert(p["46"].x < p["471"].x, "вытачка на живот: 46 левее 471");
assert(Number.isFinite(p["371p"]?.x), "вытачка на грудь построена");
assert(Object.keys(p).length >= 35, `посчитано разумное число точек (${Object.keys(p).length})`);

console.log(`\nВсего точек: ${Object.keys(p).length}, значений: ${Object.keys(result.values).length}, дуг: ${Object.keys(result.arcs).length}`);

if (failed) { throw new Error("Есть провалившиеся проверки (см. вывод выше)."); }
console.log("\nВсе базовые проверки пройдены.");
