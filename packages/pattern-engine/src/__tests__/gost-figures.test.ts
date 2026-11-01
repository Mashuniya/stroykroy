import { BOY_FIGURES, BOY_FIGURE_GROUPS, getBoyFigure, findBoyFigure, kidMeasurementName, GIRL_FIGURES, GIRL_FIGURE_GROUPS, getGirlFigure, findGirlFigure } from "../gost-figures.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };

ok(BOY_FIGURES.length === 459, `459 фигур мальчиков в таблице 5 (получили ${BOY_FIGURES.length})`);
ok(BOY_FIGURES.every((f) => Object.keys(f.measurements).length === 88), "у каждой фигуры 85 признаков + рост, грудь, талия");
ok(new Set(BOY_FIGURES.map((f) => f.id)).size === 459, "обозначения фигур не повторяются");
ok(BOY_FIGURES.every((f) => (f.height - 86) % 6 === 0 && f.chest % 4 === 0 && f.waist % 3 === 0), "рост — шаг 6 от 86, грудь — шаг 4, талия — шаг 3");
ok(BOY_FIGURE_GROUPS[0].height === 86 && BOY_FIGURE_GROUPS[BOY_FIGURE_GROUPS.length - 1].height === 206, "группы по росту от 86 до 206");
const f = getBoyFigure("134-64-57");
ok(!!f && f.measurements.rz1 === 134 && f.measurements.rz16 === 64 && f.measurements.rz18 === 57, "фигура 134-64-57: рост, грудь, талия в мерках");
ok(!!f && findBoyFigure(f.measurements)?.id === "134-64-57", "findBoyFigure находит выставленную фигуру");
ok(kidMeasurementName("rz13") === "Обхват шеи" && kidMeasurementName("rz1") !== undefined, "названия признаков из таблицы 4");
// рост растёт — длины растут: высота линии талии (rz7) при росте 152 больше, чем при 140 для одного обхвата груди
const a = BOY_FIGURES.find((x) => x.height === 140 && x.chest === 72 && x.waist === 63)!;
const b = BOY_FIGURES.find((x) => x.height === 152 && x.chest === 72 && x.waist === 63);
ok(!b || b.measurements.rz7 > a.measurements.rz7, "высота линии талии растёт с ростом");
const unc = BOY_FIGURES.reduce((s, x) => s + x.uncertainKeys.length, 0);
ok(unc > 0 && unc < 39015 * 0.08, `сомнительных ячеек распознавания ${unc} из 39015 (меньше 8%)`);
// девочки, ГОСТ 17916-86
ok(GIRL_FIGURES.length === 440, `440 фигур девочек в таблице 5 (получили ${GIRL_FIGURES.length})`);
ok(new Set(GIRL_FIGURES.map((f) => f.id)).size === 440, "обозначения фигур девочек не повторяются");
ok(GIRL_FIGURES.every((f) => (f.height - 86) % 6 === 0 && f.chest % 4 === 0 && f.waist % 3 === 0), "девочки: рост — шаг 6 от 86, грудь — шаг 4, талия — шаг 3");
ok(GIRL_FIGURE_GROUPS[0].height === 86 && GIRL_FIGURE_GROUPS[GIRL_FIGURE_GROUPS.length - 1].height === 176, "девочки: группы по росту от 86 до 176");
const g = getGirlFigure("86-48-45");
ok(!!g && g.measurements.rz51 === 18.7 && g.measurements.rz102 === 43.2 && g.measurements.rz25 === 48.8, "86-48-45: ячейки из PDF (18,7; 43,2; 48,8)");
ok(!!g && findGirlFigure(g.measurements)?.id === "86-48-45", "findGirlFigure находит выставленную фигуру");
ok(GIRL_FIGURES.every((f) => Object.values(f.measurements).every((v) => Number.isFinite(v) && v > 0)), "у девочек нет пустых и нулевых значений");
if (failed) throw new Error("Есть провалившиеся проверки.");
console.log("\nВсе проверки фигур мальчиков ГОСТ пройдены.");
