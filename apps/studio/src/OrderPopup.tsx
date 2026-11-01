import { useRef } from "react";

/** Окно «Заказ»: набор алгоритмов, опций и прибавок изделия в файле .xlsx — сохранить и загрузить. */
export function OrderPopup({ title, setTitle, summary, onExport, onImport, onClose }: {
  title: string; setTitle: (t: string) => void; summary: string[];
  onExport: () => void; onImport: (f: File) => void; onClose: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div data-order-popup style={{ position: "fixed", right: 16, top: 90, width: 440, maxWidth: "calc(100vw - 32px)", zIndex: 60, background: "#fff", border: "1px solid #8fa89a", borderRadius: 6, boxShadow: "0 8px 28px rgba(0,0,0,.3)", padding: 10, fontSize: 12.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <b style={{ color: "#2f6f4f", fontSize: 13 }}>Заказ</b>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} title="Закрыть" style={{ fontSize: 12 }}>✕</button>
      </div>
      <div style={{ color: "#5a6b62", marginBottom: 6 }}>Набор алгоритмов (основа, рукав, воротник…), набор опций и набор прибавок этого изделия — одним файлом Excel. Значения в нём можно править и загрузить обратно.</div>
      <label style={{ display: "block", marginBottom: 6 }}>Название заказа
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="клиент, номер заказа" style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5 }} />
      </label>
      <ul style={{ margin: "0 0 8px", paddingLeft: 18, color: "#2d3a33" }}>{summary.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div style={{ display: "flex", gap: 6 }}>
        <button data-order-export onClick={onExport} style={{ fontWeight: "bold" }}>⬇ Сохранить заказ (.xlsx)</button>
        <button data-order-import onClick={() => file.current?.click()}>⬆ Загрузить заказ…</button>
        <input ref={file} type="file" accept=".xlsx" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}
