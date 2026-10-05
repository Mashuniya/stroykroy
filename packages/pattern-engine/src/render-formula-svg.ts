import type { Point } from "./types.js";
import type { FormulaEvalResult, FormulaLine } from "./formula-engine.js";

export interface RenderFormulaOptions {
  scale?: number;
  showLabels?: boolean;
  width?: number;
  height?: number;
  /** x-координата, относительно которой строится "вторая деталь" (перед) — если не задана, всё рисуется в одних координатах. */
  splitAtX?: number;
  splitGapPx?: number;
}

/**
 * Рисует результат evalFormulaSteps без каких-либо знаний о конкретном
 * изделии: все точки — кружками с подписями, все дуги — дугами, все
 * линии из FormulaLine[] — отрезками. Ничего не хардкодится по именам
 * точек, поэтому рендер работает для любого набора шагов, какой бы
 * пользователь ни ввёл.
 */
export function renderFormulaSvg(
  result: FormulaEvalResult,
  lines: FormulaLine[],
  opts: RenderFormulaOptions = {}
): string {
  const scale = opts.scale ?? 5.2;
  const width = opts.width ?? 1000;
  const height = opts.height ?? 900;
  const showLabels = opts.showLabels ?? true;
  const ox = 140, oy = 90;
  const gap = opts.splitGapPx ?? 260;

  const toSvg = (p: Point): [number, number] => {
    let x = p.x;
    if (opts.splitAtX !== undefined && p.x >= opts.splitAtX) {
      x = p.x + gap / scale; // сдвигаем "вторую деталь" правее на gap px, чтобы не наезжала на первую
    }
    return [ox + x * scale, oy + p.y * scale];
  };

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);

  const styleStroke: Record<string, string> = { seg: "#5a6b62", aux: "#9db3a8", dart: "#8a5a2a" };
  const styleDash: Record<string, string> = { seg: "", aux: "2 3", dart: "" };

  for (const ln of lines) {
    const a = result.points[ln.from], b = result.points[ln.to];
    if (!a || !b) continue;
    const [ax, ay] = toSvg(a), [bx, by] = toSvg(b);
    const style = ln.style ?? "aux";
    const dash = styleDash[style] ? ` stroke-dasharray="${styleDash[style]}"` : "";
    parts.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${styleStroke[style]}" stroke-width="${style === "dart" ? 1.2 : 0.9}"${dash}/>`);
  }

  for (const [id, arc] of Object.entries(result.arcs)) {
    const [ax, ay] = toSvg(arc.from), [bx, by] = toSvg(arc.to);
    const r = arc.radius * scale;
    parts.push(`<path d="M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${arc.sweep} ${bx.toFixed(1)} ${by.toFixed(1)}" fill="none" stroke="#1f2d28" stroke-width="1.4"/>`);
  }

  for (const [id, p] of Object.entries(result.points)) {
    const [x, y] = toSvg(p);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#2f6f4f"/>`);
    if (showLabels) {
      parts.push(`<text x="${(x + 4).toFixed(1)}" y="${(y - 3).toFixed(1)}" font-size="8" font-family="monospace" fill="#3a4a41">${id}</text>`);
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
