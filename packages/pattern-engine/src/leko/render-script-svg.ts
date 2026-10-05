import type { Point } from "./types.js";
import { isSegment, isArc, isPolyline } from "./types.js";

export interface RenderScriptOptions {
  scale?: number;
  showLabels?: boolean;
  width?: number;
  height?: number;
  padding?: number;
}

function isPoint(x: unknown): x is Point {
  return !!x && typeof x === "object" && typeof (x as Point).x === "number" && typeof (x as Point).y === "number" && !("p1" in (x as object));
}

function collectPoints(variables: Record<string, unknown>): Point[] {
  const allPts: Point[] = [];
  const collect = (v: unknown) => {
    if (isPoint(v)) allPts.push(v);
    else if (isSegment(v)) allPts.push(v.p1, v.p2);
    else if (isArc(v)) allPts.push(v.p1, v.p2, v.center);
    else if (isPolyline(v)) allPts.push(...v.points);
    else if (Array.isArray(v)) v.forEach(collect);
  };
  Object.values(variables).forEach(collect);
  return allPts;
}

/**
 * Масштаб (px на см), которым renderScriptSvg нарисует variables по умолчанию
 * (вписывает всё в width×height с отступом padding). Вынесено отдельной
 * функцией, чтобы интерфейс (зум +/-) мог взять эту же "базовую" величину и
 * домножить на свой коэффициент увеличения, а не дублировать расчёт.
 */
export function autoFitScale(variables: Record<string, unknown>, opts: { width?: number; height?: number; padding?: number } = {}): number {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 800;
  const padding = opts.padding ?? 40;
  const allPts = collectPoints(variables);
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

  const allPts = collectPoints(variables);

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

  for (const [name, v] of Object.entries(variables)) {
    if (isPoint(v)) drawPoint(v, name);
    else if (isSegment(v)) drawSeg(v.p1, v.p2, name);
    else if (isArc(v)) drawArc(v.startAngle, v.endAngle, v.radius, v.p1, v.p2, name);
    else if (isPolyline(v)) drawPolyline(v.points, name);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
