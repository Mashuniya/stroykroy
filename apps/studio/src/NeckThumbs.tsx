import { useMemo } from "react";

type Pt = { x: number; y: number };
type Pc = { name: string; outline: { points: Pt[] } };

const SKIP = /обтачк|планк|карман|подзор|facing|pocket|placket|воротн|collar|рукав|sleeve/i;
function pick(pieces: Pc[] | null | undefined, which: "front" | "back"): Pc | undefined {
  const re = which === "front" ? /перед|front/i : /спинк|back/i;
  return pieces?.find((p) => re.test(p.name) && !SKIP.test(p.name));
}

/** Картинка горловины — обычный SVG-текст: верх переда (или спинки) в общем окне. Позже её можно разместить на изображении изделия. */
export function neckSvg(pieces: Pc[] | null | undefined, which: "front" | "back", win: { x0: number; x1: number; y0: number; y1: number }, size: number, selected: boolean): string {
  const pc = pick(pieces, which);
  const k = (size - 8) / Math.max(win.x1 - win.x0, win.y1 - win.y0);
  const col = selected ? "#1f6f43" : "#5a6b62";
  const d = pc ? pc.outline.points.map((p, i) => (i ? "L" : "M") + (4 + (p.x - win.x0) * k).toFixed(1) + " " + (4 + (p.y - win.y0) * k).toFixed(1)).join(" ") + "Z" : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><clipPath id="c"><rect width="${size}" height="${size}"/></clipPath><g clip-path="url(#c)">${d ? `<path d="${d}" fill="${selected ? "#e4f3ea" : "#f3f6f4"}" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>` : `<text x="6" y="${size / 2}" font-size="9" fill="#999">нет детали</text>`}</g></svg>`;
}

function windowOf(pieces: Pc[] | null | undefined, which: "front" | "back") {
  const pc = pick(pieces, which);
  if (!pc) return null;
  const xs = pc.outline.points.map((p) => p.x), ys = pc.outline.points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, x1, y0, y1: y0 + Math.max(10, (y1 - y0) * 0.42) };
}

export function NeckThumbs({ which, vals, current, labelOf, piecesFor, depKey, onPick }: {
  which: "front" | "back"; vals: number[]; current: number; labelOf: (v: number) => string;
  piecesFor: (v: number) => Pc[] | null; depKey: string; onPick: (v: number) => void;
}) {
  const items = useMemo(() => {
    const per = vals.map((v) => { try { return { v, pcs: piecesFor(v) }; } catch { return { v, pcs: null }; } });
    const base = per.find((x) => x.v === current)?.pcs ?? per.find((x) => x.pcs)?.pcs ?? null;
    const win = windowOf(base, which);
    return per.map((x) => ({ v: x.v, pcs: x.pcs, win }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, vals.join(","), which]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: 4, marginTop: 4 }}>
      {items.map(({ v, pcs, win }) => (
        <button key={v} data-opt-value={v} title={labelOf(v)} onClick={() => onPick(v)}
          style={{ padding: 2, cursor: "pointer", borderRadius: 4, border: "1px solid " + (v === current ? "#2f6f4f" : "#d5e0d9"), background: v === current ? "#dff0e5" : "#fff", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span dangerouslySetInnerHTML={{ __html: win ? neckSvg(pcs, which, win, 72, v === current) : "" }} />
          <span style={{ fontSize: 10.5 }}>{v}</span>
        </button>
      ))}
    </div>
  );
}
