import { point } from "../ops.js";
import { writePiece, type Piece } from "../piece.js";
import { exportPlt, plotterFit, exportDxf, exportPdf, exportPdfA4, exportPdfA3, exportPdfA0, exportPdfRoll, translit } from "../export.js";

let failed = false;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("FAIL:", msg); failed = true; } else console.log("ok:", msg);
}
const near = (a: number, b: number, e = 0.01) => Math.abs(a - b) < e;

const sq = (name: string, size: number, allowance = 1) =>
  writePiece({ name, contour: [point(0, 0), point(size, 0), point(size, size), point(0, size)], allowance, notches: [point(size / 2, 0)], grain: [point(size / 2, size / 2), 90], inner: [[point(1, 1), point(size - 1, 1)]], color: 11 });

// ---------------------------------------------------------------- разбор DXF
interface Ent { type: string; g: [number, string][] }
function parseDxf(text: string): { sections: string[]; entities: Ent[]; layers: string[]; header: Record<string, string> } {
  const lines = text.split("\n");
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);
  const sections: string[] = [], entities: Ent[] = [], layers: string[] = [], header: Record<string, string> = {};
  let sec = "", cur: Ent | null = null, table = "";
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION") { sec = pairs[i + 1][1]; sections.push(sec); continue; }
    if (c === 0 && v === "ENDSEC") { sec = ""; cur = null; continue; }
    if (sec === "HEADER" && c === 9) header[v] = pairs[i + 1][1] + "|" + (pairs[i + 2] ? pairs[i + 2][1] : "");
    if (sec === "TABLES") { if (c === 0 && v === "TABLE") table = pairs[i + 1][1]; if (table === "LAYER" && c === 0 && v === "LAYER") layers.push(pairs[i + 1][1]); }
    if (sec === "ENTITIES") { if (c === 0) { cur = { type: v, g: [] }; entities.push(cur); } else if (cur) cur.g.push([c, v]); }
  }
  return { sections, entities, layers, header };
}
const layerOf = (e: Ent) => e.g.find(([c]) => c === 8)?.[1];
const polysOn = (d: ReturnType<typeof parseDxf>, layer: string) => {
  const out: { closed: boolean; pts: [number, number][] }[] = [];
  const ents = d.entities;
  for (let i = 0; i < ents.length; i++) if (ents[i].type === "POLYLINE" && layerOf(ents[i]) === layer) {
    const closed = (Number(ents[i].g.find(([c]) => c === 70)?.[1]) & 1) === 1;
    const pts: [number, number][] = [];
    for (let j = i + 1; ents[j].type === "VERTEX"; j++) pts.push([Number(ents[j].g.find(([c]) => c === 10)![1]), Number(ents[j].g.find(([c]) => c === 20)![1])]);
    out.push({ closed, pts });
  }
  return out;
};

{
  const a = sq("BACK", 10), b = sq("Спинка", 20);
  const dxf = exportDxf([a, b], {});
  const d = parseDxf(dxf);
  assert(d.sections.join(",") === "HEADER,TABLES,BLOCKS,ENTITIES" && dxf.trimEnd().endsWith("EOF"), "DXF: разделы HEADER, TABLES, BLOCKS, ENTITIES и конец EOF");
  assert(dxf.includes("AC1009"), "DXF: версия R12 (AC1009) — самая совместимая");
  assert(["CONTOUR", "ALLOWANCE", "INNER", "NOTCH", "GRAIN", "TEXT"].every((l) => d.layers.includes(l)), `DXF: слои контур/припуск/внутренние/надсечки/долевая/текст: ${d.layers.join(", ")}`);
  const contour = polysOn(d, "CONTOUR");
  assert(contour.length === 2 && contour.every((p) => p.closed && p.pts.length === 4), "DXF: два замкнутых контура по 4 вершины (повтор первой точки не дублируется)");
  const allow = polysOn(d, "ALLOWANCE");
  assert(allow.length === 2 && allow.every((p) => p.closed), "DXF: два замкнутых контура припуска");
  const xs = allow[0].pts.map((p) => p[0]), ys = allow[0].pts.map((p) => p[1]);
  assert(near(Math.min(...xs), -1) && near(Math.max(...xs), 11) && near(Math.max(...ys), 1) && near(Math.min(...ys), -11), "DXF: припуск 1 см даёт габарит -1…11 по X; ось Y перевёрнута вверх (−11…1)");
  assert(polysOn(d, "INNER").length === 2 && d.entities.filter((e) => e.type === "LINE" && layerOf(e) === "NOTCH").length === 2, "DXF: внутренние линии (2) и надсечки (2 линии)");
  assert(d.entities.filter((e) => e.type === "TEXT").length === 2 && dxf.includes("Spinka"), "DXF: подписи деталей, кириллица транслитерирована (Спинка → Spinka)");
  assert(!/[^\x00-\x7f]/.test(dxf), "DXF: файл только из ASCII — нет проблем с кодировкой");

  // припуски выключены → слоя с ними нет
  const off = parseDxf(exportDxf([a, b], { allowance: false }));
  assert(polysOn(off, "ALLOWANCE").length === 0 && polysOn(off, "CONTOUR").length === 2, "DXF: allowance:false — припусков в файле нет, контуры на месте");

  // положение на листе: сдвиг и поворот
  const moved = parseDxf(exportDxf([a], { transforms: { BACK: { dx: 10, dy: 5, angle: 0 } } }));
  const mx = polysOn(moved, "CONTOUR")[0].pts.map((p) => p[0]), my = polysOn(moved, "CONTOUR")[0].pts.map((p) => p[1]);
  assert(near(Math.min(...mx), 10) && near(Math.max(...mx), 20) && near(Math.max(...my), -5), "DXF: сдвиг детали (10; 5) учтён: X 10…20, Y вверх-перевёрнута (−15…−5)");
  const rot = parseDxf(exportDxf([a], { transforms: { BACK: { dx: 0, dy: 0, angle: 90 } } }));
  const rp = polysOn(rot, "CONTOUR")[0].pts;
  const side = Math.hypot(rp[1][0] - rp[0][0], rp[1][1] - rp[0][1]);
  assert(near(side, 10), "DXF: при повороте на 90° стороны остаются 10 см");
  assert(near(Math.min(...rp.map((p) => p[0])), 0) && near(Math.max(...rp.map((p) => p[0])), 10), "DXF: квадрат, повёрнутый на 90° вокруг центра, занимает тот же габарит");

  let thrown = false; try { exportDxf([]); } catch { thrown = true; }
  assert(thrown, "DXF: без деталей — понятная ошибка");
}

// ---------------------------------------------------------------- разбор PDF
function readPdf(bytes: Uint8Array) {
  let text = ""; for (const b of bytes) text += String.fromCharCode(b);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
  const xrefHead = text.slice(startxref, startxref + 6);
  const m = /xref\n0 (\d+)\n/.exec(text.slice(startxref))!;
  const count = Number(m[1]);
  const table = text.slice(startxref + m[0].length).split("\n").slice(0, count);
  const offsets = table.slice(1).map((l) => Number(l.slice(0, 10)));
  const mediaBoxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((x) => [Number(x[1]), Number(x[2])]);
  return { text, xrefHead, count, offsets, mediaBoxes, pages: Number(/\/Count (\d+)/.exec(text)![1]) };
}
const PTCM = 72 / 2.54;

{
  const p = sq("BACK", 10);
  const bytes = exportPdf([p], { title: "Платье" });
  const r = readPdf(bytes);
  assert(r.text.startsWith("%PDF-1.4") && r.xrefHead === "xref\n0", "PDF: заголовок %PDF-1.4 и таблица xref на месте");
  assert(r.offsets.every((off, i) => r.text.slice(off).startsWith(`${i + 1} 0 obj`)), `PDF: все ${r.offsets.length} смещений в xref указывают на свои объекты`);
  assert(!/[^\x00-\x7f]/.test(r.text), "PDF: только ASCII (подписи транслитерированы)");
  assert(r.pages === 1 && r.mediaBoxes.length === 1, "PDF 1:1: один лист");
  // деталь 10×10 + припуск 1 → 12 см, поля 1.5 с каждой стороны, внизу ещё 1.5 см на линейку
  assert(near(r.mediaBoxes[0][0], 15 * PTCM, 0.05) && near(r.mediaBoxes[0][1], 16.5 * PTCM, 0.05), `PDF 1:1: лист ${r.mediaBoxes[0].map((x) => (x / PTCM).toFixed(2)).join("×")} см = 15×16.5 (деталь + припуск + поля) в натуральную величину`);
  const lens = [...r.text.matchAll(/\/Length (\d+)>>\nstream\n([\s\S]*?)\nendstream/g)].map((x) => [Number(x[1]), x[2].length]);
  assert(lens.every(([a, b]) => a === b), "PDF: длины потоков в словарях совпадают с фактическими");
  assert(r.text.includes("10 sm po shirine \\(pechat 100%\\)"), "PDF: контрольная линия 10 см для проверки масштаба печати");
  assert(r.text.includes("Plate"), "PDF: заголовок «Платье» транслитерирован (Plate)");
  const noAllow = readPdf(exportPdf([p], { allowance: false }));
  assert(near(noAllow.mediaBoxes[0][0], 13 * PTCM, 0.05), "PDF: без припусков лист уже на 2 см (габарит 10 + поля 3)");
  assert(!noAllow.text.includes("[6 4] 0 d") && r.text.includes("[6 4] 0 d"), "PDF: пунктир припуска есть только при включённых припусках");
}
{
  // большая деталь → мозаика A4: рамки листов стыкуются без нахлёста, печатаются все листы сетки (пустые помечены)
  const big = writePiece({ name: "BIG", contour: [point(0, 0), point(50, 0), point(50, 80), point(0, 80)], allowance: 1 });
  const r = readPdf(exportPdfA4([big], {}));
  // поле 1 см: область 19×27.7 без нахлёста; габарит 52×82 → ceil(52/19)=3, ceil(82/27.7)=3 → сетка 3×3 = 9 листов
  assert(r.pages === 9 && r.mediaBoxes.every(([w, h]) => near(w, 595.28, 0.05) && near(h, 841.89, 0.05)), `PDF A4: деталь 50×80 см → ${r.pages} листов формата A4 (сетка 3×3)`);
  assert(r.offsets.every((off, i) => r.text.slice(off).startsWith(`${i + 1} 0 obj`)), "PDF A4: таблица xref согласована");
  assert(r.text.includes("List 1-1 - str. 1 iz 9") && r.text.includes("List 3-3 - str. 9 iz 9"), "PDF A4: листы подписаны «List 1-1 - str. 1 iz 9» … «List 3-3 - str. 9 iz 9»");
  assert(r.text.includes("List 2-2 ") && r.text.includes("PUSTOY LIST"), "PDF A4: пустая средняя клетка 2-2 не пропущена, а помечена «PUSTOY LIST»");
  assert((r.text.match(/10 sm po shirine \\\(pechat 100%\\\)/g) ?? []).length === 9, "PDF A4: на каждом листе есть контрольная линия 10 см");

  const L = writePiece({ name: "L", contour: [point(0, 0), point(60, 0), point(60, 10), point(10, 10), point(10, 70), point(0, 70)], allowance: 0 });
  const rl = readPdf(exportPdfA4([L], {}));
  assert(rl.pages === 4 * 3, `PDF A4: Г-образная деталь — все листы сетки без дыр (${rl.pages} из 12 клеток)`);

  const small = readPdf(exportPdfA4([sq("S", 10)], {}));
  assert(small.pages === 1, "PDF A4: маленькая деталь — один лист");
}
{
  // листы A3 и A0: размер страниц и число листов
  const big = writePiece({ name: "BIG", contour: [point(0, 0), point(50, 0), point(50, 80), point(0, 80)], allowance: 1 });
  const a3 = readPdf(exportPdfA3([big], {}));
  // A3 = 29.7×42 см, поле 1 см → область 27.7×40; шаг 26.7×39; габарит 52×82 → 2×3 клеток
  assert(a3.pages >= 4 && a3.pages <= 6 && a3.mediaBoxes.every(([w, h]) => near(w, 841.89, 0.05) && near(h, 1190.55, 0.05)), `PDF A3: деталь 50×80 см → ${a3.pages} листов формата A3`);
  const a0 = readPdf(exportPdfA0([big], {}));
  assert(a0.pages === 1 && near(a0.mediaBoxes[0][0], 2383.94, 0.05) && near(a0.mediaBoxes[0][1], 3370.39, 0.05), "PDF A0: деталь 50×80 см помещается на одном листе формата A0");
}
{
  assert(translit("Спинка") === "Spinka" && translit("Перед (ЖЁЛТЫЙ)") === "Pered (ZhELTYY)" && translit("日本") === "__", "translit: кириллица → латиница, прочее → «_»");
}

if (failed) { throw new Error("Есть провалившиеся проверки (см. вывод выше)."); }
console.log("\nВсе проверки выгрузки пройдены.");

// ---- DXF ANSI/AAMA: блок на деталь, слои 1/14/4/7, миллиметры
{
  const aama = exportDxf([sq("BACK", 10), sq("Спинка", 20)], { target: "aama" });
  const pr = parseDxf(aama);
  assert(pr.sections.join(",") === "HEADER,TABLES,BLOCKS,ENTITIES", "AAMA: разделы HEADER, TABLES, BLOCKS, ENTITIES");
  assert((aama.match(/\nBLOCK\n/g) ?? []).length === 2 && (aama.match(/\nINSERT\n/g) ?? []).length === 2, "AAMA: на каждую деталь один BLOCK и один INSERT");
  assert(aama.includes("Piece Name: ") && aama.includes("Quantity: 1") && aama.includes("Units: METRIC"), "AAMA: подписи детали и единицы METRIC");
  assert(aama.includes("-S_1"), "AAMA: имя блока «деталь-S_размер»");
}

// ---------------------------------------------------------------- PLT: ширина рулона
{
  const wide = writePiece({ name: "Широкая", contour: [point(0, 0), point(100, 0), point(100, 30), point(0, 30)], allowance: 0, color: 11 });
  const pcs = [sq("A", 40, 0), sq("B", 40, 0), sq("C", 40, 0), wide];
  const maxY = (plt: string) => {
    const nums = [...plt.matchAll(/P[UD]([\d,]+);/g)].flatMap((m) => m[1].split(",").map(Number));
    return Math.max(...nums.filter((_, i) => i % 2 === 1)) / 400;
  };
  const fit = plotterFit(pcs, { width: 90 });
  assert(fit.tooWide.length === 0, "PLT: детали помещаются в рулон 90 см");
  assert(maxY(exportPlt(pcs, { allowance: false, plotterWidth: 90 })) <= 90 + 1e-6, "PLT: чертёж не выше ширины рулона 90 см");
  assert(maxY(exportPlt(pcs, { allowance: false, plotterWidth: 50 })) <= 50 + 1e-6, "PLT: широкую деталь поворачивают, чертёж не выше рулона 50 см");
  assert(plotterFit(pcs, { width: 20 }).tooWide.length === pcs.length, "PLT: рулон 20 см уже любой детали — все в списке «не помещаются»");
  // деталь больше ширины рулона — режется на полосы, каждая не выше рулона, рамка и номер полосы на месте
  const huge = writePiece({ name: "Огромная", contour: [point(0, 0), point(60, 0), point(60, 80), point(0, 80)], allowance: 0, color: 11 });
  const hf = plotterFit([huge], { width: 50 });
  assert(hf.bands === 2 && hf.split.length === 1, "PLT: деталь 60×80 на рулоне 50 см — две полосы");
  // PDF для рулона: высота страницы = ширина рулона (91,4 см = 914 мм), по умолчанию 914 мм
  const rollText = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");
  const rb = [...rollText(exportPdfRoll(pcs, { allowance: false })).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((x) => [Number(x[1]), Number(x[2])]);
  assert(rb.length === 1 && near(rb[0][1], 91.4 * 72 / 2.54, 0.5), "PDF рулон: высота страницы 914 мм по умолчанию");
  const rb2 = [...rollText(exportPdfRoll([huge], { allowance: false, plotterWidth: 50 })).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((x) => [Number(x[1]), Number(x[2])]);
  assert(rb2.length === 2 && rb2.every((x) => near(x[1], 50 * 72 / 2.54, 0.5)), "PDF рулон: деталь шире рулона режется на 2 страницы высотой в рулон");
  const hp = exportPlt([huge], { allowance: false, plotterWidth: 50 });
  assert(maxY(hp) <= 50 + 1e-6, "PLT: каждая полоса не выше рулона 50 см");
  assert(hp.includes("LBPolosa 1 iz 2") || hp.includes("LB Polosa 1 iz 2"), "PLT: на полосах подписан номер «Polosa 1 iz 2»");
  assert(hp.includes("LT4,1;"), "PLT: рамка полосы рисуется пунктиром «точка-тире»");
}
