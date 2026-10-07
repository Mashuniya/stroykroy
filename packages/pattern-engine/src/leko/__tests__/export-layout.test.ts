import { point } from "../ops.js";
import { writePiece } from "../piece.js";
import { exportDxf, exportPdf, arrangePieces, piecesOverlap, exportLayoutInfo } from "../export.js";
import { EASE_INFO } from "../../measurement-names.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };
const near = (a: number, b: number, e = 0.01) => Math.abs(a - b) < e;


// Синтетические детали: «спинка» 30×40 с острой вытачкой (≈12.5°, глубина 10 см) и «перед» 25×40. Оба стоят у начала координат, то есть накладываются.
const dartPiece = (name: string, w: number, withDart: boolean) => {
  const dl = point(12.9, 0), apex = point(14, 10), dr = point(15.1, 0);
  return writePiece({
    name,
    contour: withDart
      ? [point(0, 0), dl, apex, dr, point(w, 0), point(w, 40), point(0, 40)]
      : [point(0, 0), point(w, 0), point(w, 40), point(0, 40)],
    allowance: 1, color: 11,
    // на ножках вытачки припуска нет (как в построении): иначе припуски двух ножек заходят друг за друга
    allowanceZones: withDart ? [[dl, 0, 0, dr]] : undefined,
    inner: [[point(2, 20), point(w - 2, 20)]],
    grain: [point(w / 2, 25), 90],
    notches: [point(w / 2, 40)],
  });
};
const pieces = [dartPiece("Спинка", 30, true), dartPiece("Перед", 25, false)];
// ---- разбор DXF
function polylines(dxf: string, layer?: string) {
  const L = dxf.split("\n"); const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < L.length; i += 2) pairs.push([Number(L[i]), L[i + 1]]);
  const out: { layer: string; closed: boolean; pts: { x: number; y: number }[] }[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === "POLYLINE") {
      let lay = "", closed = false, j = i + 1;
      for (; !(pairs[j][0] === 0); j++) { if (pairs[j][0] === 8) lay = pairs[j][1]; if (pairs[j][0] === 70) closed = (Number(pairs[j][1]) & 1) === 1; }
      const pts: { x: number; y: number }[] = [];
      while (pairs[j][1] === "VERTEX") { let x = 0, y = 0; j++; for (; pairs[j][0] !== 0; j++) { if (pairs[j][0] === 10) x = Number(pairs[j][1]); if (pairs[j][0] === 20) y = Number(pairs[j][1]); } pts.push({ x, y }); }
      if (!layer || lay === layer) out.push({ layer: lay, closed, pts });
    }
  }
  return out;
}
const bbox = (pts: { x: number; y: number }[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
const area = (pts: { x: number; y: number }[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
const cross = (a: any, b: any, c: any, d: any) => { const o = (p: any, q: any, r: any) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); return o(c, d, a) * o(c, d, b) < -1e-12 && o(a, b, c) * o(a, b, d) < -1e-12; };
const selfX = (pts: any[]) => { let n = 0; for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) { if (i === 0 && j === pts.length - 1) continue; if (cross(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) n++; } return n; };
const segD = (p: any, a: any, b: any) => { const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)); return Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey); };
const segSeg = (a: any, b: any, c: any, d: any) => (cross(a, b, c, d) ? 0 : Math.min(segD(a, c, d), segD(b, c, d), segD(c, a, b), segD(d, a, b)));
// Самая узкая «щель» контура: две точки на контуре, которые близко в пространстве, но далеко друг от друга ВДОЛЬ контура
// (так выглядит вырез вытачки). Два звена по обе стороны короткого звена щелью не считаются.
const narrowest = (pts: any[], minPath = 3) => {
  const dense: { x: number; y: number; s: number }[] = []; let acc = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b.x - a.x, b.y - a.y); const k = Math.max(1, Math.ceil(l / 0.1)); for (let t = 0; t < k; t++) dense.push({ x: a.x + ((b.x - a.x) * t) / k, y: a.y + ((b.y - a.y) * t) / k, s: acc + (l * t) / k }); acc += l; }
  let m = Infinity;
  for (let i = 0; i < dense.length; i++) for (let j = i + 1; j < dense.length; j++) { const ds = Math.abs(dense[i].s - dense[j].s); if (Math.min(ds, acc - ds) < minPath) continue; const d = Math.hypot(dense[i].x - dense[j].x, dense[i].y - dense[j].y); if (d < m) m = d; }
  return m;
};

// ---------------------------------------------------------------- раскладка без наложений
ok(piecesOverlap(pieces, {}), "две детали у начала координат накладываются друг на друга");
const dxfSep = exportDxf(pieces, {});
const cs = polylines(dxfSep, "CONTOUR"), as = polylines(dxfSep, "ALLOWANCE");
const ba = bbox(as[0].pts), bb = bbox(as[1].pts);
const gap = Math.max(bb.x0 - ba.x1, ba.x0 - bb.x1);
ok(gap > 1.9 && gap < 2.1, `в DXF припуски деталей не накладываются: зазор между деталями ${gap.toFixed(2)} см (2 см)`);
ok(near(ba.y0, bb.y0, 0.01) && near(ba.y1, bb.y1, 0.01), "детали стоят в один ряд (верхние и нижние края на одном уровне)");
const dxfRaw = exportDxf(pieces, { separate: false });
const ra = polylines(dxfRaw, "ALLOWANCE");
ok(Math.max(bbox(ra[1].pts).x0 - bbox(ra[0].pts).x1, bbox(ra[0].pts).x0 - bbox(ra[1].pts).x1) < 0, "с separate:false детали остаются как в построении (накладываются)");
ok(exportLayoutInfo(pieces, {}).overlapped === true, "exportLayoutInfo сообщает, что детали были разложены");

// если человек сам разложил без наложений — его положение сохраняется
const tr = { "Перед": { dx: 60, dy: 0, angle: 0 } };
ok(!piecesOverlap(pieces, { transforms: tr }) && exportLayoutInfo(pieces, { transforms: tr }).overlapped === false, "перед сдвинут на 60 см — наложений нет, ничего не раскладывается");
const dxfMine = polylines(exportDxf(pieces, { transforms: tr }), "CONTOUR");
ok(near(bbox(dxfMine[1].pts).x0 - bbox(dxfMine[0].pts).x0, 60, 0.01), "ручное положение (сдвиг 60 см) попадает в файл без изменений");

// узкий лист: детали переносятся в следующий ряд
const narrow = arrangePieces(pieces, { maxWidth: 40 });
ok(Math.abs(narrow["Перед"].dy - narrow["Спинка"].dy) > 40, `при ширине ряда 40 см детали уходят в два ряда (смещения по Y: ${narrow["Спинка"].dy.toFixed(0)} и ${narrow["Перед"].dy.toFixed(0)})`);
ok(!piecesOverlap(pieces, { transforms: narrow }) && !piecesOverlap(pieces, { transforms: arrangePieces(pieces, {}) }), "после раскладки наложений нет (в одном ряду и в двух)");
// вращение при раскладке сохраняется, наложения нет
const rot = arrangePieces(pieces, { transforms: { "Перед": { dx: 0, dy: 0, angle: 90 } } });
ok(rot["Перед"].angle === 90 && !piecesOverlap(pieces, { transforms: rot }), "повёрнутая деталь после раскладки остаётся повёрнутой, наложений нет");
// PDF: размер листа соответствует разложенным деталям
const pdf = new TextDecoder("latin1").decode(exportPdf(pieces, {}));
const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
ok(Number(mb[1]) / (72 / 2.54) > 62, `PDF 1:1: лист шире 62 см — детали в ряд, а не друг на друге (${(Number(mb[1]) / (72 / 2.54)).toFixed(1)} см)`);

// ---------------------------------------------------------------- DXF для CLO3D
const clo = exportDxf(pieces, { target: "clo" });
const cp = polylines(clo);
ok(cp.length === 4, `для CLO3D: 2 контура деталей + 2 внутренние линии (по одной на деталь) — всего полилиний ${cp.length}`);
const outer = cp.filter((p) => p.closed);
ok(outer.length === 2 && outer.map((p) => p.layer).join(",") === "Spinka,Pered", `по одному замкнутому контуру на деталь, слои названы по деталям: ${outer.map((p) => p.layer).join(", ")}`);
ok(outer.every((p) => area(p.pts) > 0), "контуры идут против часовой стрелки");
ok(outer.every((p) => selfX(p.pts) === 0), "контуры не пересекают сами себя");
const sharp = polylines(dxfSep, "ALLOWANCE")[0].pts;
ok(narrowest(sharp) < 0.5 && outer.every((p) => narrowest(p.pts) >= 0.55), `щель вытачки: в обычном DXF ${narrowest(sharp).toFixed(2)} см (острый конец), в DXF для CLO3D не уже ${Math.min(...outer.map((p) => narrowest(p.pts))).toFixed(2)} см`);
const classic = polylines(dxfSep, "ALLOWANCE");
ok(outer.every((p, i) => Math.abs(Math.abs(area(p.pts)) - Math.abs(area(classic[i].pts))) < 3), `площадь детали почти не изменилась от притупления вытачки (отличие < 3 см²)`);
ok(!polylines(clo, "CONTOUR").length && !polylines(clo, "ALLOWANCE").length, "вложенных контуров (CONTOUR внутри ALLOWANCE) в файле для CLO3D нет");
ok(!/NOTCH/.test(clo.replace(/LAYER[\s\S]*?ENDTAB/, "")), "надсечки (пересекающие границу) не выгружаются");
ok(exportLayoutInfo(pieces, { target: "clo" }).blunted === 1, "острый конец вытачки притуплён — exportLayoutInfo сообщает 1");
// внутренние линии лежат внутри: ни одна не пересекает и не касается границы
const inner = cp.filter((p) => !p.closed);
const touches = inner.filter((l) => outer.some((o) => l.pts.some((q) => o.pts.some((_, i) => segD(q, o.pts[i], o.pts[(i + 1) % o.pts.length]) < 0.049))));
ok(touches.length === 0, `внутренние линии (${inner.length}) не касаются границы ближе 0.5 мм`);

// припуски выключены → тот же режим берёт контур по линии шва
const cloNo = polylines(exportDxf(pieces, { target: "clo", allowance: false }), "Spinka")[0];
ok(cloNo.closed && Math.abs(area(cloNo.pts)) < Math.abs(area(outer[0].pts)) - 50, "без припусков для CLO3D выгружается контур по линии шва (меньше по площади)");

// ---------------------------------------------------------------- подсвечиваемые участки прибавок
ok(Object.values(EASE_INFO).every((i) => (i!.segments?.length ?? 0) > 0 && i!.segments!.every((sg) => sg.length === 2 && /^t\d+p?$/.test(sg[0]) && /^t\d+p?$/.test(sg[1]))), "для каждой показываемой прибавки задан участок между двумя точками построения");

if (failed) throw new Error("Есть провалившиеся проверки.");
console.log("\nВсе проверки раскладки и DXF для CLO3D пройдены.");
