import { useRef, useState } from "react";
import { sketchToDataUrl, dataUrlKb } from "./shopPhoto.js";
import type { Sketch, SketchPt, SketchVariant } from "./constructions.js";

type Pair = [SketchPt, SketchPt];

/** Преобразование (поворот + масштаб + сдвиг; при mirror — ещё и отражение), которое переводит две точки элемента в две точки основы. Результат — матрица SVG [a b c d e f]. */
export function similarity(e: Pair, b: Pair, mirror = false): number[] | null {
  const ex = e[1].x - e[0].x, ey = e[1].y - e[0].y, bx = b[1].x - b[0].x, by = b[1].y - b[0].y;
  const le = Math.hypot(ex, ey), lb = Math.hypot(bx, by);
  if (le < 1e-6 || lb < 1e-6) return null;
  const s = lb / le;
  if (mirror) {
    const th = Math.atan2(by, bx) + Math.atan2(ey, ex);
    const a = s * Math.cos(th), b2 = s * Math.sin(th);
    return [a, b2, b2, -a, b[0].x - (a * e[0].x + b2 * e[0].y), b[0].y - (b2 * e[0].x - a * e[0].y)];
  }
  const th = Math.atan2(by, bx) - Math.atan2(ey, ex);
  const a = s * Math.cos(th), b2 = s * Math.sin(th);
  return [a, b2, -b2, a, b[0].x - (a * e[0].x - b2 * e[0].y), b[0].y - (b2 * e[0].x + a * e[0].y)];
}
const pairAt = (pts: (SketchPt | null)[] | undefined, i: number): Pair | null => (pts && pts[i] && pts[i + 1] ? [pts[i]!, pts[i + 1]!] : null);

/** Элементы с двумя сторонами: рукав. Точки ставят на правой стороне основы, левая получается зеркально (относительно вертикали через середину рисунка основы). */
export const isSided = (kind: string) => kind === "sleeve";

/** Куда и как приклеить рисунок элемента: список {точки основы, отражать ли рисунок}. */
export function sideFits(kind: string, anchors: (SketchPt | null)[] | undefined, baseW: number): { to: Pair; mirror: boolean }[] {
  if (!anchors) return [];
  if (!isSided(kind)) { const p = pairAt(anchors, 0); return p ? [{ to: p, mirror: false }] : []; }
  if (anchors.length >= 4) { // старая запись: по две точки на каждую пройму
    return [pairAt(anchors, 0), pairAt(anchors, 2)].map((p, i) => p && { to: p, mirror: i === 1 }).filter(Boolean) as { to: Pair; mirror: boolean }[];
  }
  const r = pairAt(anchors, 0);
  if (!r) return [];
  const l: Pair = [{ x: baseW - r[0].x, y: r[0].y }, { x: baseW - r[1].x, y: r[1].y }];
  return [{ to: r, mirror: false }, { to: l, mirror: true }];
}

/** Рисунок элемента для значения опции: нет рисунка под это значение — берётся основной. */
export function resolveSketch(sk: Sketch, value?: string): { src: string; w: number; h: number; points?: (SketchPt | null)[]; behind?: boolean } {
  const v = value !== undefined ? sk.variants?.[value] : undefined;
  return v ? { ...v, behind: sk.behind } : sk;
}
const variantKeys = (sk: Sketch, optValues?: string[]): string[] => {
  if (optValues && optValues.length) return optValues;
  const typed = (sk.variantValues ?? "1,2,3,4,5,6").split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean);
  return typed;
};

export interface SketchCandidate { kind: string; id: string; name: string; sketch?: Sketch }
export interface OptionDef { name: string; title: string; values?: (number | [number, string])[] }

/** Подписи точек на рисунке ОСНОВЫ. */
const BASE_HINT: Record<string, string[]> = {
  sleeve: ["правая пройма: верх", "правая пройма: низ"],
  collar: ["левый край горловины", "правый край горловины"],
};
/** Подписи точек на рисунке ЭЛЕМЕНТА. */
const ELEMENT_HINT: Record<string, string[]> = {
  sleeve: ["верх проймы рукава (у плеча)", "низ проймы рукава (у подмышки)"],
  collar: ["левый край горловины", "правый край горловины"],
};
const baseNames = (kind: string): string[] => BASE_HINT[kind] ?? ["точка 1", "точка 2"];
const elementNames = (kind: string): string[] => ELEMENT_HINT[kind] ?? ["точка 1", "точка 2"];

interface ResolvedLayer { kind: string; sketch: { src: string; w: number; h: number; points?: (SketchPt | null)[]; behind?: boolean } }

/** Наложение элементов на основу — так рисунок соберётся на сайте. */
export function SketchCompose({ base, layers }: { base: Sketch; layers: ResolvedLayer[] }) {
  const items = layers.flatMap((l) => {
    const e = pairAt(l.sketch.points, 0);
    return sideFits(l.kind, base.anchors?.[l.kind], base.w).map((f) => ({ ...l, m: e ? similarity(e, f.to, f.mirror) : null }));
  }).filter((x) => x.m);
  const img = (l: { sketch: { src: string; w: number; h: number }; m: number[] | null }, k: string) =>
    <image key={k} href={l.sketch.src} width={l.sketch.w} height={l.sketch.h} transform={`matrix(${l.m!.join(" ")})`} />;
  // рамка включает всё, что выступает за основу (рукава уходят наружу)
  let x0 = 0, y0 = 0, x1 = base.w, y1 = base.h;
  for (const it of items) {
    const m = it.m!;
    for (const [cx, cy] of [[0, 0], [it.sketch.w, 0], [0, it.sketch.h], [it.sketch.w, it.sketch.h]]) {
      const X = m[0] * cx + m[2] * cy + m[4], Y = m[1] * cx + m[3] * cy + m[5];
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
  }
  const pad = 0.02 * Math.max(x1 - x0, y1 - y0);
  return (
    <svg viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`} style={{ width: "100%", background: "#fff", border: "1px solid #c7d6cd", borderRadius: 4 }}>
      {items.filter((x) => x.sketch.behind).map((x, i) => img(x, "b" + i))}
      <image href={base.src} width={base.w} height={base.h} />
      {items.filter((x) => !x.sketch.behind).map((x, i) => img(x, "f" + i))}
    </svg>
  );
}

/** Рисунок с точками: щёлкнуть — поставить выбранную точку, перетащить — сдвинуть, стрелки — на 1 пиксель (Shift — на 5), кнопки ×1…×4 — увеличить. */
function PointEditor({ src, w, h, items, onSet }: {
  src: string; w: number; h: number;
  items: { key: string; label: string; pt: SketchPt | null }[];
  onSet: (key: string, pt: SketchPt) => void;
}) {
  const [active, setActive] = useState(items[0]?.key ?? "");
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<string | null>(null);
  const moved = useRef(false);
  const cur = items.some((i) => i.key === active) ? active : items[0]?.key ?? "";
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * w), y: Math.round(((e.clientY - r.top) / r.height) * h) };
  };
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {items.map((p) => (
          <button key={p.key} data-sketch-point={p.key} onClick={() => setActive(p.key)}
            style={{ fontSize: 11, padding: "2px 6px", border: "1px solid " + (cur === p.key ? "#0b7a62" : "#c7d6cd"), background: cur === p.key ? "#e3f3ee" : "#fff", borderRadius: 4 }}>
            {p.pt ? "✓ " : ""}{p.label}
          </button>
        ))}
      </div>
      <div style={{ color: "#5a6b62" }}>
        Выберите точку кнопкой и щёлкните по рисунку; точку можно перетащить, стрелками сдвигать на 1 пиксель (Shift — на 5). Увеличить:{" "}
        {[1, 2, 3, 4].map((z) => <button key={z} style={{ fontSize: 10, marginRight: 2, fontWeight: zoom === z ? "bold" : "normal" }} onClick={() => setZoom(z)}>×{z}</button>)}
      </div>
      <div tabIndex={0} style={{ maxWidth: 520, maxHeight: 560, overflow: "auto", border: "1px solid #c7d6cd", outline: "none" }}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 5 : 1;
          const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
          const pt = items.find((q) => q.key === cur)?.pt;
          if ((dx || dy) && pt) { e.preventDefault(); onSet(cur, { x: pt.x + dx, y: pt.y + dy }); }
        }}>
        <div style={{ position: "relative", width: `${zoom * 100}%`, cursor: "crosshair", backgroundImage: "linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}
          onMouseMove={(e) => { if (drag) { moved.current = true; onSet(drag, at(e)); } }}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
          onClick={(e) => { if (moved.current) { moved.current = false; return; } if (cur) onSet(cur, at(e)); }}>
          <img src={src} alt="" draggable={false} style={{ width: "100%", display: "block" }} />
          {items.map((p, i) => p.pt && (
            <div key={p.key} title={p.label}
              onMouseDown={(e) => { e.stopPropagation(); setActive(p.key); setDrag(p.key); moved.current = false; }}
              style={{ position: "absolute", left: `${(p.pt.x / w) * 100}%`, top: `${(p.pt.y / h) * 100}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, background: cur === p.key ? "#e0301e" : "#0b7a62", color: "#fff", fontSize: 9, textAlign: "center", lineHeight: "14px", cursor: "grab", opacity: 0.85 }}>{(i % 2) + 1}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

const btn = { fontSize: 12, padding: "3px 8px", border: "1px solid #c7d6cd", borderRadius: 4, background: "#f4f7f5", cursor: "pointer" } as const;

/**
 * Панель «Рисунок для сайта». Основа: загрузить рисунок, для каждого вида элементов поставить две точки (для рукава — на правой пройме, левая получится зеркально), проверить наложение.
 * Элемент: загрузить рисунок и поставить две соответствующие точки; если от значения опции (длина рукава) рисунок меняется — загрузить рисунок на каждое значение.
 */
export default function SketchPanel(props: {
  isBase: boolean;
  sketch?: Sketch;
  onChange: (s: Sketch | undefined) => void;
  roles: { kind: string; title: string }[];     // для основы: какие виды элементов есть
  elementKind?: string;                         // для элемента: его вид
  candidates: SketchCandidate[];                // для основы: элементы, которые можно проверить
  options?: OptionDef[];                        // для элемента: его опции (из построения)
  notify: (msg: string) => void;
}) {
  const { isBase, sketch: full, onChange: onChangeFull, roles, elementKind, candidates: candidatesFull, options = [], notify } = props;
  const [view, setView] = useState<"front" | "back">("front");
  // всё ниже работает с одним видом: «спереди» — сам рисунок, «сзади» — вложенный full.back
  const sketch: Sketch | undefined = view === "front" ? full : full?.back;
  const onChange = (s: Sketch | undefined) => {
    if (view === "front") onChangeFull(s ? { ...s, back: full?.back } : undefined);
    else onChangeFull(full ? { ...full, back: s } : undefined);
  };
  const candidates: SketchCandidate[] = candidatesFull.map((c) => ({ ...c, sketch: c.sketch ? (view === "front" ? c.sketch : c.sketch.back) : undefined }));
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [previewVal, setPreviewVal] = useState<Record<string, string>>({});

  async function upload(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      const r = await sketchToDataUrl(f);
      onChange({ ...(sketch ?? {}), ...r, anchors: sketch?.anchors, points: sketch?.points });
    } catch (e) { notify(`Рисунок «${f.name}»: ${(e as Error).message}`); }
  }
  async function uploadVariant(key: string, files: FileList | null) {
    const f = files?.[0];
    if (!f || !sketch) return;
    try {
      const r = await sketchToDataUrl(f);
      const prev = sketch.variants?.[key];
      onChange({ ...sketch, variants: { ...(sketch.variants ?? {}), [key]: { ...r, points: prev?.points } } });
    } catch (e) { notify(`Рисунок «${f.name}»: ${(e as Error).message}`); }
  }
  const setVariantPoint = (key: string, idx: number, pt: SketchPt) => {
    if (!sketch) return;
    const v = sketch.variants?.[key];
    if (!v) return;
    const pts: (SketchPt | null)[] = [v.points?.[0] ?? null, v.points?.[1] ?? null]; pts[idx] = pt;
    onChange({ ...sketch, variants: { ...(sketch.variants ?? {}), [key]: { ...v, points: pts } } });
  };

  const baseItems = roles.flatMap((r) => baseNames(r.kind).map((n, i) => ({ key: `${r.kind}:${i}`, label: `${r.title}: ${n}`, pt: sketch?.anchors?.[r.kind]?.[i] ?? null })));
  const setBasePoint = (key: string, pt: SketchPt) => {
    if (!sketch) return;
    const [k, i] = key.split(":");
    const anchors = { ...(sketch.anchors ?? {}) };
    const n = baseNames(k).length;
    // старая запись из четырёх точек для рукава заменяется двумя (правая сторона)
    const old = anchors[k] && anchors[k]!.length === n ? anchors[k]! : [];
    const pts: (SketchPt | null)[] = Array.from({ length: n }, (_, j) => old[j] ?? null); pts[Number(i)] = pt;
    anchors[k] = pts;
    onChange({ ...sketch, anchors });
  };
  const elItems = elementNames(elementKind ?? "").map((n, i) => ({ key: `el:${i}`, label: n, pt: sketch?.points?.[i] ?? null }));
  const setElPoint = (key: string, pt: SketchPt) => {
    if (!sketch) return;
    const idx = Number(key.split(":")[1]);
    const pts = [sketch.points?.[0] ?? null, sketch.points?.[1] ?? null]; pts[idx] = pt;
    onChange({ ...sketch, points: pts });
  };

  const layers: ResolvedLayer[] = candidates.filter((c) => previewIds.includes(c.kind + ":" + c.id) && c.sketch)
    .map((c) => ({ kind: c.kind, sketch: resolveSketch(c.sketch!, previewVal[c.kind + ":" + c.id] ?? (c.sketch!.variants ? variantKeys(c.sketch!)[0] : undefined)) }));
  const withSketch = candidates.filter((c) => c.sketch);
  const opt = options.find((o) => o.name === sketch?.variantOption);
  const optValues = opt?.values?.map((v) => String(Array.isArray(v) ? v[0] : v));
  const keys = sketch && sketch.variantOption ? variantKeys(sketch, optValues) : [];

  return (
    <details data-panel="sketch" open={!!sketch} style={{ marginBottom: 8, border: "1px solid #c7d6cd", borderRadius: 4, padding: "4px 8px", background: "#f9fbfa" }}>
      <summary style={{ fontSize: 12, cursor: "pointer", fontWeight: "bold" }}>Технический рисунок для сайта{sketch ? "" : " (нет)"}</summary>
      <div style={{ fontSize: 11.5, marginTop: 6, display: "grid", gap: 6 }}>
        {full && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {(["front", "back"] as const).map((v) => (
              <button key={v} data-sketch-view={v} onClick={() => setView(v)}
                style={{ fontSize: 12, padding: "2px 10px", border: "1px solid " + (view === v ? "#0b7a62" : "#c7d6cd"), background: view === v ? "#e3f3ee" : "#fff", borderRadius: 4, fontWeight: view === v ? "bold" : "normal" }}>
                {v === "front" ? "Спереди" : "Сзади"}{v === "back" && full.back ? " ✓" : ""}
              </button>
            ))}
            {view === "back" && <span style={{ color: "#5a6b62" }}>— отдельный рисунок со своими точками; можно не загружать</span>}
          </div>
        )}
        <div style={{ color: "#5a6b62" }}>
          {isBase
            ? "PNG с прозрачным фоном. Для каждого вида элементов поставьте точки, куда элемент «приклеится». Рукав: две точки на ПРАВОЙ пройме (верх и низ) — левая получится зеркально, относительно вертикали через середину рисунка."
            : "PNG с прозрачным фоном. Поставьте две точки, которые совпадут с точками на рисунке основы (в том же порядке). Рукав загружайте ПРАВЫЙ (уходит вправо-вниз), левый получится зеркально."}
        </div>
        <label style={{ display: "inline-block" }}>
          <span style={btn}>{sketch ? "Заменить рисунок" : "＋ Загрузить рисунок"}</span>
          <input data-sketch="input" type="file" accept="image/png" style={{ display: "none" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        </label>
        {sketch && (
          <>
            <div style={{ color: "#5a6b62" }}>{sketch.w}×{sketch.h}, {dataUrlKb(sketch.src)} КБ. <button style={{ fontSize: 10 }} onClick={() => onChange(undefined)}>убрать рисунок</button></div>
            {isBase
              ? <PointEditor src={sketch.src} w={sketch.w} h={sketch.h} items={baseItems} onSet={setBasePoint} />
              : <PointEditor src={sketch.src} w={sketch.w} h={sketch.h} items={elItems} onSet={setElPoint} />}
            {!isBase && (
              <label><input type="checkbox" checked={!!sketch.behind} onChange={(e) => onChange({ ...sketch, behind: e.target.checked })} /> рисовать под основой (например, капюшон сзади)</label>
            )}
            {!isBase && options.length > 0 && (
              <div style={{ borderTop: "1px solid #dfe8e2", paddingTop: 6, display: "grid", gap: 6 }}>
                <label>Рисунок зависит от опции:{" "}
                  <select value={sketch.variantOption ?? ""} onChange={(e) => onChange({ ...sketch, variantOption: e.target.value || undefined })}>
                    <option value="">— не зависит —</option>
                    {options.map((o) => <option key={o.name} value={o.name}>{o.title} ({o.name})</option>)}
                  </select>
                </label>
                {sketch.variantOption && (
                  <>
                    <div style={{ color: "#5a6b62" }}>
                      Загрузите рисунок для каждого значения (рисунок выше — запасной, для значений без своего). На сайте покупатель выберет значение по этим же рисункам, только маленьким.
                    </div>
                    {!optValues && (
                      <label>Значения через запятую:{" "}
                        <input value={sketch.variantValues ?? "1,2,3,4,5,6"} style={{ width: 120 }} onChange={(e) => onChange({ ...sketch, variantValues: e.target.value })} />
                      </label>
                    )}
                    {keys.map((k) => {
                      const v: SketchVariant | undefined = sketch.variants?.[k];
                      return (
                        <details key={k} data-variant={k} open={false} style={{ border: "1px solid #dfe8e2", borderRadius: 4, padding: "2px 6px" }}>
                          <summary style={{ cursor: "pointer" }}>{v ? "✓ " : ""}значение {k}{v && !(v.points?.[0] && v.points?.[1]) ? " — поставьте две точки" : ""}</summary>
                          <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                            <label style={{ display: "inline-block" }}>
                              <span style={btn}>{v ? "Заменить рисунок" : "＋ Загрузить рисунок"}</span>
                              <input type="file" accept="image/png" style={{ display: "none" }} onChange={(e) => { void uploadVariant(k, e.target.files); e.target.value = ""; }} />
                            </label>
                            {v && (
                              <>
                                <div style={{ color: "#5a6b62" }}>{v.w}×{v.h}, {dataUrlKb(v.src)} КБ. <button style={{ fontSize: 10 }} onClick={() => { const vs = { ...(sketch.variants ?? {}) }; delete vs[k]; onChange({ ...sketch, variants: vs }); }}>убрать</button></div>
                                <PointEditor src={v.src} w={v.w} h={v.h}
                                  items={elementNames(elementKind ?? "").map((n, i) => ({ key: `v${k}:${i}`, label: n, pt: v.points?.[i] ?? null }))}
                                  onSet={(key, pt) => setVariantPoint(k, Number(key.split(":")[1]), pt)} />
                              </>
                            )}
                          </div>
                        </details>
                      );
                    })}
                  </>
                )}
              </div>
            )}
            {isBase && withSketch.length > 0 && (
              <div>
                <div style={{ color: "#5a6b62" }}>Проверка: какие элементы наложить</div>
                {withSketch.map((c) => {
                  const id = c.kind + ":" + c.id;
                  const ks = c.sketch!.variants ? variantKeys(c.sketch!) : [];
                  return (
                    <label key={id} style={{ display: "block" }}>
                      <input type="checkbox" checked={previewIds.includes(id)}
                        onChange={(e) => setPreviewIds((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))} /> {c.name}
                      {ks.length > 0 && (
                        <select style={{ marginLeft: 6 }} value={previewVal[id] ?? ks[0]} onChange={(e) => setPreviewVal((p) => ({ ...p, [id]: e.target.value }))}>
                          {ks.map((k) => <option key={k} value={k}>значение {k}</option>)}
                        </select>
                      )}
                    </label>
                  );
                })}
                <div style={{ maxWidth: 360, marginTop: 4 }}><SketchCompose base={sketch} layers={layers} /></div>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
