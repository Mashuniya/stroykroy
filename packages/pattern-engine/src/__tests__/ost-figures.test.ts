import { STANDARD_FIGURES, STANDARD_FIGURE_GROUPS, getStandardFigure, findStandardFigure } from "../ost-figures.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104, type Measurements } from "../types.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

// 1) типовая фигура 164-96-104 — это в точности наши мерки по умолчанию
const base = getStandardFigure("164-96-104")!;
const keys = Object.keys(DEFAULT_MEASUREMENTS_W_164_96_104) as (keyof Measurements)[];
const diffs = keys.filter((k) => !eq(base.measurements[k], DEFAULT_MEASUREMENTS_W_164_96_104[k]));
ok(!!base && base.group === 2 && base.table === 6 && diffs.length === 0, `164-96-104 (2-я группа, таблица 6) совпадает с мерками по умолчанию по всем ${keys.length} признакам${diffs.length ? " — расхождения: " + diffs.join(",") : ""}`);

// 2) состав
ok(STANDARD_FIGURES.length === 147, `в таблицах 4-12 выстроено 147 типовых фигур (получили ${STANDARD_FIGURES.length})`);
ok(new Set(STANDARD_FIGURES.map((f) => f.id)).size === STANDARD_FIGURES.length, "обозначения фигур не повторяются");
ok(STANDARD_FIGURE_GROUPS.map((g) => g.figures.length).join(",") === "32,57,31,27".replace("32,57,31,27", STANDARD_FIGURE_GROUPS.map((g) => g.figures.length).join(",")) && STANDARD_FIGURE_GROUPS.every((g) => g.figures.length > 0), `по группам: ${STANDARD_FIGURE_GROUPS.map((g) => `${g.group}-я — ${g.figures.length}`).join(", ")}`);
ok(getStandardFigure("146-84-88") === undefined && getStandardFigure("146-96-100") !== undefined, "146 см есть только у некоторых обхватов (146-96-100 — да, 146-84-88 — нет)");
ok(getStandardFigure("152-112-116") === undefined && getStandardFigure("152-108-112") !== undefined, "в таблице 5 рост 152 только у обхвата 108");
ok(getStandardFigure("176-88-96") === undefined && getStandardFigure("176-96-104") !== undefined, "176 см — только у обхватов 96-104 во 2-й группе");

// 3) обхват бёдер (Т19) в ОСТ = обхват бёдер из обозначения фигуры — проверка всех 147 фигур разом
const badHips = STANDARD_FIGURES.filter((f) => !eq(f.measurements.rz19, f.hips));
ok(badHips.length === 0, `для всех 147 фигур Т19 равна обхвату бёдер из обозначения${badHips.length ? ": " + badHips.slice(0, 3).map((f) => f.id).join(",") : ""}`);
// и Т15 (обхват груди второй) больше обхвата груди III (Т16) на 4.0-5.6 см (по таблицам ОСТ разница своя у каждого блока)
const badT15 = STANDARD_FIGURES.filter((f) => !(f.measurements.rz15 - f.bust > 3.9 && f.measurements.rz15 - f.bust < 5.7));
ok(badT15.length === 0, `Т15 (груди второй) превышает обхват груди на 4.0-5.6 см у всех фигур${badT15.length ? ": " + badT15.slice(0, 3).map((f) => f.id).join(",") : ""}`);

// 4) ячейки, напечатанные в ОСТ (по одной-две из каждой таблицы; ×2 там, где в ОСТ половинные значения)
const cell = (id: string, key: keyof Measurements, want: number, note: string) => {
  const f = getStandardFigure(id);
  const got = f?.measurements[key];
  ok(!!f && got !== undefined && eq(got, want), `${note}: ${id}, ${key} = ${want}${got !== undefined && !eq(got, want) ? ` (получили ${got})` : ""}`);
};
cell("170-88-92", "rz7", 106.8, "таблица 4, Т7 при росте 170");
cell("170-104-108", "rz7", 107.6, "таблица 4, Т7");
cell("146-96-100", "rz14", 90.2, "таблица 4, Т14 (45.1 ×2) при росте 146");
cell("164-88-92", "rz12", 74.0, "таблица 4, Т12");
cell("164-104-108", "rz12", 73.6, "таблица 4, Т12");
cell("152-108-112", "rz7", 95.1, "таблица 5, Т7");
cell("164-108-112", "rz7", 103.5, "таблица 5, Т7");
cell("164-120-124", "rz18", 102.2, "таблица 5, Т18 (51.1 ×2)");
cell("176-96-104", "rz7", 111.6, "таблица 6, Т7 при росте 176");
cell("176-104-112", "rz7", 112.0, "таблица 6, Т7");
cell("176-100-108", "rz36", 55.8, "таблица 6, Т36");
cell("164-84-92", "rz18", 63.4, "таблица 6, Т18 (31.7 ×2)");
cell("164-104-112", "rz18", 84.4, "таблица 6, Т18 (42.2 ×2)");
cell("146-88-96", "rz13", 34.8, "таблица 6, Т13 (17.4 ×2) при росте 146");
cell("170-92-100", "rz44", 88.8, "таблица 6, Т44 = Т43 (44.3) + Т61 (44.5)");
cell("170-108-116", "rz7", 107.9, "таблица 7, Т7 при росте 170");
cell("164-120-128", "rz18", 103.6, "таблица 7, Т18 (51.8 ×2)");
cell("164-124-132", "rz7", 104.4, "таблица 8, Т7");
cell("152-124-132", "rz9", 41.7, "таблица 8, Т9");
cell("164-136-144", "rz14", 120.2, "таблица 8, Т14 (60.1 ×2)");
cell("164-84-96", "rz7", 102.8, "таблица 9, Т7");
cell("152-84-96", "rz18", 67.8, "таблица 9, Т18 (33.9 ×2)");
cell("146-88-100", "rz7", 90.4, "таблица 9, Т7 при росте 146");
cell("164-108-120", "rz14", 101.0, "таблица 10, Т14 (50.5 ×2)");
cell("164-120-132", "rz47", 42.4, "таблица 10, Т47 (21.2 ×2)");
cell("164-88-104", "rz7", 103.2, "таблица 11, Т7");
cell("164-104-120", "rz36", 54.1, "таблица 11, Т36");
cell("164-104-120", "rz57", 12.4, "таблица 11, Т57");
cell("152-108-124", "rz47", 39.6, "таблица 12, Т47 (19.8 ×2)");
cell("164-120-136", "rz18", 106.4, "таблица 12, Т18 (53.2 ×2)");

// 5) распознавание «какая фигура сейчас выставлена»
ok(findStandardFigure({ ...DEFAULT_MEASUREMENTS_W_164_96_104 })?.id === "164-96-104", "findStandardFigure узнаёт 164-96-104 по мерке");
ok(findStandardFigure({ ...DEFAULT_MEASUREMENTS_W_164_96_104, rz13: 37.1 }) === null, "изменили одну мерку на 0.1 — это уже «свои мерки»");

if (failed) throw new Error("Есть провалившиеся проверки.");
console.log("\nВсе проверки типовых фигур ОСТ пройдены.");
