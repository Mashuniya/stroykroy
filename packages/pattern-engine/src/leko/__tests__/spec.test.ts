import { drawText, label, mirror, point, segment } from "../ops.js";
import { fitTextHeight, grainArrow, writePiece } from "../piece.js";
import { arrangeForRoll, arrangePieces, exportDxf, exportPdf, exportSpecPdf, grainTurn, pieceSpec } from "../export.js";
import { rbToScript } from "../rb-import.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };

const pc = (name: string, fabric?: string, count?: number) => writePiece({ name, fabric, count, contour: [point(0, 0), point(10, 0), point(10, 10), point(0, 10)] });

// Группы по материалам: сокращения понятны, основная ткань первой, без материала — в конце
const spec = pieceSpec([pc("Спинка", "ОТ", 1), pc("Без ткани"), pc("Рукав", "Основная ткань", 2), pc("Прокладка", "КЛ", 1), pc("Пояс", "ВХ1", 2)]);
ok(spec.map((g) => g.fabric).join("|") === "Основная ткань|Ткань верха 1|Клеевая прокладка|Материал не указан", "материалы: " + spec.map((g) => g.fabric).join("|"));
ok(spec[0].rows.length === 2 && spec[0].rows[1].count === 2, "сокращение ОТ и полное название — один материал");
ok(spec[3].rows[0].count === 1, "кд нет — одна деталь");

// Коды полотен из алгоритмов, сочетания и хвост с числом деталей
const fab = (f: string) => pieceSpec([pc("Д", f)])[0].fabric;
ok(fab("ВХ") === "Основная ткань верха", "ВХ — основная ткань верха");
ok(fab("ВХ1_2дт") === "Ткань верха 1", "номер полотна сохраняется, хвост _2дт убирается");
ok(fab("НМ") === "Намелка" && fab("ШБ") === "Шаблон", "намелка и шаблон");
ok(pieceSpec([pc("Д", "ОТ+ОСН")]).length === 1, "одинаковые полотна в сочетании не повторяются");

// «Только № и долевая»: метка на шве убирается, внутренняя линия остаётся
const moves = (u8: Uint8Array) => (new TextDecoder("latin1").decode(u8).match(/ m\s/g) ?? []).length;
const box = (extra: Partial<Parameters<typeof writePiece>[0]>) => writePiece({ name: "Д", allowance: 1, contour: [point(0, 0), point(20, 0), point(20, 20), point(0, 20)], ...extra });
const line = { inner: [[point(5, 5), point(15, 15)]] }, mark = { marks: [[1, 90, 1, 0.5, point(10, 0)]] as [number, number, number, number, ReturnType<typeof point>][] };
const both = box({ ...line, ...mark }), markOnly = box(mark);
ok(moves(exportPdf([both], { numberOnly: true })) === moves(exportPdf([markOnly], { numberOnly: true })) + 1, "внутренняя линия осталась");
ok(moves(exportPdf([markOnly], { numberOnly: true })) === moves(exportPdf([markOnly], { seamLine: false, numberOnly: true })) + 1, "линия шва печатается по своей галочке");
ok(moves(exportPdf([both])) > moves(exportPdf([both], { numberOnly: true })), "без галочки метка на шве печатается");
const copied = mirror([label(point(0, 10), 1, 0, 1, 0.5)], segment(point(10, 0), point(10, 20)));
ok(box({ inner: [[copied[0]]] }).contourMarks?.length === 1, "зеркальная копия метки на шве — тоже метка");
const noted = box({ notches: [point(10, 0)] });
ok(moves(exportPdf([noted], { numberOnly: true })) > moves(exportPdf([box({})], { numberOnly: true })), "только № и долевая: высечки остаются");
ok(moves(exportPdf([noted])) > moves(exportPdf([box({})])), "без галочки высечки печатаются");

// Долевая ставит деталь вертикально: ближайшим поворотом; без долевой и при ручном повороте деталь не трогаем
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const tilted = box({ grain: [point(10, 10), 30] }), steep = box({ grain: [point(10, 10), 120] });
ok(near(grainTurn(tilted), 60) && near(grainTurn(steep), -30) && grainTurn(box({})) === 0, "поворот по долевой");
ok(grainTurn(box({ grain: [point(10, 10), 90] })) === 0, "вертикальная долевая: поворота нет");
const laid = arrangePieces([tilted]);
ok(near(Object.values(laid)[0].angle, 60), "раскладка поворачивает по долевой");
const manual = arrangePieces([tilted], { transforms: { [Object.keys(laid)[0]]: { dx: 0, dy: 0, angle: 15 } } });
ok(near(Object.values(manual)[0].angle, 15), "ручной поворот важнее долевой");

// Надписи детали в PDF: печатаются; скрытые (нулевой высоты) — нет; в режиме «только №» остаётся только подпись долевой
const pdfText = (u8: Uint8Array) => new TextDecoder("latin1").decode(u8);
const texted = box({ inner: [drawText("Sgib", point(5, 5), 0.6, 0.6, 0), drawText("Dolevaya", point(5, 8), 0.6, 0.6, -90), drawText("Skryto", point(5, 9), 0, 0, 0)] as unknown as Parameters<typeof writePiece>[0]["inner"] });
const fullText = pdfText(exportPdf([texted]));
ok(fullText.includes("(Sgib) Tj") && !fullText.includes("(Skryto) Tj"), "надпись в PDF есть, скрытой нет");
ok(/0\.0000 1\.0000 -1\.0000 0\.0000 [\d.]+ [\d.]+ Tm \(Dolevaya\) Tj/.test(fullText), "надпись с углом -90 идёт снизу вверх");
ok(!pdfText(exportPdf([texted], { numberOnly: true })).includes("(Sgib) Tj"), "только №: надписи нет");

// Надпись не помещается в мелкую деталь — уменьшается; помещается — не меняется; точка снаружи — не трогаем
const strip = [point(0, 0), point(10, 0), point(10, 2), point(0, 2), point(0, 0)];
ok(fitTextHeight(strip, point(1, 1.5), 0, 4, 0.6) === 0.6, "короткая надпись не меняется");
const small = fitTextHeight(strip, point(1, 1.5), 0, 30, 0.6);
ok(small < 0.6 && small * 30 * 0.68 <= 9, "длинная надпись уменьшается и не выходит за деталь");
const up = fitTextHeight(strip, point(5, 1.8), -90, 12, 0.6);
ok(up < 0.6 && up * 12 * 0.68 <= 1.8, "вертикальная надпись помещается по высоте детали");
ok(fitTextHeight(strip, point(20, 1), 0, 30, 0.6) === 0.6, "точка вне детали — размер прежний");
ok(fitTextHeight(strip, point(1, 1), 0, 4, 0) === 0, "скрытая надпись остаётся скрытой");

// Долевая не задана — вертикально вниз, в стороне от середины; стрелка на нижнем конце
const dflt = box({});
ok(!!dflt.grain && near(dflt.grain.p1.x, dflt.grain.p2.x) && dflt.grain.p2.y > dflt.grain.p1.y && !near(dflt.grain.p1.x, 10), "долевая по умолчанию вертикально вниз, не по середине");
const head = grainArrow(point(0, 0), point(0, 10));
ok(head[1].y === 10 && head[0].y < 10 && head[2].y < 10 && head[0].x * head[2].x < 0, "стрелка смотрит по направлению долевой");
const tiny = writePiece({ name: "Шлевка", contour: [point(0, 0), point(6, 0), point(6, 1), point(0, 1)] });
ok(!!tiny.grain, "долевая есть и на мелкой детали");

// Рулон: помещающаяся деталь не поворачивается; не помещающаяся — поворачивается
const wide = writePiece({ name: "Ш", contour: [point(0, 0), point(40, 0), point(40, 20), point(0, 20)] });
const rollKeys = (w: number) => Object.values(arrangeForRoll([wide], { usable: w }).transforms)[0].angle;
ok(rollKeys(90) === 0, "на рулоне деталь, которая помещается, не поворачивается");
ok(rollKeys(30) === 90, "на рулоне деталь шире рулона поворачивается");

// Контур с «возвратом» по прямой: припуск без выступов, форма детали та же
const spur = writePiece({ name: "Л", allowance: 0.4, contour: [point(0, 0), point(7, 0), point(7, 1.9), point(7, 3.8), point(7, 1), point(7, 1.9), point(7, 3.8), point(0, 3.8)] });
const ax = spur.allowance!.points.map((q) => q.x);
ok(spur.allowance!.points.every((q) => q.x < -0.3 || q.x > 7.3 || q.y < -0.3 || q.y > 4.1), "у припуска нет точек внутри детали (выступа нет)");
ok(Math.max(...ax) < 7.5 && Math.abs(spur.area - 7 * 3.8) < 0.01, "площадь и ширина детали не изменились");

// Подпись количества на лекале: «N дт», без кд — 1; в режиме «только №» её нет
ok(pdfText(exportPdf([box({ count: 2 })])).includes("(2 dt) Tj"), "подпись «2 дт»");
ok(pdfText(exportPdf([box({})])).includes("(1 dt) Tj"), "без кд — «1 дт»");
ok(!pdfText(exportPdf([box({ count: 2 })], { numberOnly: true })).includes("dt) Tj"), "только №: подписи количества нет");

// Тип ткани на лекале — те же названия, что в спецификации; в режиме «только №» его нет
ok(pdfText(exportPdf([box({ fabric: "ОТ" })])).includes("(Osnovnaya tkan) Tj"), "тип ткани на лекале");
ok(pdfText(exportPdf([box({ fabric: "ОТ+КЛ" })])).includes("(Osnovnaya tkan + kleevaya prokladka) Tj"), "два типа ткани");
ok(!pdfText(exportPdf([box({ fabric: "ОТ" })], { numberOnly: true })).includes("Osnovnaya"), "только №: типа ткани нет");
ok(!pdfText(exportPdf([box({})])).includes("Material"), "ткань не указана: строки нет");

// Порядок разделов: основная, вторая основная, отделочная, клеевая, шаблоны
const order = pieceSpec([pc("А", "ШБ"), pc("Б", "КЛ"), pc("В", "РБН"), pc("Г", "ОТ2"), pc("Д", "ОТ"), pc("Е")]).map((g) => g.fabric).join("|");
ok(order === "Основная ткань|Основная ткань 2|Рибана|Клеевая прокладка|Шаблон|Материал не указан", "порядок разделов: " + order);

// Полотно, записанное дважды, приходит из перевода как «А / Б»: это тоже два раздела
ok(pieceSpec([pc("Д", "Основная ткань / Клеевая прокладка")]).length === 2, "« / » — два раздела");

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
ok(spec[0].rows.map((r) => r.mark).join() === "1,3" && spec[2].rows[0].mark === "4" && spec[3].rows[0].mark === "2", "номера лекал по порядку записи");
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
