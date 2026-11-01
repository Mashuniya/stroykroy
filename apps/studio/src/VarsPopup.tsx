import { useMemo, useState } from "react";

const n2 = (v: number) => String(Math.round(v * 1000) / 1000).replace(".", ",");

/** Кратко: что лежит в переменной (число, точка, длина линии…). */
function show(v: unknown): { kind: string; text: string } {
  if (typeof v === "number") return { kind: "число", text: n2(v) };
  if (typeof v === "string") return { kind: "значение", text: v };
  if (!v || typeof v !== "object") return { kind: "значение", text: String(v) };
  const o = v as Record<string, unknown>;
  if (o.kind === "piece") return { kind: "деталь", text: "деталь" };
  if ("center" in o && "radius" in o) return { kind: "линия", text: `дуга, радиус ${n2(Number(o.radius))}` };
  if (Array.isArray(o.points)) return { kind: "линия", text: `длина ${n2(Number(o.length))}${typeof o.angle1 === "number" ? `, угол ${n2(o.angle1 as number)}°` : ""}` };
  if ("p1" in o && "p2" in o) { const a = o.p1 as { x: number; y: number }, b = o.p2 as { x: number; y: number }; return { kind: "линия", text: `отрезок, длина ${n2(Math.hypot(b.x - a.x, b.y - a.y))}` }; }
  if (typeof o.x === "number" && typeof o.y === "number") return { kind: "точка", text: `x ${n2(o.x)}; y ${n2(o.y)}` };
  return { kind: "значение", text: "…" };
}

/**
 * «Просмотр значений переменных» (как в Леко): всё, что считается в строках построения. Клик по строке открывает код с расчётом.
 */
export function VarsPopup({ vars, lines, rubyOf, onPick, onClose }: {
  vars: Record<string, unknown>; lines: Record<string, number>;
  rubyOf: (name: string) => { where: string; text: string } | null;
  onPick: (name: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"все" | "число" | "точка" | "линия">("все");
  const rows = useMemo(() => Object.keys(vars).filter((k) => lines[k] !== undefined)
    .sort((a, b) => lines[a] - lines[b])
    .map((k) => ({ k, ...show(vars[k]), ruby: rubyOf(k) })), [vars, lines, rubyOf]);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => (kind === "все" || r.kind === kind) && (!ql || r.k.toLowerCase().includes(ql) || r.text.toLowerCase().includes(ql) || (r.ruby?.text ?? "").toLowerCase().includes(ql)));
  return (
    <div data-vars-popup style={{ position: "fixed", right: 16, top: 90, width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", display: "flex", flexDirection: "column", zIndex: 60, background: "#fff", border: "1px solid #8fa89a", borderRadius: 6, boxShadow: "0 8px 28px rgba(0,0,0,.3)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 8px", borderBottom: "1px solid #dfe8e2", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13, color: "#2f6f4f" }}>Значения переменных</b>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск: имя, значение, строка" style={{ flex: 1, minWidth: 140, fontSize: 12 }} />
        {(["все", "число", "точка", "линия"] as const).map((x) => (
          <button key={x} onClick={() => setKind(x)} style={{ fontSize: 11.5, fontWeight: kind === x ? "bold" : "normal", background: kind === x ? "#e3efe8" : undefined }}>{x}</button>
        ))}
        <button onClick={onClose} title="Закрыть (Esc)" style={{ fontSize: 12 }}>✕</button>
      </div>
      <div style={{ fontSize: 11, color: "#6b7d73", padding: "3px 8px" }}>Клик по строке — откроется код с расчётом. Показано {shown.length} из {rows.length}.</div>
      <div style={{ overflowY: "auto", fontFamily: "monospace", fontSize: 12 }}>
        {shown.map((r) => (
          <div key={r.k} onClick={() => onPick(r.k)} title={r.ruby ? `${r.ruby.where}\n${r.ruby.text}` : undefined}
            style={{ display: "grid", gridTemplateColumns: "130px 190px 1fr", gap: 8, padding: "2px 8px", cursor: "pointer", borderBottom: "1px solid #f0f4f1" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#eef6f1"; }} onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
            <span style={{ color: "#1f2d28", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.k}</span>
            <span style={{ color: r.kind === "число" ? "#0b5d8a" : "#2f6f4f", whiteSpace: "nowrap" }}>{r.text}</span>
            <span style={{ color: "#8a9a92", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ruby ? `${r.ruby.where.replace(/^.*\//, "")}: ${r.ruby.text.trim()}` : ""}</span>
          </div>
        ))}
        {shown.length === 0 && <div style={{ padding: 10, color: "#8a9a92" }}>Ничего не найдено.</div>}
      </div>
    </div>
  );
}
