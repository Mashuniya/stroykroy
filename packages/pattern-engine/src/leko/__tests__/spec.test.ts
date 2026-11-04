import { point } from "../ops.js";
import { writePiece } from "../piece.js";
import { exportSpecPdf, pieceSpec } from "../export.js";
import { rbToScript } from "../rb-import.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };

const pc = (name: string, fabric?: string, count?: number) => writePiece({ name, fabric, count, contour: [point(0, 0), point(10, 0), point(10, 10), point(0, 10)] });

// Группы по материалам: сокращения понятны, порядок как в построении, без материала — в конце
const spec = pieceSpec([pc("Спинка", "ОТ", 1), pc("Без ткани"), pc("Рукав", "Основная ткань", 2), pc("Прокладка", "КЛ", 1), pc("Пояс", "ВХ1", 2)]);
ok(spec.map((g) => g.fabric).join("|") === "Основная ткань|Клеевая прокладка|ВХ1|Материал не указан", "материалы: " + spec.map((g) => g.fabric).join("|"));
ok(spec[0].rows.length === 2 && spec[0].rows[1].count === 2, "сокращение ОТ и полное название — один материал");
ok(spec[3].rows[0].count === undefined, "количество не указано — не выдумываем");

// Одноимённые детали одного материала — одной строкой
const twins = pieceSpec([pc("Погон", "ОТ", 2), pc("Погон", "ОТ", 2)]);
ok(twins[0].rows.length === 1 && twins[0].rows[0].count === 4, "одноимённые детали суммируются");
ok(pieceSpec([pc("Погон", "ОТ", 2), pc("Погон", "ОТ")])[0].rows[0].count === undefined, "неизвестное количество не суммируется");

// PDF: один лист на короткий список, новые листы на длинный
const pages = (u8: Uint8Array) => (new TextDecoder("latin1").decode(u8).match(/\/Type \/Page\b/g) ?? []).length;
ok(pages(exportSpecPdf([pc("Спинка", "ОТ", 1)], { title: "T" })) === 1, "короткая спецификация — один лист");
const many = Array.from({ length: 80 }, (_, i) => pc("Деталь " + i, i % 2 ? "ОТ" : "КЛ", 1));
ok(pages(exportSpecPdf(many)) > 1, "длинная спецификация — несколько листов");

// кд из алгоритма становится количеством: сумма левых и правых
const rb = 'п1 = точка(0, 0)\nп2 = точка(10, 0)\nп3 = точка(10, 10)\nзаписать(имя = ["Погон"], контур = [п1, п2, п3], полотно = "ОТ", кд = [2, 2])\n';
ok(/count: 2 \+ 2/.test(rbToScript(rb, { title: "t" }).script), "кд = [2, 2] → count: 2 + 2");

if (failed) throw new Error("Есть провалившиеся проверки.");
