import type { Point } from "./types.js";
import type { Piece } from "./piece.js";
import { pieceKeys } from "./piece.js";
import type { PieceTransform } from "./render-script-svg.js";

/**
 * Выгрузка деталей: DXF и PDF. Координаты везде в сантиметрах. Деталь выгружается так, как лежит
 * на листе в студии (смещение и поворот, которые вы задали мышью и стрелками), с припуском или без.
 */

export interface ExportOptions {
  /** Выгружать припуски на швы. По умолчанию да. */
  allowance?: boolean;
  /** Положение деталей на листе (ключ детали → смещение в см и поворот в °). */
  transforms?: Record<string, PieceTransform>;
  /** Заголовок — печатается в углу PDF (латиницей: русские буквы транслитерируются). */
  title?: string;
}

interface Placed {
  name: string;
  color: number;
  center: Point;
  outline: Point[];
  allowance: Point[] | null;
  inner: Point[][];
  innerPoints: Point[];
  notches: Point[][];
  grain: [Point, Point] | null;
}

const EPS = 1e-9;

/** Применяет положение детали на листе: поворот вокруг её центра (по часовой на экране) и сдвиг. */
function placePieces(pieces: Piece[], opts: ExportOptions): Placed[] {
  if (pieces.length === 0) throw new Error("Нет деталей для выгрузки — запишите деталь оператором writePiece.");
  const keys = pieceKeys(pieces);
  return pieces.map((pc, i) => {
    const xf = opts.transforms?.[keys[i]] ?? { dx: 0, dy: 0, angle: 0 };
    const r = (xf.angle * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const map = (p: Point): Point => {
      const x = p.x - pc.center.x, y = p.y - pc.center.y;
      return { x: pc.center.x + x * cos - y * sin + xf.dx, y: pc.center.y + x * sin + y * cos + xf.dy };
    };
    return {
      name: pc.name,
      color: pc.color,
      center: map(pc.center),
      outline: pc.outline.points.map(map),
      allowance: opts.allowance === false || !pc.allowance ? null : pc.allowance.points.map(map),
      inner: pc.inner.map((l) => l.points.map(map)),
      innerPoints: pc.innerPoints.map(map),
      notches: pc.notches.map((n) => n.points.map(map)),
      grain: pc.grain ? [map(pc.grain.p1), map(pc.grain.p2)] : null,
    };
  });
}

function boundsOf(placed: Placed[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: Point) => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; };
  for (const p of placed) { p.outline.forEach(add); p.allowance?.forEach(add); p.inner.forEach((l) => l.forEach(add)); p.notches.forEach((l) => l.forEach(add)); }
  return { minX, minY, maxX, maxY };
}

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
/** Подписи в PDF/DXF — только латиница (стандартные шрифты PDF и R12 не содержат кириллицы): «Спинка» → «Spinka». */
export function translit(s: string): string {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    if (CYR[low] !== undefined) { const t = CYR[low]; out += ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1); }
    else if (/[\x20-\x7e]/.test(ch)) out += ch;
    else out += "_";
  }
  return out;
}

// Палитра Leko (номер цвета 1-15) — как в рисовании на экране.
const HEX: Record<number, string> = {
  1: "#1a3a8a", 2: "#1e8a3c", 3: "#1a8a9a", 4: "#b32020", 5: "#7a2a9a", 6: "#7a4a1a", 7: "#9a9a9a", 8: "#555555",
  9: "#2a5aff", 10: "#22b34a", 11: "#00a8c8", 12: "#e0301e", 13: "#b03ad0", 14: "#d8a800", 15: "#222222",
};
const rgb = (color: number): [number, number, number] => {
  const h = (HEX[color] ?? HEX[1]).slice(1);
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};
// Индексы цветов AutoCAD (ACI) для DXF.
const ACI: Record<number, number> = { 1: 5, 2: 3, 3: 4, 4: 1, 5: 6, 6: 30, 7: 9, 8: 8, 9: 5, 10: 3, 11: 4, 12: 1, 13: 6, 14: 2, 15: 7 };

// ==================================================================== DXF

const f4 = (x: number) => (Math.abs(x) < EPS ? "0" : x.toFixed(4).replace(/\.?0+$/, ""));

/**
 * DXF (AutoCAD R12, ASCII — открывается практически любой САПР и раскройной программой).
 * Единицы — сантиметры. Слои: CONTOUR (контур), ALLOWANCE (припуск, штриховая), INNER (внутренние линии и метки),
 * NOTCH (надсечки), GRAIN (долевая), TEXT (имя детали). Ось Y направлена вверх, как принято в DXF.
 */
export function exportDxf(pieces: Piece[], opts: ExportOptions = {}): string {
  const placed = placePieces(pieces, opts);
  const b = boundsOf(placed);
  const L: string[] = [];
  const g = (code: number, value: string | number) => { L.push(String(code), String(value)); };
  const Y = (y: number) => -y; // экранная Y вниз → DXF Y вверх

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$EXTMIN"); g(10, f4(b.minX)); g(20, f4(Y(b.maxY)));
  g(9, "$EXTMAX"); g(10, f4(b.maxX)); g(20, f4(Y(b.minY)));
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "LTYPE"); g(2, "DASHED"); g(70, 0); g(3, "Dashed"); g(72, 65); g(73, 2); g(40, 0.75); g(49, 0.5); g(49, -0.25);
  g(0, "ENDTAB");
  const layers: [string, number, string][] = [["0", 7, "CONTINUOUS"], ["CONTOUR", 5, "CONTINUOUS"], ["ALLOWANCE", 1, "DASHED"], ["INNER", 3, "CONTINUOUS"], ["NOTCH", 5, "CONTINUOUS"], ["GRAIN", 8, "CONTINUOUS"], ["TEXT", 7, "CONTINUOUS"]];
  g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
  for (const [name, color, lt] of layers) { g(0, "LAYER"); g(2, name); g(70, 0); g(62, color); g(6, lt); }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  const poly = (layer: string, pts: Point[], closed: boolean, color?: number) => {
    g(0, "POLYLINE"); g(8, layer); if (color !== undefined) g(62, color); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, f4(p.x)); g(20, f4(Y(p.y))); g(30, 0); }
    g(0, "SEQEND"); g(8, layer);
  };
  const line = (layer: string, a: Point, c: Point, color?: number) => {
    g(0, "LINE"); g(8, layer); if (color !== undefined) g(62, color);
    g(10, f4(a.x)); g(20, f4(Y(a.y))); g(30, 0); g(11, f4(c.x)); g(21, f4(Y(c.y))); g(31, 0);
  };
  for (const p of placed) {
    const col = ACI[p.color] ?? 5;
    const closedPts = (pts: Point[]) => (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6 ? pts.slice(0, -1) : pts);
    poly("CONTOUR", closedPts(p.outline), true, col);
    if (p.allowance) poly("ALLOWANCE", closedPts(p.allowance), true, col);
    for (const l of p.inner) poly("INNER", l, false, col);
    for (const ip of p.innerPoints) { g(0, "POINT"); g(8, "INNER"); g(62, col); g(10, f4(ip.x)); g(20, f4(Y(ip.y))); g(30, 0); }
    for (const n of p.notches) if (n.length >= 2) line("NOTCH", n[0], n[n.length - 1], col);
    if (p.grain) line("GRAIN", p.grain[0], p.grain[1], 8);
    g(0, "TEXT"); g(8, "TEXT"); g(10, f4(p.center.x)); g(20, f4(Y(p.center.y) - 2)); g(30, 0); g(40, 1.2); g(1, translit(p.name)); g(72, 1); g(11, f4(p.center.x)); g(21, f4(Y(p.center.y) - 2)); g(31, 0);
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\n") + "\n";
}

// ==================================================================== PDF

const PT = 72 / 2.54; // пунктов PDF в сантиметре
const num = (x: number) => (Math.abs(x) < 1e-6 ? "0" : x.toFixed(2).replace(/\.?0+$/, ""));
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

type ToPage = (p: Point) => [number, number];

/** Операторы PDF для всех деталей; toPage переводит сантиметры чертежа в пункты страницы. */
function drawOps(placed: Placed[], toPage: ToPage): string {
  const o: string[] = [];
  const path = (pts: Point[], close: boolean) => {
    pts.forEach((p, i) => { const [x, y] = toPage(p); o.push(`${num(x)} ${num(y)} ${i === 0 ? "m" : "l"}`); });
    if (close) o.push("h");
  };
  for (const p of placed) {
    const [r, g, b] = rgb(p.color);
    if (p.allowance) { o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 0.6 w [6 4] 0 d`); path(p.allowance, true); o.push("S Q"); }
    o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 0.5 w`);
    for (const l of p.inner) { path(l, false); o.push("S"); }
    o.push("Q");
    o.push(`q ${num(r)} ${num(g)} ${num(b)} rg ${num(r)} ${num(g)} ${num(b)} RG`);
    for (const ip of p.innerPoints) { const [x, y] = toPage(ip); o.push(`${num(x - 1.2)} ${num(y - 1.2)} 2.4 2.4 re f`); }
    o.push("Q");
    o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 0.9 w`);
    for (const n of p.notches) { path(n, false); o.push("S"); }
    o.push("Q");
    if (p.grain) { o.push(`q 0.35 0.35 0.35 RG 0.5 w [1 3] 0 d`); path(p.grain, false); o.push("S Q"); }
    o.push(`q ${num(r)} ${num(g)} ${num(b)} RG 1.1 w`); path(p.outline, true); o.push("S Q");
    const [tx, ty] = toPage({ x: p.center.x, y: p.center.y });
    const label = translit(p.name);
    o.push(`q ${num(r)} ${num(g)} ${num(b)} rg BT /F2 10 Tf ${num(tx - label.length * 2.8)} ${num(ty - 3)} Td (${esc(label)}) Tj ET Q`);
  }
  return o.join("\n");
}

/** 10-сантиметровая контрольная линия: по ней проверяют, что при печати не включено масштабирование. */
function rulerOps(x: number, y: number): string {
  const L = 10 * PT;
  return `q 0 0 0 RG 0.8 w ${num(x)} ${num(y)} m ${num(x + L)} ${num(y)} l S ${num(x)} ${num(y - 3)} m ${num(x)} ${num(y + 3)} l S ${num(x + L)} ${num(y - 3)} m ${num(x + L)} ${num(y + 3)} l S BT /F1 7 Tf ${num(x + L + 6)} ${num(y - 2.5)} Td (10 cm - check print scale 100%) Tj ET Q`;
}

function buildPdf(pages: { w: number; h: number; content: string }[], title: string): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES_PLACEHOLDER");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const infoNo = add(`<< /Title (${esc(translit(title))}) /Producer (StroyKroy) >>`);
  const kids: number[] = [];
  for (const pg of pages) {
    const contentNo = objs.length + 2;
    const pageNo = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
    add(`<< /Length ${pg.content.length} >>\nstream\n${pg.content}\nendstream`);
    kids.push(pageNo);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff; // весь файл — ASCII
  return bytes;
}

/** PDF в натуральную величину на одном листе по размеру деталей (для плоттера или печати на заказ). */
export function exportPdf(pieces: Piece[], opts: ExportOptions = {}): Uint8Array {
  const placed = placePieces(pieces, opts);
  const b = boundsOf(placed);
  const mg = 1.5; // поле, см
  const wCm = b.maxX - b.minX + 2 * mg, hCm = b.maxY - b.minY + 2 * mg + 1.5;
  const w = wCm * PT, h = hCm * PT;
  if (w > 14400 || h > 14400) throw new Error("Детали не помещаются на одном листе PDF (больше 5 м) — используйте PDF по листам A4.");
  const toPage: ToPage = (p) => [(p.x - b.minX + mg) * PT, h - (p.y - b.minY + mg + 1.5) * PT];
  const head = `q 0.3 g BT /F1 8 Tf ${num(mg * PT)} ${num(h - 0.9 * PT)} Td (${esc(translit(opts.title ?? "StroyKroy"))} - 1:1) Tj ET Q`;
  const content = [head, drawOps(placed, toPage), rulerOps(mg * PT, 0.8 * PT)].join("\n");
  return buildPdf([{ w, h, content }], opts.title ?? "StroyKroy");
}

/** PDF мозаикой по листам A4 (210×297 мм) с нахлёстом 1 см — печатается на домашнем принтере, листы склеиваются по меткам. */
export function exportPdfA4(pieces: Piece[], opts: ExportOptions = {}): Uint8Array {
  const placed = placePieces(pieces, opts);
  const b = boundsOf(placed);
  const PW = 595.276, PH = 841.89, mgPt = 1 * PT;
  const tw = (PW - 2 * mgPt) / PT, th = (PH - 2 * mgPt) / PT; // печатная область листа, см
  const overlap = 1;
  const x0 = b.minX - 0.5, y0 = b.minY - 0.5;
  const W = b.maxX - b.minX + 1, H = b.maxY - b.minY + 1;
  const nx = Math.max(1, Math.ceil((W - overlap) / (tw - overlap))), ny = Math.max(1, Math.ceil((H - overlap) / (th - overlap)));

  // отрезки для проверки «в листе что-то есть»
  const segs: [Point, Point][] = [];
  const addPoly = (pts: Point[]) => { for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]); };
  for (const p of placed) { addPoly(p.outline); if (p.allowance) addPoly(p.allowance); p.inner.forEach(addPoly); p.notches.forEach(addPoly); if (p.grain) addPoly(p.grain); }
  const hits = (rx0: number, ry0: number, rx1: number, ry1: number) =>
    segs.some(([a, c]) => Math.max(a.x, c.x) >= rx0 && Math.min(a.x, c.x) <= rx1 && Math.max(a.y, c.y) >= ry0 && Math.min(a.y, c.y) <= ry1);

  const tiles: { r: number; c: number }[] = [];
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const tx = x0 + c * (tw - overlap), ty = y0 + r * (th - overlap);
    if (hits(tx, ty, tx + tw, ty + th)) tiles.push({ r, c });
  }
  const total = tiles.length;
  const pages = tiles.map(({ r, c }, idx) => {
    const tx = x0 + c * (tw - overlap), ty = y0 + r * (th - overlap);
    const toPage: ToPage = (p) => [mgPt + (p.x - tx) * PT, PH - mgPt - (p.y - ty) * PT];
    const clip = `q ${num(mgPt)} ${num(mgPt)} ${num(tw * PT)} ${num(th * PT)} re W n`;
    const frame = `q 0.6 G 0.4 w ${num(mgPt)} ${num(mgPt)} ${num(tw * PT)} ${num(th * PT)} re S Q`;
    const label = `Sheet ${r + 1}-${c + 1} - page ${idx + 1} of ${total} - ${translit(opts.title ?? "StroyKroy")} - print at 100%`;
    const arrows: string[] = [];
    if (c < nx - 1) arrows.push(`BT /F1 8 Tf ${num(PW - mgPt - 52)} ${num(PH / 2)} Td (-> ${r + 1}-${c + 2}) Tj ET`);
    if (c > 0) arrows.push(`BT /F1 8 Tf ${num(mgPt + 2)} ${num(PH / 2)} Td (<- ${r + 1}-${c}) Tj ET`);
    if (r < ny - 1) arrows.push(`BT /F1 8 Tf ${num(PW / 2 - 14)} ${num(mgPt - 10)} Td (v ${r + 2}-${c + 1}) Tj ET`);
    if (r > 0) arrows.push(`BT /F1 8 Tf ${num(PW / 2 - 14)} ${num(PH - mgPt + 4)} Td (^ ${r}-${c + 1}) Tj ET`);
    const content = [
      clip, drawOps(placed, toPage), "Q", frame,
      `q 0.3 g BT /F1 7 Tf ${num(mgPt)} ${num(PH - mgPt + 14)} Td (${esc(label)}) Tj ET Q`,
      `q 0.3 g ${arrows.join(" ")} Q`,
      rulerOps(mgPt, 8),
    ].join("\n");
    return { w: PW, h: PH, content };
  });
  return buildPdf(pages, opts.title ?? "StroyKroy");
}
