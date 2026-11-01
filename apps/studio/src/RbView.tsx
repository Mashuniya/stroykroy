import { useEffect, useRef, useState } from "react";

/** Участок объединённого текста .rb: строки start … start+count-1 — это строки файла file, начиная с fileLine. */
interface Segment { file: string; start: number; fileLine: number; count: number }

const mono = { fontFamily: "monospace", fontSize: 12.5, lineHeight: "19px" } as const;

/** Число под курсором → число ± шаг (Ctrl+↑/↓: 1, с Shift: 0,1, с Alt: 0,01). Нет числа — null. */
function nudge(text: string, caret: number, delta: number): { text: string; start: number; end: number } | null {
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (caret >= m.index && caret <= m.index + m[0].length) {
      const dec = (m[0].split(".")[1] ?? "").length;
      const d = Math.max(dec, Math.abs(delta) < 1 ? String(Math.abs(delta)).split(".")[1].length : 0);
      const v = (Number(m[0]) + delta).toFixed(d);
      return { text: text.slice(0, m.index) + v + text.slice(m.index + m[0].length), start: m.index, end: m.index + v.length };
    }
  }
  return null;
}

/**
 * Файл Ruby как есть, но подключённые части (require "parts/…") свёрнуты в строки: клик по части — раскрывается её текст.
 * Текст можно править прямо здесь: чертёж перестраивается сразу, в файл ничего не пишется (в VS Code правите, когда убедились).
 * Ctrl+↑/↓ на числе — подбор значения (шаг 1; Shift — 0,1; Alt — 0,01).
 */
export function RbView({ source, segments, onEdit, openLine }: {
  source: string; segments: Segment[];
  onEdit: (newSource: string, newSegments: Segment[]) => string | null; // вернуть текст ошибки, если не разобралось
  openLine?: (file: string, line: number) => void;
}) {
  const lines = source.split("\n");
  const main = segments[0]?.file ?? "";
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const timer = useRef<number | null>(null);
  const pendingSel = useRef<{ k: number; start: number; end: number } | null>(null);
  const areaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const segText = (k: number) => lines.slice(segments[k].start - 1, segments[k].start - 1 + segments[k].count).join("\n");

  // файл перечитан из VS Code — наши черновики и пометка «правили» больше не актуальны
  const lastSource = useRef(source);
  const ownChange = useRef(false);
  useEffect(() => {
    if (lastSource.current !== source && !ownChange.current) { setDrafts({}); setErr(null); setEdited(false); }
    lastSource.current = source; ownChange.current = false;
  }, [source]);
  useEffect(() => { const p = pendingSel.current; if (p) { pendingSel.current = null; const el = areaRefs.current[p.k]; if (el) { el.focus(); el.setSelectionRange(p.start, p.end); } } });

  function apply(k: number, text: string) {
    const seg = segments[k];
    const newLines = text.split("\n");
    const delta = newLines.length - seg.count;
    const src = [...lines.slice(0, seg.start - 1), ...newLines, ...lines.slice(seg.start - 1 + seg.count)].join("\n");
    const segs = segments.map((s, i) => {
      if (i === k) return { ...s, count: newLines.length };
      const shifted = i > k ? { ...s, start: s.start + delta } : { ...s };
      if (s.file === seg.file && s.fileLine > seg.fileLine) shifted.fileLine = s.fileLine + delta;
      return shifted;
    });
    ownChange.current = true;
    const e = onEdit(src, segs);
    if (e) { ownChange.current = false; setErr(e); return; }
    setErr(null); setEdited(true);
    setDrafts((d) => { const n = { ...d }; delete n[k]; return n; });
  }
  function change(k: number, text: string) {
    setDrafts((d) => ({ ...d, [k]: text }));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply(k, text), 250);
  }

  const editor = (k: number) => {
    const s = segments[k];
    const text = drafts[k] ?? segText(k);
    const n = text.split("\n").length;
    return (
      <div style={{ display: "flex", background: "#fff" }}>
        <div style={{ ...mono, width: 42, flexShrink: 0, textAlign: "right", paddingRight: 8, color: "#9aa9a0", userSelect: "none", paddingTop: 2 }}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} onClick={() => openLine?.(s.file, s.fileLine + i)} title="Открыть эту строку в VS Code" style={{ cursor: openLine ? "pointer" : "default" }}>{s.fileLine + i}</div>
          ))}
        </div>
        <textarea
          ref={(el) => { areaRefs.current[k] = el; }}
          value={text} rows={n} wrap="off" spellCheck={false}
          onChange={(e) => change(k, e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              const el = e.currentTarget;
              const step = e.shiftKey ? 0.1 : e.altKey ? 0.01 : 1;
              const r = nudge(el.value, el.selectionStart, e.key === "ArrowUp" ? step : -step);
              if (r) { e.preventDefault(); pendingSel.current = { k, start: r.start, end: r.end }; change(k, r.text); }
            }
          }}
          style={{ ...mono, flex: 1, border: 0, outline: "none", resize: "none", padding: "2px 0", overflowX: "auto", overflowY: "hidden", whiteSpace: "pre", background: "transparent", color: "#1f2d28" }}
        />
      </div>
    );
  };

  const parts = segments.map((s, k) => ({ s, k })).filter(({ s }) => s.file !== main);
  return (
    <div style={{ border: "1px solid #c7d6cd", borderRadius: 4, padding: 6, background: "#fff", marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, fontSize: 11.5, color: "#5a6b62", flexWrap: "wrap" }}>
        <span>Файл <b>{main}</b>, частей: {parts.length}. Клик по части — раскрыть.</span>
        <button style={{ fontSize: 11 }} onClick={() => setOpen(Object.fromEntries(parts.map(({ k }) => [k, true])))}>раскрыть все</button>
        <button style={{ fontSize: 11 }} onClick={() => setOpen({})}>свернуть все</button>
      </div>
      <div style={{ fontSize: 11, color: edited ? "#8a5a2a" : "#7a8a82", marginBottom: 4 }}>
        {edited ? "Правки только в мастерской, в файл они не записаны — перенесите в VS Code; Ctrl+S в VS Code заменит их текстом файла. " : "Текст можно править прямо здесь — чертёж перестроится сразу, файл не меняется. "}
        Ctrl+↑/↓ на числе — подбор значения (Shift — шаг 0,1; Alt — 0,01).
      </div>
      {err && <div style={{ fontSize: 11.5, color: "#c0392b", background: "#fdecea", padding: "3px 6px", marginBottom: 4 }}>Не разобрано: {err}</div>}
      {segments.map((s, k) => s.file === main ? <div key={k}>{editor(k)}</div> : (
        <div key={k} style={{ margin: "2px 0", border: "1px solid #dfe8e2", borderRadius: 3, background: "#f7faf8" }}>
          <div onClick={() => setOpen({ ...open, [k]: !open[k] })} title="Раскрыть / свернуть часть"
            style={{ ...mono, cursor: "pointer", padding: "1px 6px", color: "#2f6f4f", userSelect: "none" }}>
            {open[k] ? "▾" : "▸"} <b>require</b> "{s.file}" <span style={{ color: "#8a9a92" }}>· {s.count} стр.</span>
          </div>
          {open[k] && <div style={{ borderTop: "1px solid #dfe8e2" }}>{editor(k)}</div>}
        </div>
      ))}
    </div>
  );
}
