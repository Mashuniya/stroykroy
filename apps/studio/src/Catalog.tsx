import { useState } from "react";
import { ELEMENT_ROLES, SECTIONS, type SavedConstruction } from "./constructions.js";

/** Список элементов вида kind, которые пользователь может выбрать для модели base. */
export function allowedElements(list: SavedConstruction[], base: SavedConstruction, kind: string): SavedConstruction[] {
  const all = list.filter((c) => c.kind === kind);
  const ids = base.allowed?.[kind];
  return ids && ids.length ? all.filter((c) => ids.includes(c.id)) : all;
}

/**
 * Каталог «как на сайте»: раздел → категория → модель → дополнения (рукава, воротники) → переход к чертежу.
 * Нужен, чтобы проверить путь пользователя до того, как будет сделан сам сайт.
 */
export default function Catalog(p: {
  list: SavedConstruction[];
  onOpen: (baseId: string, picked: Record<string, string>) => void;
}) {
  const bases = p.list.filter((c) => (c.kind ?? "base") === "base");
  const [section, setSection] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const btn = { fontSize: 13, padding: "8px 14px", border: "1px solid #c7d6cd", borderRadius: 6, background: "#f4f7f5", cursor: "pointer", textAlign: "left" as const };
  const crumb = (label: string, on: () => void) => <button onClick={on} style={{ border: "none", background: "none", color: "#2f6f4f", cursor: "pointer", textDecoration: "underline", fontSize: 12.5, padding: 0 }}>{label}</button>;

  const model = bases.find((b) => b.id === modelId) ?? null;
  const sections = SECTIONS.filter((s) => bases.some((b) => (b.section ?? "Женская одежда") === s));
  const cats = section ? Array.from(new Set(bases.filter((b) => (b.section ?? "Женская одежда") === section).map((b) => b.category ?? "Без категории"))) : [];
  const models = section && category ? bases.filter((b) => (b.section ?? "Женская одежда") === section && (b.category ?? "Без категории") === category) : [];

  return (
    <div data-panel="catalog" style={{ padding: 4 }}>
      <div style={{ fontSize: 12.5, marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {crumb("Каталог", () => { setSection(null); setCategory(null); setModelId(null); })}
        {section && <>› {crumb(section, () => { setCategory(null); setModelId(null); })}</>}
        {category && <>› {crumb(category, () => setModelId(null))}</>}
        {model && <>› <b>{model.name}</b></>}
      </div>
      {!section && (
        <div style={{ display: "grid", gap: 8 }}>
          {sections.length === 0 && <div style={{ fontSize: 12, color: "#5a6b62" }}>Пока нет моделей. Откройте построение и укажите раздел и категорию (вкладка «Скрипт», блок «В каталоге»).</div>}
          {sections.map((s) => <button key={s} data-cat-section={s} onClick={() => setSection(s)} style={btn}>{s}</button>)}
        </div>
      )}
      {section && !category && (
        <div style={{ display: "grid", gap: 8 }}>
          {cats.map((c) => <button key={c} data-cat-category={c} onClick={() => setCategory(c)} style={btn}>{c} <span style={{ color: "#5a6b62" }}>({bases.filter((b) => (b.section ?? "Женская одежда") === section && (b.category ?? "Без категории") === c).length})</span></button>)}
        </div>
      )}
      {section && category && !model && (
        <div style={{ display: "grid", gap: 8 }}>
          {models.map((m) => <button key={m.id} data-cat-model={m.id} onClick={() => { setModelId(m.id); setPicked({ ...(m.attached ?? {}) }); }} style={btn}>{m.name}</button>)}
        </div>
      )}
      {model && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: "bold", marginBottom: 6 }}>Дополнения к модели</div>
          {ELEMENT_ROLES.map((r) => {
            const opts = allowedElements(p.list, model, r.kind);
            if (opts.length === 0) return null;
            return (
              <div key={r.kind} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: "#5a6b62", marginBottom: 3 }}>{r.title}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button data-cat-pick={r.kind + ":"} onClick={() => setPicked((x) => { const n = { ...x }; delete n[r.kind]; return n; })}
                    style={{ ...btn, padding: "5px 10px", background: !picked[r.kind] ? "#dff0e5" : "#fff", borderColor: !picked[r.kind] ? "#2f6f4f" : "#c7d6cd" }}>без</button>
                  {opts.map((o) => (
                    <button key={o.id} data-cat-pick={r.kind + ":" + o.id} onClick={() => setPicked((x) => ({ ...x, [r.kind]: o.id }))}
                      style={{ ...btn, padding: "5px 10px", background: picked[r.kind] === o.id ? "#dff0e5" : "#fff", borderColor: picked[r.kind] === o.id ? "#2f6f4f" : "#c7d6cd" }}>{o.name}</button>
                  ))}
                </div>
              </div>
            );
          })}
          <button data-cat-open onClick={() => p.onOpen(model.id, picked)} style={{ ...btn, background: "#2f6f4f", color: "#fff", borderColor: "#2f6f4f", marginTop: 6 }}>Перейти к чертежу и меркам →</button>
        </div>
      )}
    </div>
  );
}
