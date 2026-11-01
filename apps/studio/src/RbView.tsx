import { useState } from "react";

/** Участок объединённого текста .rb: строки start … start+count-1 — это строки файла file, начиная с fileLine. */
interface Segment { file: string; start: number; fileLine: number; count: number }

/**
 * Файл Ruby как есть, но подключённые части (require "parts/…") свёрнуты в строки: клик по части — раскрывается её текст.
 * Только просмотр: править файл нужно в VS Code (Ctrl+S — студия перечитает).
 */
export function RbView({ source, segments, openLine }: { source: string; segments: Segment[]; openLine?: (file: string, line: number) => void }) {
  const lines = source.split("\n");
  const main = segments[0]?.file ?? "";
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const mono = { fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.5 } as const;
  const rows = (s: Segment, file: string) => lines.slice(s.start - 1, s.start - 1 + s.count).map((t, i) => (
    <div key={i} style={{ display: "flex", ...mono, whiteSpace: "pre-wrap" }}>
      <span onClick={() => openLine?.(file, s.fileLine + i)} title="Открыть эту строку в VS Code"
        style={{ width: 38, flexShrink: 0, textAlign: "right", paddingRight: 8, color: "#9aa9a0", cursor: openLine ? "pointer" : "default", userSelect: "none" }}>{s.fileLine + i}</span>
      <span style={{ color: /^\s*#/.test(t) ? "#6a8a78" : "#1f2d28" }}>{t || " "}</span>
    </div>
  ));
  const parts = segments.map((s, k) => ({ s, k })).filter(({ s }) => s.file !== main);
  return (
    <div style={{ border: "1px solid #c7d6cd", borderRadius: 4, padding: 6, background: "#fff", marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, fontSize: 11.5, color: "#5a6b62" }}>
        <span>Файл <b>{main}</b>, частей: {parts.length}. Клик по части — раскрыть. Править — в VS Code.</span>
        <button style={{ fontSize: 11 }} onClick={() => setOpen(Object.fromEntries(parts.map(({ k }) => [k, true])))}>раскрыть все</button>
        <button style={{ fontSize: 11 }} onClick={() => setOpen({})}>свернуть все</button>
      </div>
      {segments.map((s, k) => s.file === main ? <div key={k}>{rows(s, s.file)}</div> : (
        <div key={k} style={{ margin: "2px 0", border: "1px solid #dfe8e2", borderRadius: 3, background: "#f7faf8" }}>
          <div onClick={() => setOpen({ ...open, [k]: !open[k] })} title="Раскрыть / свернуть часть"
            style={{ ...mono, cursor: "pointer", padding: "1px 6px", color: "#2f6f4f", userSelect: "none" }}>
            {open[k] ? "▾" : "▸"} <b>require</b> "{s.file}" <span style={{ color: "#8a9a92" }}>· {s.count} стр.</span>
          </div>
          {open[k] && <div style={{ borderTop: "1px solid #dfe8e2", padding: "2px 0", background: "#fff" }}>{rows(s, s.file)}</div>}
        </div>
      ))}
    </div>
  );
}
