import type { Point } from "./types.js";
import { isSegment, isArc, isPolyline } from "./types.js";
import { isPiece, pieceKeys, type Piece } from "./piece.js";

export interface RenderScriptOptions {
  scale?: number;
  showLabels?: boolean;
  width?: number;
  height?: number;
  padding?: number;
  /** Детали, записанные оператором writePiece (рисуются под остальными элементами). */
  pieces?: Piece[];
  /** Положение деталей на листе (только вид, на построение не влияет): ключ детали → смещение в см и поворот в ° (по часовой). */
  pieceTransforms?: Record<string, PieceTransform>;
  /** Ключ детали, которая сейчас "прилипла" к курсору — её точка-ручка рисуется крупнее. */
  activePiece?: string | null;
  /** Показывать точки построения (с подписями). "contour" — только основные точки на контуре деталей и на концах внутренних линий (висящие скрываются). По умолчанию да. */
  showPoints?: boolean | "contour";
  /** Подсветка участков чертежа (например, при правке прибавки): отрезки между точками, в координатах чертежа, и подпись. */
  highlights?: { segments: [Point, Point][]; label?: string };
  /** Показывать припуски на швы (пунктир вокруг деталей). По умолчанию да. Размер холста при этом не меняется. */
  showAllowance?: boolean;
  /** Дополнительное поле вокруг чертежа, px — чтобы деталь можно было унести за пределы исходного чертежа. */
  margin?: number;
}

export interface PieceTransform { dx: number; dy: number; angle: number }

function isPoint(x: unknown): x is Point {
  return !!x && typeof x === "object" && typeof (x as Point).x === "number" && typeof (x as Point).y === "number" && !("p1" in (x as object));
}

function collectPoints(variables: Record<string, unknown>, pieces: Piece[] = []): Point[] {
  const allPts: Point[] = [];
  const collect = (v: unknown) => {
    if (isPiece(v)) { allPts.push(...v.outline.points); if (v.allowance) allPts.push(...v.allowance.points); }
    else if (isPoint(v)) allPts.push(v);
    else if (isSegment(v)) allPts.push(v.p1, v.p2);
    else if (isArc(v)) allPts.push(v.p1, v.p2, v.center);
    else if (isPolyline(v)) allPts.push(...v.points);
    else if (Array.isArray(v)) v.forEach(collect);
  };
  Object.values(variables).forEach(collect);
  pieces.forEach(collect);
  return allPts;
}

/**
 * Масштаб (px на см), которым renderScriptSvg нарисует variables по умолчанию
 * (вписывает всё в width×height с отступом padding). Вынесено отдельной
 * функцией, чтобы интерфейс (зум +/-) мог взять эту же "базовую" величину и
 * домножить на свой коэффициент увеличения, а не дублировать расчёт.
 */
export function autoFitScale(variables: Record<string, unknown>, opts: { width?: number; height?: number; padding?: number; pieces?: Piece[] } = {}): number {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 800;
  const padding = opts.padding ?? 40;
  const allPts = collectPoints(variables, opts.pieces);
  if (allPts.length === 0) return 5;
  const minX = Math.min(...allPts.map((p) => p.x)), maxX = Math.max(...allPts.map((p) => p.x));
  const minY = Math.min(...allPts.map((p) => p.y)), maxY = Math.max(...allPts.map((p) => p.y));
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  return Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY, 10);
}

/** Рисует все точки/отрезки/дуги/ломаные, найденные среди переменных скрипта. Автоматически подбирает масштаб и центрирование. */
export function renderScriptSvg(variables: Record<string, unknown>, opts: RenderScriptOptions = {}): string {
  const baseW = opts.width ?? 1000;
  const baseH = opts.height ?? 800;
  const basePad = opts.padding ?? 40;
  const margin = opts.margin ?? 0;
  const showLabels = opts.showLabels ?? true;
  const showPoints = opts.showPoints ?? true;

  const allPts = collectPoints(variables, opts.pieces);

  if (allPts.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${baseW}" height="${baseH}"><text x="20" y="30" font-family="sans-serif" font-size="13">Нет точек для отображения — объявите хотя бы одну переменную-точку.</text></svg>`;
  }

  const minX = Math.min(...allPts.map((p) => p.x)), maxX = Math.max(...allPts.map((p) => p.x));
  const minY = Math.min(...allPts.map((p) => p.y)), maxY = Math.max(...allPts.map((p) => p.y));
  const scale = opts.scale ?? autoFitScale(variables, { width: baseW, height: baseH, padding: basePad, pieces: opts.pieces });

  // Размер холста берём по реальному содержимому (при увеличении оно больше базового) + поле вокруг.
  const width = Math.max(baseW, 2 * basePad + (maxX - minX) * scale) + 2 * margin;
  const height = Math.max(baseH, 2 * basePad + (maxY - minY) * scale) + 2 * margin;
  const padding = basePad + margin;

  const toSvg = (p: Point): [number, number] => [padding + (p.x - minX) * scale, padding + (p.y - minY) * scale];

  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}">`];

  const drawPoint = (p: Point, name: string) => {
    const [x, y] = toSvg(p);
    // прозрачный кружок побольше — чтобы было удобно попадать кликом, видимая точка поверх него
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="transparent"/>`);
    parts.push(`<circle class="sv-mark" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#2f6f4f"/>`);
    if (showLabels && showPoints === true) parts.push(`<text x="${(x + 4).toFixed(1)}" y="${(y - 3).toFixed(1)}" font-size="8" font-family="monospace" fill="#3a4a41">${name}</text>`);
    parts.push(`</g>`);
  };
  const drawSeg = (a: Point, b: Point, name: string) => {
    const [ax, ay] = toSvg(a), [bx, by] = toSvg(b);
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="transparent" stroke-width="10" stroke-linecap="round"/>`);
    parts.push(`<line class="sv-mark" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#1f2d28" stroke-width="1.3"/>`);
    parts.push(`</g>`);
  };
  const drawArc = (startAngle: number, endAngle: number, radius: number, from: Point, to: Point, name: string) => {
    const [ax, ay] = toSvg(from), [bx, by] = toSvg(to);
    const r = radius * scale;
    const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
    const sweep = endAngle > startAngle ? 1 : 0;
    const d = `M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} ${sweep} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<path d="${d}" fill="none" stroke="transparent" stroke-width="10" stroke-linecap="round"/>`);
    parts.push(`<path class="sv-mark" d="${d}" fill="none" stroke="#1f2d28" stroke-width="1.3"/>`);
    parts.push(`</g>`);
  };
  const drawPolyline = (pts: Point[], name: string) => {
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toSvg(p)[0].toFixed(1)} ${toSvg(p)[1].toFixed(1)}`).join(" ");
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<path d="${d}" fill="none" stroke="transparent" stroke-width="10" stroke-linecap="round"/>`);
    parts.push(`<path class="sv-mark" d="${d}" fill="none" stroke="#1f2d28" stroke-width="1.3"/>`);
    parts.push(`</g>`);
  };

  // --- Детали (writePiece): рисуются первыми, чтобы точки и линии конструкции оставались кликабельными сверху ---
  const LEKO_COLORS: Record<number, string> = {
    1: "#1a3a8a", 2: "#1e8a3c", 3: "#1a8a9a", 4: "#b32020", 5: "#7a2a9a", 6: "#7a4a1a", 7: "#9a9a9a", 8: "#555555",
    9: "#2a5aff", 10: "#22b34a", 11: "#00a8c8", 12: "#e0301e", 13: "#b03ad0", 14: "#d8a800", 15: "#222222",
  };
  const pathOf = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toSvg(p)[0].toFixed(1)} ${toSvg(p)[1].toFixed(1)}`).join(" ");
  const pieceList: Piece[] = [...(opts.pieces ?? [])];
  for (const v of Object.values(variables)) if (isPiece(v) && !pieceList.includes(v)) pieceList.push(v);
  const keys = pieceKeys(pieceList);
  const drawPiece = (pc: Piece, index: number) => {
    const varName = Object.entries(variables).find(([, v]) => v === pc)?.[0];
    const name = varName ?? pc.name.replace(/[^\wА-Яа-яЁё]/g, "_");
    const col = LEKO_COLORS[pc.color] ?? "#1a3a8a";
    const xf = opts.pieceTransforms?.[keys[index]];
    const [hx, hy] = toSvg(pc.center);
    const tr = xf && (xf.dx !== 0 || xf.dy !== 0 || xf.angle !== 0)
      ? ` transform="translate(${(xf.dx * scale).toFixed(2)} ${(xf.dy * scale).toFixed(2)}) rotate(${xf.angle.toFixed(3)} ${hx.toFixed(2)} ${hy.toFixed(2)})"` : "";
    parts.push(`<g data-var="${name}" class="sv-item sv-piece"${tr} style="cursor:pointer">`);
    if (pc.allowance && opts.showAllowance !== false) parts.push(`<path d="${pathOf(pc.allowance.points)}" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="5 3" opacity="0.75" pointer-events="none"/>`);
    for (const ln of pc.inner) parts.push(`<path d="${pathOf(ln.points)}" fill="none" stroke="${col}" stroke-width="1.1" pointer-events="none"/>`);
    for (const ip of pc.innerPoints) { const [x, y] = toSvg(ip); parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${col}" pointer-events="none"/>`); }
    for (const nt of pc.notches) parts.push(`<path d="${pathOf(nt.points)}" fill="none" stroke="${col}" stroke-width="1.8" pointer-events="none"/>`);
    if (pc.grain) parts.push(`<path d="${pathOf([pc.grain.p1, pc.grain.p2])}" fill="none" stroke="${col}" stroke-width="1.2" stroke-dasharray="1 3" pointer-events="none"/>`);
    parts.push(`<path d="${pathOf(pc.outline.points)}" fill="none" stroke="transparent" stroke-width="10" stroke-linecap="round" pointer-events="stroke"/>`);
    parts.push(`<path class="sv-mark" d="${pathOf(pc.outline.points)}" fill="none" stroke="${col}" stroke-width="2.2" pointer-events="stroke"/>`);
    // подпись — чуть ниже центра, чтобы не лежала под крупной точкой-ручкой
    parts.push(`<text x="${hx.toFixed(1)}" y="${(hy + 26).toFixed(1)}" font-size="13" font-family="sans-serif" font-weight="bold" fill="${col}" text-anchor="middle" opacity="0.6" pointer-events="none">${pc.name.replace(/[<>&]/g, "")}</text>`);
    // крупная точка в центре: кликнуть — деталь "прилипает" к курсору, стрелки ←/→ поворачивают
    const active = opts.activePiece === keys[index];
    parts.push(`<g class="sv-handle" data-piece-index="${index}" style="cursor:${active ? "grabbing" : "grab"}">`);
    parts.push(`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${active ? 17 : 14}" fill="${col}" opacity="0.22"/>`);
    parts.push(`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${active ? 8.5 : 7}" fill="${col}" stroke="#fff" stroke-width="2"/>`);
    parts.push(`</g>`);
    parts.push(`</g>`);
  };
  pieceList.forEach((pc, i) => drawPiece(pc, i));

  // «основные» точки: лежат на контуре детали или на конце её внутренней линии
  const mainPts: Point[] = [];
  for (const pc of pieceList) {
    mainPts.push(...pc.outline.points);
    for (const ln of pc.inner) if (ln.points.length) mainPts.push(ln.points[0], ln.points[ln.points.length - 1]);
  }
  const isMainPoint = (p: Point) => mainPts.some((q) => Math.abs(q.x - p.x) < 0.02 && Math.abs(q.y - p.y) < 0.02);

  for (const [name, v] of Object.entries(variables)) {
    if (isPiece(v)) continue; // уже нарисована выше
    if (isPoint(v)) { if (showPoints === true || (showPoints === "contour" && isMainPoint(v))) drawPoint(v, name); }
    else if (isSegment(v)) drawSeg(v.p1, v.p2, name);
    else if (isArc(v)) drawArc(v.startAngle, v.endAngle, v.radius, v.p1, v.p2, name);
    else if (isPolyline(v)) drawPolyline(v.points, name);
  }

  // подсветка участка поверх всего, мышь не перехватывает
  if (opts.highlights && opts.highlights.segments.length > 0) {
    parts.push(`<g class="sv-highlight" pointer-events="none">`);
    for (const [a, b] of opts.highlights.segments) {
      const [x1, y1] = toSvg(a), [x2, y2] = toSvg(b);
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ff8a00" stroke-width="9" stroke-linecap="round" opacity="0.55"/>`);
      parts.push(`<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="5" fill="#ff8a00" stroke="#fff" stroke-width="1.5"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="5" fill="#ff8a00" stroke="#fff" stroke-width="1.5"/>`);
    }
    if (opts.highlights.label) {
      const [a, b] = opts.highlights.segments[0];
      const [mx, my] = toSvg({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const t = opts.highlights.label.replace(/[<>&]/g, "");
      parts.push(`<text x="${(mx + 10).toFixed(1)}" y="${(my - 8).toFixed(1)}" font-size="12" font-family="sans-serif" font-weight="bold" fill="#b45500" stroke="#fff" stroke-width="3" paint-order="stroke">${t}</text>`);
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
