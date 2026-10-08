import { runLekoScript } from "../script-runner.js";
import { algToScript } from "../alg-import.js";
import { writePiece, pieceBounds, shiftPiece } from "../piece.js";
import { point, segment } from "../ops.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES } from "../../types.js";

let failed = false;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("FAIL:", msg); failed = true; } else console.log("ok:", msg);
}
const M = DEFAULT_MEASUREMENTS_W_164_96_104, P = DEFAULT_EASES;

// основа отдаёт export_*, рукав принимает import_*
const base = runLekoScript("let a = 1;\nlet export_width = 12.5;\nlet export_name = 'x';\nlet notexport = 3;", M, P);
assert(base.exports["export_width"] === 12.5 && base.exports["export_name"] === "x" && !("notexport" in base.exports), "основа: собраны только export_* (число/текст)");
const el = runLekoScript('let import_width = importValue("import_width");\nlet import_none = importValue("import_none");\nlet w = import_width + 1;', M, P, undefined, base.exports);
assert(el.ошибка === null && el.переменные.w === 13.5, "рукав получил import_width = 12.5");
assert(el.imports.length === 2 && el.imports[0].found && !el.imports[1].found, "список запрошенного: найдено / не найдено");

// старая основа отдаёт export_par_5, рукав просит import_opt_5
const old = runLekoScript('let q = importValue("import_opt_5");', M, P, undefined, { export_par_5: 3 });
assert(old.переменные.q === 3, "export_par_N читается как import_opt_N");

// перевод ALG: import_* становится importValue, пар_ → opt_ внутри имени
const tr = algToScript("имя := 1;\nесли существует(import_fabric_type) то\nфон := import_fabric_type;\n;конец_если;\nexport_пар_5 := пар_5;\n", { inputsAsConstants: true });
assert(tr.script.includes('let import_fabric_type = importValue("import_fabric_type");'), "ALG: import_ → importValue");
assert(tr.script.includes("export_opt_5"), "ALG: export_пар_5 → export_opt_5");

// отложить_в(линия, расстояние, точка) → layOffAlong; «длина − 0.0001» не даёт ошибку
const al = algToScript("а := точка(0,0);\nб := точка(10,0);\nд2 := отрезок(а,б);\nотложить_в(д2,д2.л-0.0001,к2);\n", { inputsAsConstants: true });
const alRun = runLekoScript(al.script, M, P);
assert(alRun.ошибка === null && Math.abs((alRun.переменные.k2 as { x: number }).x - 9.9999) < 1e-6, "ALG: отложить_в → layOffAlong");

// сдвиг детали
const sq = writePiece({ name: "Кв", contour: [segment(point(0, 0), point(5, 0)), segment(point(5, 0), point(5, 5)), segment(point(5, 5), point(0, 5)), segment(point(0, 5), point(0, 0))], allowance: 1 });
const moved = shiftPiece(sq, 10, 3, "Кв2");
const b0 = pieceBounds([sq])!, b1 = pieceBounds([moved])!;
assert(moved.name === "Кв2" && Math.abs(b1.minX - b0.minX - 10) < 1e-9 && Math.abs(b1.minY - b0.minY - 3) < 1e-9, "shiftPiece сдвигает деталь и переименовывает");

if (failed) throw new Error("Есть провалившиеся проверки (см. вывод выше).");
console.log("\nВсе проверки связей пройдены.");
