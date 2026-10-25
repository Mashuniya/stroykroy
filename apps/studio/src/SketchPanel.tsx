import { useState } from "react";
import { sketchToDataUrl, dataUrlKb } from "./shopPhoto.js";
import type { Sketch, SketchPt } from "./constructions.js";

type Pair = [SketchPt, SketchPt];

/** Преобразование (поворот + масштаб + сдвиг), которое переводит две точки элемента в две точки основы. Результат — матрица SVG [a b c d e f]. */
export function similarity(e: Pair, b: Pair, mirror = false): number[] | null {
  const ex = e[1].x - e[0].x, ey = e[1].y - e[0].y, bx = b[1].x - b[0].x, by = b[1].y - b[0].y;
  const le = Math.hypot(ex, ey), lb = Math.hypot(bx, by);
  if (le < 1e-6 || lb < 1e-6) return null;
  const s = lb / le;
  if (mirror) {
    // зеркальное отражение (правый рукав = отражённый левый): угол отражённого вектора = th − угол исходного
    const th = Math.atan2(by, bx) + Math.atan2(ey, ex);
    const a = s * Math.cos(th), b2 = s * Math.sin(th);
    return [a, b2, b2, -a, b[0].x - (a * e[0].x + b2 * e[0].y), b[0].y - (b2 * e[0].x - a * e[0].y)];
  }
  const th = Math.atan2(by, bx) - Math.atan2(ey, ex);
  const a = s * Math.cos(th), b2 = s * Math.sin(th);
  return [a, b2, -b2, a, b[0].x - (a * e[0].x - b2 * e[0].y), b[0].y - (b2 * e[0].x + a * e[0].y)];
}
const pairAt = (pts: (SketchPt | null)[] | undefined, i: number): Pair | null => (pts && pts[i] && pts[i + 1] ? [pts[i]!, pts[i + 1]!] : null);

/** Сколько сторон у элемента: рукав — две (левая проймы и правая — отражённая), остальное — одна. */
const isSided = (kind: string) => kind === "sleeve";

export interface SketchCandidate { kind: string; id: string; name: string; sketch?: Sketch }

/** Подписи точек на рисунке ОСНОВЫ (для рукава — по две точки на каждую пройму). */
const BASE_HINT: Record<string, string[]> = {
  sleeve: ["левая пройма: верх", "левая пройма: низ", "правая пройма: верх", "правая пройма: низ"],
  collar: ["левый край горловины", "правый край горловины"],
};
/** Подписи точек на рисунке ЭЛЕМЕНТА. */
const ELEMENT_HINT: Record<string, string[]> = {
  sleeve: ["верх проймы рукава (у плеча)", "низ проймы рукава (у подмышки)"],
  collar: ["левый край горловины", "правый край горловины"],
};
const baseNames = (kind: string): string[] => BASE_HINT[kind] ?? ["точка 1", "точка 2"];
const elementNames = (kind: string): string[] => ELEMENT_HINT[kind] ?? ["точка 1", "точка 2"];

/** Наложение элементов на основу — так рисунок соберётся на сайте. */
export function SketchCompose({ base, layers }: { base: Sketch; layers: { kind: string; sketch: Sketch }[] }) {
  const items = layers.flatMap((l) => {
    const e = pairAt(l.sketch.points, 0);
    const a = base.anchors?.[l.kind];
    const dl = !!l.sketch.drawnLeft; // рисунок рукава по умолчанию — правый (рукав уходит вправо-вниз), на левую пройму он ставится зеркально
    const sides: [number, boolean][] = isSided(l.kind) && a && a.length >= 4 ? [[0, !dl], [2, dl]] : [[0, false]];
    return sides.map(([i, mirror]) => {
      const b = pairAt(a, i);
      return { ...l, m: e && b ? similarity(e, b, mirror) : null };
    });
  }).filter((x) => x.m);
  const img = (l: { sketch: Sketch; m: number[] | null }, k: string) =>
    <image key={k} href={l.sketch.src} width={l.sketch.w} height={l.sketch.h} transform={`matrix(${l.m!.join(" ")})`} />;
  return (
    <svg viewBox={`0 0 ${base.w} ${base.h}`} style={{ width: "100%", background: "#fff", border: "1px solid #c7d6cd", borderRadius: 4 }}>
      {items.filter((x) => x.sketch.behind).map((x, i) => img(x, "b" + i))}
      <image href={base.src} width={base.w} height={base.h} />
      {items.filter((x) => !x.sketch.behind).map((x, i) => img(x, "f" + i))}
    </svg>
  );
}

/**
 * Панель «Рисунок для сайта». Основа: загрузить рисунок, поставить по две точки для каждого вида элементов, проверить наложение.
 * Элемент: загрузить рисунок и поставить две соответствующие точки.
 */
export default function SketchPanel(props: {
  isBase: boolean;
  sketch?: Sketch;
  onChange: (s: Sketch | undefined) => void;
  roles: { kind: string; title: string }[];     // для основы: какие виды элементов есть
  elementKind?: string;                         // для элемента: его вид
  candidates: SketchCandidate[];                // для основы: элементы, которые можно проверить
  notify: (msg: string) => void;
}) {
  const { isBase, sketch, onChange, roles, elementKind, candidates, notify } = props;
  const [active, setActive] = useState<string>(isBase ? `${roles[0]?.kind ?? "sleeve"}:0` : "el:0");
  const [previewIds, setPreviewIds] = useState<string[]>([]);

  async function upload(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      const r = await sketchToDataUrl(f);
      onChange({ ...(sketch ?? {}), ...r, anchors: sketch?.anchors, points: sketch?.points });
    } catch (e) { notify(`Рисунок «${f.name}»: ${(e as Error).message}`); }
  }
  function setPoint(x: number, y: number) {
    if (!sketch) return;
    const [k, i] = active.split(":");
    const idx = Number(i);
    if (k === "el") {
      const pts = [...(sketch.points ?? [null, null])]; pts[idx] = { x, y };
      onChange({ ...sketch, points: pts });
    } else {
      const anchors = { ...(sketch.anchors ?? {}) };
      const n = isSided(k) ? 4 : 2;
      const pts: (SketchPt | null)[] = Array.from({ length: n }, (_, j) => anchors[k]?.[j] ?? null); pts[idx] = { x, y };
      anchors[k] = pts;
      onChange({ ...sketch, anchors });
    }
  }
  const points: { key: string; pt: SketchPt | null; label: string }[] = isBase
    ? roles.flatMap((r) => baseNames(r.kind).map((n, i) => ({ key: `${r.kind}:${i}`, pt: sketch?.anchors?.[r.kind]?.[i] ?? null, label: `${r.title}: ${n}` })))
    : elementNames(elementKind ?? "").map((n, i) => ({ key: `el:${i}`, pt: sketch?.points?.[i] ?? null, label: n }));
  const layers = candidates.filter((c) => previewIds.includes(c.kind + ":" + c.id) && c.sketch).map((c) => ({ kind: c.kind, sketch: c.sketch! }));
  const withSketch = candidates.filter((c) => c.sketch);

  return (
    <details data-panel="sketch" open={!!sketch} style={{ marginBottom: 8, border: "1px solid #c7d6cd", borderRadius: 4, padding: "4px 8px", background: "#f9fbfa" }}>
      <summary style={{ fontSize: 12, cursor: "pointer", fontWeight: "bold" }}>Технический рисунок для сайта{sketch ? "" : " (нет)"}</summary>
      <div style={{ fontSize: 11.5, marginTop: 6, display: "grid", gap: 6 }}>
        <div style={{ color: "#5a6b62" }}>
          {isBase
            ? "PNG с прозрачным фоном. Для каждого вида элементов поставьте точки, куда элемент «приклеится». Рукав: верх и низ левой проймы, затем верх и низ правой — рукав подстроится под пройму, а справа встанет зеркально."
            : "PNG с прозрачным фоном. Поставьте две точки, которые совпадут с точками на рисунке основы (в том же порядке: сначала верх, потом низ проймы; у воротника — левая и правая)."}
        </div>
        <label style={{ display: "inline-block" }}>
          <span style={{ fontSize: 12, padding: "3px 8px", border: "1px solid #c7d6cd", borderRadius: 4, background: "#f4f7f5", cursor: "pointer" }}>{sketch ? "Заменить рисунок" : "＋ Загрузить рисунок"}</span>
          <input data-sketch="input" type="file" accept="image/png" style={{ display: "none" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        </label>
        {sketch && (
          <>
            <div style={{ color: "#5a6b62" }}>{sketch.w}×{sketch.h}, {dataUrlKb(sketch.src)} КБ. <button style={{ fontSize: 10 }} onClick={() => onChange(undefined)}>убрать рисунок</button></div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {points.map((p, i) => (
                <button key={p.key} data-sketch-point={p.key} onClick={() => setActive(p.key)}
                  style={{ fontSize: 11, padding: "2px 6px", border: "1px solid " + (active === p.key ? "#0b7a62" : "#c7d6cd"), background: active === p.key ? "#e3f3ee" : "#fff", borderRadius: 4 }}>
                  {p.pt ? "✓ " : ""}{p.label}
                </button>
              ))}
            </div>
            <div style={{ color: "#5a6b62" }}>Выберите точку кнопкой выше и щёлкните по рисунку.</div>
            <div style={{ position: "relative", width: "100%", maxWidth: 360, cursor: "crosshair", backgroundImage: "linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}
              onClick={(e) => {
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                setPoint(Math.round(((e.clientX - r.left) / r.width) * sketch.w), Math.round(((e.clientY - r.top) / r.height) * sketch.h));
              }}>
              <img src={sketch.src} alt="" draggable={false} style={{ width: "100%", display: "block" }} />
              {points.map((p, i) => p.pt && (
                <div key={p.key} title={p.label} style={{ position: "absolute", left: `${(p.pt.x / sketch.w) * 100}%`, top: `${(p.pt.y / sketch.h) * 100}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, background: active === p.key ? "#e0301e" : "#0b7a62", color: "#fff", fontSize: 9, textAlign: "center", lineHeight: "14px", pointerEvents: "none" }}>{(i % 2) + 1}</div>
              ))}
            </div>
            {!isBase && elementKind === "sleeve" && (
              <label style={{ display: "block" }}><input type="checkbox" checked={!!sketch.drawnLeft} onChange={(e) => onChange({ ...sketch, drawnLeft: e.target.checked })} /> рукав нарисован для левой стороны рисунка (по умолчанию — для правой)</label>
            )}
            {!isBase && (
              <label><input type="checkbox" checked={!!sketch.behind} onChange={(e) => onChange({ ...sketch, behind: e.target.checked })} /> рисовать под основой (например, капюшон сзади)</label>
            )}
            {isBase && withSketch.length > 0 && (
              <div>
                <div style={{ color: "#5a6b62" }}>Проверка: какие элементы наложить</div>
                {withSketch.map((c) => (
                  <label key={c.kind + c.id} style={{ display: "block" }}>
                    <input type="checkbox" checked={previewIds.includes(c.kind + ":" + c.id)}
                      onChange={(e) => setPreviewIds((prev) => (e.target.checked ? [...prev, c.kind + ":" + c.id] : prev.filter((x) => x !== c.kind + ":" + c.id)))} /> {c.name}
                  </label>
                ))}
                <div style={{ maxWidth: 360, marginTop: 4 }}><SketchCompose base={sketch} layers={layers} /></div>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
