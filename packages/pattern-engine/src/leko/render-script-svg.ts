import type { Point } from "./types.js";
import { isSegment, isArc, isPolyline } from "./types.js";
import { isPiece, type Piece } from "./piece.js";

export interface RenderScriptOptions {
  scale?: number;
  showLabels?: boolean;
  width?: number;
  height?: number;
  padding?: number;
  /** Детали, записанные оператором writePiece (рисуются под остальными элементами). */
  pieces?: Piece[];
}

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
  const width = opts.width ?? 1000;
  const height = opts.height ?? 800;
  const padding = opts.padding ?? 40;
  const showLabels = opts.showLabels ?? true;

  const allPts = collectPoints(variables, opts.pieces);

  if (allPts.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="20" y="30" font-family="sans-serif" font-size="13">Нет точек для отображения — объявите хотя бы одну переменную-точку.</text></svg>`;
  }

  const minX = Math.min(...allPts.map((p) => p.x)), maxX = Math.max(...allPts.map((p) => p.x));
  const minY = Math.min(...allPts.map((p) => p.y)), maxY = Math.max(...allPts.map((p) => p.y));
  const scale = opts.scale ?? autoFitScale(variables, opts);

  const toSvg = (p: Point): [number, number] => [padding + (p.x - minX) * scale, padding + (p.y - minY) * scale];

  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];

  const drawPoint = (p: Point, name: string) => {
    const [x, y] = toSvg(p);
    // прозрачный кружок побольше — чтобы было удобно попадать кликом, видимая точка поверх него
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="transparent"/>`);
    parts.push(`<circle class="sv-mark" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#2f6f4f"/>`);
    if (showLabels) parts.push(`<text x="${(x + 4).toFixed(1)}" y="${(y - 3).toFixed(1)}" font-size="8" font-family="monospace" fill="#3a4a41">${name}</text>`);
    parts.push(`</g>`);
  };
  const drawSeg = (a: Point, b: Point, name: string) => {
    const [ax, ay] = toSvg(a), [bx, by] = toSvg(b);
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="transparent" stroke-width="10"/>`);
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
    parts.push(`<path d="${d}" fill="none" stroke="transparent" stroke-width="10"/>`);
    parts.push(`<path class="sv-mark" d="${d}" fill="none" stroke="#1f2d28" stroke-width="1.3"/>`);
    parts.push(`</g>`);
  };
  const drawPolyline = (pts: Point[], name: string) => {
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toSvg(p)[0].toFixed(1)} ${toSvg(p)[1].toFixed(1)}`).join(" ");
    parts.push(`<g data-var="${name}" class="sv-item" style="cursor:pointer">`);
    parts.push(`<path d="${d}" fill="none" stroke="transparent" stroke-width="10"/>`);
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
  const drawPiece = (pc: Piece) => {
    const varName = Object.entries(variables).find(([, v]) => v === pc)?.[0];
    const name = varName ?? pc.name.replace(/[^\wА-Яа-яЁё]/g, "_");
    const col = LEKO_COLORS[pc.color] ?? "#1a3a8a";
    parts.push(`<g data-var="${name}" class="sv-item sv-piece" style="cursor:pointer">`);
    if (pc.allowance) parts.push(`<path d="${pathOf(pc.allowance.points)}" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="5 3" opacity="0.75" pointer-events="none"/>`);
    for (const ln of pc.inner) parts.push(`<path d="${pathOf(ln.points)}" fill="none" stroke="${col}" stroke-width="1.1" pointer-events="none"/>`);
    for (const ip of pc.innerPoints) { const [x, y] = toSvg(ip); parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${col}" pointer-events="none"/>`); }
    for (const nt of pc.notches) parts.push(`<path d="${pathOf(nt.points)}" fill="none" stroke="${col}" stroke-width="1.8" pointer-events="none"/>`);
    if (pc.grain) parts.push(`<path d="${pathOf([pc.grain.p1, pc.grain.p2])}" fill="none" stroke="${col}" stroke-width="1.2" stroke-dasharray="1 3" pointer-events="none"/>`);
    parts.push(`<path d="${pathOf(pc.outline.points)}" fill="none" stroke="transparent" stroke-width="10" pointer-events="stroke"/>`);
    parts.push(`<path class="sv-mark" d="${pathOf(pc.outline.points)}" fill="none" stroke="${col}" stroke-width="2.2" pointer-events="stroke"/>`);
    const pts = pc.outline.points;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const [tx, ty] = toSvg({ x: cx, y: cy });
    parts.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="13" font-family="sans-serif" font-weight="bold" fill="${col}" text-anchor="middle" opacity="0.55" pointer-events="none">${pc.name.replace(/[<>&]/g, "")}</text>`);
    parts.push(`</g>`);
  };
  pieceList.forEach(drawPiece);

  for (const [name, v] of Object.entries(variables)) {
    if (isPiece(v)) continue; // уже нарисована выше
    if (isPoint(v)) drawPoint(v, name);
    else if (isSegment(v)) drawSeg(v.p1, v.p2, name);
    else if (isArc(v)) drawArc(v.startAngle, v.endAngle, v.radius, v.p1, v.p2, name);
    else if (isPolyline(v)) drawPolyline(v.points, name);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
