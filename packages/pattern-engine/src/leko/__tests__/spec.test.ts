import { point } from "../ops.js";
import { writePiece } from "../piece.js";
import { exportDxf, exportSpecPdf, pieceSpec } from "../export.js";
import { rbToScript } from "../rb-import.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };

const pc = (name: string, fabric?: string, count?: number) => writePiece({ name, fabric, count, contour: [point(0, 0), point(10, 0), point(10, 10), point(0, 10)] });

// Группы по материалам: сокращения понятны, порядок как в построении, без материала — в конце
const spec = pieceSpec([pc("Спинка", "ОТ", 1), pc("Без ткани"), pc("Рукав", "Основная ткань", 2), pc("Прокладка", "КЛ", 1), pc("Пояс", "ВХ1", 2)]);
ok(spec.map((g) => g.fabric).join("|") === "Основная ткань|Клеевая прокладка|Основная ткань верха 1|Материал не указан", "материалы: " + spec.map((g) => g.fabric).join("|"));
ok(spec[0].rows.length === 2 && spec[0].rows[1].count === 2, "сокращение ОТ и полное название — один материал");
ok(spec[3].rows[0].count === 1, "кд нет — одна деталь");

// Коды полотен из алгоритмов, сочетания и хвост с числом деталей
const fab = (f: string) => pieceSpec([pc("Д", f)])[0].fabric;
ok(fab("ВХ") === "Основная ткань верха", "ВХ — основная ткань верха");
ok(fab("ВХ1_2дт") === "Основная ткань верха 1", "номер полотна сохраняется, хвост _2дт убирается");
ok(fab("НМ") === "Намелка" && fab("ШБ") === "Шаблон", "намелка и шаблон");
ok(pieceSpec([pc("Д", "ОТ+ОСН")]).length === 1, "одинаковые полотна в сочетании не повторяются");

// Лекало из двух полотен — в разделе каждого, с тем же номером
const two = pieceSpec([pc("Воротник", "ОТ+КЛ", 1)]);
ok(two.map((g) => g.fabric).join("|") === "Основная ткань|Клеевая прокладка" && two[1].rows[0].mark === "1" && two[1].rows[0].count === 1, "два полотна — два раздела");
const tails = pieceSpec([pc("Планка", "ВХ1_1дт+КЛЕЕВАЯ_2дт", 2)]);
ok(tails[0].rows[0].count === 1 && tails[1].rows[0].count === 2, "в сочетании число деталей — из хвоста _Nдт");
ok(pieceSpec([pc("Д", "ВХ_2дт")])[0].rows[0].count === 2 && pieceSpec([pc("Д", "ВХ_2дт", 4)])[0].rows[0].count === 4, "одно полотно: кд важнее хвоста");

// Долевая у края детали сдвигается внутрь и остаётся длиной 15 см
const tall = writePiece({ name: "Т", contour: [point(0, 0), point(10, 0), point(10, 60), point(0, 60)], grain: [point(5, 0.5), 90] });
ok(Math.abs(Math.hypot(tall.grain!.p2.x - tall.grain!.p1.x, tall.grain!.p2.y - tall.grain!.p1.y) - 15) < 0.01, "долевая у края — всё равно 15 см");
ok(fab("") === "Материал не указан", "пустое полотно");

// Номер лекала — по порядку записи во всём построении, а не внутри материала
ok(spec[0].rows.map((r) => r.mark).join() === "1,3" && spec[1].rows[0].mark === "4" && spec[3].rows[0].mark === "2", "номера лекал по порядку записи");
const twins = pieceSpec([pc("Погон", "ОТ", 2), pc("Погон", "ОТ", 2)]);
ok(twins[0].rows.length === 2 && twins[0].rows[1].mark === "2", "одноимённые детали — разные лекала, разные номера");

// Маркировка на лекале: полная — номер и название; только номер — без названия
const sq = [pc("Spinka", "ОТ", 1), pc("Pered", "ОТ", 1)];
const full = exportDxf(sq, { target: "cad" }), only = exportDxf(sq, { target: "cad", numberOnly: true });
ok(full.includes("2. Pered"), "полная маркировка: номер и название");
ok(!only.includes("Pered") && /\n1\n2\n/.test(only.replace(/\r/g, "")), "только номер: названия нет, номер есть");

// PDF: один лист на короткий список, новые листы на длинный
const pages = (u8: Uint8Array) => (new TextDecoder("latin1").decode(u8).match(/\/Type \/Page\b/g) ?? []).length;
ok(pages(exportSpecPdf([pc("Спинка", "ОТ", 1)], { title: "T" })) === 1, "короткая спецификация — один лист");
const many = Array.from({ length: 80 }, (_, i) => pc("Деталь " + i, i % 2 ? "ОТ" : "КЛ", 1));
ok(pages(exportSpecPdf(many)) > 1, "длинная спецификация — несколько листов");

// кд из алгоритма становится количеством: сумма левых и правых
const rb = 'п1 = точка(0, 0)\nп2 = точка(10, 0)\nп3 = точка(10, 10)\nзаписать(имя = ["Погон"], контур = [п1, п2, п3], полотно = "ОТ", кд = [2, 2])\n';
ok(/count: 2 \+ 2/.test(rbToScript(rb, { title: "t" }).script), "кд = [2, 2] → count: 2 + 2");

if (failed) throw new Error("Есть провалившиеся проверки.");
