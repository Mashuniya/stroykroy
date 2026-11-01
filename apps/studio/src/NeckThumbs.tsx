import { useMemo } from "react";

type Pt = { x: number; y: number };
type Pc = { name: string; outline: { points: Pt[] } };
export type ThumbKind = "front" | "back" | "hem";
type Win = { x0: number; x1: number; y0: number; y1: number };

const SKIP = /обтачк|планк|карман|подзор|facing|pocket|placket|воротн|collar|рукав|sleeve|пояс|waistband|манжет|cuff/i;
const RE = { front: /перед|front/i, back: /спинк|back/i };
function pick(pieces: Pc[] | null | undefined, which: "front" | "back"): Pc | undefined {
  return pieces?.find((p) => RE[which].test(p.name) && !SKIP.test(p.name));
}

/** Окно показа детали: «горловина» — верх, «низ» — нижняя часть. Одно на все варианты, чтобы формы были сравнимы по масштабу. */
function windowOf(pc: Pc | undefined, part: "top" | "bottom"): Win | null {
  if (!pc) return null;
  const xs = pc.outline.points.map((p) => p.x), ys = pc.outline.points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const d = Math.max(10, (y1 - y0) * (part === "top" ? 0.42 : 0.3));
  return part === "top" ? { x0, x1, y0, y1: y0 + d } : { x0, x1, y0: y1 - d, y1 };
}

function pathOf(pc: Pc | undefined, w: Win, k: number, ox: number): string {
  if (!pc) return "";
  return pc.outline.points.map((p, i) => (i ? "L" : "M") + (ox + 4 + (p.x - w.x0) * k).toFixed(1) + " " + (4 + (p.y - w.y0) * k).toFixed(1)).join(" ") + "Z";
}

/** Картинка варианта — обычный SVG-текст (верх переда/спинки или низ переда и спинки рядом). Позже её можно разместить на изображении изделия. */
export function shapeSvg(pieces: Pc[] | null | undefined, kind: ThumbKind, wins: { f: Win | null; b: Win | null }, size: number, selected: boolean): string {
  const col = selected ? "#1f6f43" : "#5a6b62", fill = selected ? "#e4f3ea" : "#f3f6f4";
  const one = (pc: Pc | undefined, w: Win | null, k: number, ox: number) => (w && pc ? `<path d="${pathOf(pc, w, k, ox)}" fill="${fill}" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>` : "");
  if (kind === "hem") {
    const wf = wins.f, wb = wins.b;
    const k = (size - 8) / Math.max(wf ? wf.x1 - wf.x0 : 1, wb ? wb.x1 - wb.x0 : 1, wf ? wf.y1 - wf.y0 : 1, wb ? wb.y1 - wb.y0 : 1);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 2}" height="${size}" viewBox="0 0 ${size * 2} ${size}"><clipPath id="a"><rect width="${size}" height="${size}"/></clipPath><clipPath id="b"><rect x="${size}" width="${size}" height="${size}"/></clipPath><g clip-path="url(#a)">${one(pick(pieces, "front"), wf, k, 0)}</g><g clip-path="url(#b)">${one(pick(pieces, "back"), wb, k, size)}</g><text x="4" y="${size - 3}" font-size="8" fill="#888">перед</text><text x="${size + 4}" y="${size - 3}" font-size="8" fill="#888">спинка</text></svg>`;
  }
  const w = wins.f, pc = pick(pieces, kind);
  if (!w) return "";
  const k = (size - 8) / Math.max(w.x1 - w.x0, w.y1 - w.y0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><clipPath id="c"><rect width="${size}" height="${size}"/></clipPath><g clip-path="url(#c)">${pc ? one(pc, w, k, 0) : `<text x="6" y="${size / 2}" font-size="9" fill="#999">нет детали</text>`}</g></svg>`;
}

export function NeckThumbs({ which, vals, current, labelOf, piecesFor, depKey, onPick }: {
  which: ThumbKind; vals: number[]; current: number; labelOf: (v: number) => string;
  piecesFor: (v: number) => Pc[] | null; depKey: string; onPick: (v: number) => void;
}) {
  const items = useMemo(() => {
    const per = vals.map((v) => { try { return { v, pcs: piecesFor(v) }; } catch { return { v, pcs: null }; } });
    const base = per.find((x) => x.v === current)?.pcs ?? per.find((x) => x.pcs)?.pcs ?? null;
    const part = which === "hem" ? "bottom" : "top";
    const wins = { f: windowOf(pick(base, which === "back" ? "back" : "front"), part), b: windowOf(pick(base, "back"), part) };
    if (part === "bottom") { // окно доходит до самого длинного варианта, чтобы хвосты и шлейфы не обрезались
      for (const key of ["f", "b"] as const) {
        const w = wins[key]; if (!w) continue;
        const lowest = Math.max(w.y1, ...per.map((x) => { const pc = pick(x.pcs, key === "f" ? "front" : "back"); return pc ? Math.max(...pc.outline.points.map((p) => p.y)) : w.y1; }));
        wins[key] = { ...w, y0: w.y0 + (lowest - w.y1), y1: lowest };
      }
    }
    return per.map((x) => ({ v: x.v, pcs: x.pcs, wins }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, vals.join(","), which]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${which === "hem" ? 150 : 76}px, 1fr))`, gap: 4, marginTop: 4 }}>
      {items.map(({ v, pcs, wins }) => (
        <button key={v} data-opt-value={v} title={labelOf(v)} onClick={() => onPick(v)}
          style={{ padding: 2, cursor: "pointer", borderRadius: 4, border: "1px solid " + (v === current ? "#2f6f4f" : "#d5e0d9"), background: v === current ? "#dff0e5" : "#fff", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span dangerouslySetInnerHTML={{ __html: shapeSvg(pcs, which, wins, 72, v === current) }} />
          <span style={{ fontSize: 10.5, textAlign: "center" }}>{which === "hem" ? labelOf(v) : v}</span>
        </button>
      ))}
    </div>
  );
}
