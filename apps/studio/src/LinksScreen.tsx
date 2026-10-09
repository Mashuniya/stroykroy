import { useRef } from "react";
import { KIND_TITLES, ELEMENT_ROLES, type SavedConstruction, type ElementLink, type ElementKind } from "./constructions.js";
import { linksOf } from "./chain.js";

export interface OptInfo { name: string; title: string; values?: (number | [number, string])[] }

interface Props {
  constructions: SavedConstruction[];
  root: SavedConstruction;
  optionsOf: (c: SavedConstruction) => OptInfo[];
  onPatch: (id: string, patch: Partial<SavedConstruction>) => void;
  /** Загрузить ALG как новый элемент и подключить к owner новой связью (или к существующей, если linkId). */
  onUpload: (file: File, ownerId: string, linkId?: string) => void;
  onClose: () => void;
}

const KINDS: ElementKind[] = ["sleeve", "cuff", "pocket", "belt", "collar", "other"];

/** Отдельный экран настройки связей: к основе и к любому её элементу можно подключить другие элементы (манжету к рукаву, подкладку к карману…)
 * загрузкой ALG. На странице построения у пользователя остаются только опции. */
export function LinksScreen({ constructions, root, optionsOf, onPatch, onUpload, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pending = useRef<{ owner: string; link?: string } | null>(null);
  const elementsAll = constructions.filter((c) => (c.kind ?? "base") !== "base");

  function Node({ c, depth, seen }: { c: SavedConstruction; depth: number; seen: string[] }) {
    const links = linksOf(constructions, c);
    const opts = optionsOf(c).concat(depth > 0 ? optionsOf(root).filter((o) => !optionsOf(c).some((x) => x.name === o.name)) : []);
    const save = (next: ElementLink[]) => onPatch(c.id, { links: next });
    const upd = (id: string, patch: Partial<ElementLink>) => save(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const slotIds = depth === 0 ? ELEMENT_ROLES.map((r) => c.attached?.[r.kind]).filter((x): x is string => !!x) : [];
    return (
      <div data-links-node={c.id} style={{ marginLeft: depth * 18, borderLeft: depth ? "2px solid #c7d6cd" : undefined, paddingLeft: depth ? 8 : 0, marginTop: 8 }}>
        <div style={{ fontWeight: "bold", fontSize: 13 }}>
          {depth === 0 ? "Основа" : KIND_TITLES[c.kind ?? "other"]}: {c.name}
          {depth > 0 && (
            <select data-links-kind value={c.kind ?? "other"} onChange={(e) => onPatch(c.id, { kind: e.target.value as ElementKind })} style={{ marginLeft: 8, fontSize: 11 }}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_TITLES[k]}</option>)}
            </select>
          )}
        </div>
        {slotIds.length > 0 && (
          <div style={{ fontSize: 11, color: "#5a6b62" }}>Выбираются пользователем: {slotIds.map((id) => constructions.find((x) => x.id === id)?.name).filter(Boolean).join(", ")}</div>
        )}
        {links.map((l) => {
          const o = opts.find((x) => x.name === l.option);
          const target = constructions.find((x) => x.id === l.element);
          return (
            <div key={l.id} data-link={l.id} style={{ border: "1px solid #d5e0d9", borderRadius: 4, padding: 6, margin: "5px 0", background: "#fff", fontSize: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label>Если опция{" "}
                  <select data-link-option value={l.option} onChange={(e) => upd(l.id, { option: e.target.value, values: [] })} style={{ fontSize: 12 }}>
                    {!o && <option value={l.option}>{l.option}</option>}
                    {opts.map((x) => <option key={x.name} value={x.name}>{x.title}</option>)}
                  </select>
                </label>
                {o?.values ? (
                  <span>равна:{" "}
                    {o.values.map((v) => {
                      const val = typeof v === "number" ? v : v[0];
                      return <label key={val} style={{ marginRight: 8 }}><input type="checkbox" data-link-value={val} checked={l.values.includes(val)}
                        onChange={(e) => upd(l.id, { values: e.target.checked ? [...l.values, val] : l.values.filter((x) => x !== val) })} /> {typeof v === "number" ? v : `${v[0]} — ${v[1]}`}</label>;
                    })}
                  </span>
                ) : (
                  <label>равна (числа через запятую; пусто — любое, кроме 0){" "}
                    <input data-link-values defaultValue={l.values.join(", ")} style={{ width: 90 }}
                      onBlur={(e) => upd(l.id, { values: e.target.value.split(/[,;\s]+/).map(Number).filter((x) => Number.isFinite(x) && e.target.value.trim() !== "") })} />
                  </label>
                )}
              </div>
              <div style={{ marginTop: 4 }}>→ подключить{" "}
                <select data-link-element value={l.element} onChange={(e) => upd(l.id, { element: e.target.value })} style={{ fontSize: 12 }}>
                  {elementsAll.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{KIND_TITLES[x.kind ?? "other"]}: {x.name}</option>)}
                </select>{" "}
                <button data-link-upload onClick={() => { pending.current = { owner: c.id, link: l.id }; fileRef.current?.click(); }} style={{ fontSize: 11 }} title="Заменить элемент: загрузить другой ALG">⬆ другой ALG</button>{" "}
                <button data-link-del onClick={() => save(links.filter((x) => x.id !== l.id))} style={{ fontSize: 11 }}>✕ убрать</button>
              </div>
              {target && !seen.includes(target.id) && <Node c={target} depth={depth + 1} seen={[...seen, target.id]} />}
            </div>
          );
        })}
        <div style={{ marginTop: 4 }}>
          <button data-link-new-upload onClick={() => { pending.current = { owner: c.id }; fileRef.current?.click(); }} style={{ fontSize: 11.5 }}>⬆ Загрузить ALG и подключить к «{c.name}»</button>{" "}
          <button data-link-add disabled={elementsAll.length === 0 || opts.length === 0}
            onClick={() => { const e = elementsAll.find((x) => x.id !== c.id); if (e) save([...links, { id: "l" + Math.random().toString(36).slice(2, 8), option: opts[0].name, values: [], element: e.id }]); }}
            style={{ fontSize: 11.5 }} title="Подключить уже загруженный элемент">+ загруженный элемент</button>
        </div>
      </div>
    );
  }

  return (
    <div data-panel="links-screen" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 50, display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto" }}>
      <div style={{ background: "#f4f8f5", margin: "24px 12px", padding: 16, borderRadius: 8, width: "min(900px, 100%)", boxShadow: "0 4px 24px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Схема связей изделия «{root.name}»</h3>
          <button data-links-close onClick={onClose}>Закрыть</button>
        </div>
        <p style={{ fontSize: 12, color: "#5a6b62" }}>
          Здесь настраивается, какие элементы (манжета, обтачка, карманы, пояс…) подключаются, когда пользователь выбирает опцию. К каждому элементу можно
          подключить свои: манжету к рукаву, подкладку к карману. Пользователь этого не видит — на странице построения у него только набор опций.
        </p>
        <Node c={root} depth={0} seen={[root.id]} />
        <input ref={fileRef} type="file" accept=".alg,.ALG" style={{ display: "none" }} data-links-file
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; const p = pending.current; if (f && p) onUpload(f, p.owner, p.link); }} />
      </div>
    </div>
  );
}
