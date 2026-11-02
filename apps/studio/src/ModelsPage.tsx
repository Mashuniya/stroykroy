import type { SavedModel } from "./models";

/** Страница «Модели»: все сохранённые наборы (основа + элементы + опции + прибавки), галочка «В каталог на сайте». */
export function ModelsPage({ models, onChange, onOpen, onExport, onPublish }: {
  models: SavedModel[]; onChange: (list: SavedModel[]) => void;
  onOpen: (m: SavedModel) => void; onExport: (m: SavedModel) => void; onPublish: () => void;
}) {
  const patch = (id: string, p: Partial<SavedModel>) => onChange(models.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const pub = models.filter((m) => m.publish).length;
  const sorted = [...models].sort((a, b) => b.created.localeCompare(a.created));
  return (
    <div data-models-page>
      <div style={{ fontSize: 12.5, color: "#5a6b62", marginBottom: 8 }}>
        Сохранённые модели: набор алгоритмов, опций, прибавок и мерок. Сохранить текущую — кнопка «💾 Сохранить модель» над чертежом. Отмеченные галочкой уйдут на сайт в файле каталога.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>Моделей: {models.length}</b>
        <span style={{ color: "#2f6f4f", fontSize: 12.5 }}>на сайт: {pub}</span>
        <span style={{ flex: 1 }} />
        <button data-models-publish onClick={onPublish} disabled={pub === 0} style={{ fontSize: 12.5 }} title="Тот же файл каталога, что на вкладке «Каталог»: в него добавятся отмеченные модели">⬇ Файл каталога для сайта (.json)</button>
      </div>
      {sorted.length === 0 && <div style={{ color: "#8a6d1f", fontSize: 13 }}>Пока нет ни одной модели. Откройте основу, настройте опции и прибавки и нажмите «💾 Сохранить модель».</div>}
      {sorted.map((m) => {
        const o = m.snapshot;
        const els = o.roles.filter((r) => r.code && !/^без/i.test(r.code)).map((r) => `${r.title}: ${r.code}`);
        return (
          <div key={m.id} data-model={m.code} style={{ border: "1px solid " + (m.publish ? "#7fb394" : "#d5e0d9"), background: m.publish ? "#f1f8f3" : "#fafcfb", borderRadius: 6, padding: "6px 8px", marginBottom: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <b data-model-code style={{ fontSize: 13.5 }}>{m.code}</b>
              <span style={{ fontSize: 11.5, color: "#5a6b62" }}>{m.created.slice(0, 10)} · основа {m.baseCode}</span>
            </div>
            <input value={m.title} placeholder="название (для себя, необязательно)" onChange={(e) => patch(m.id, { title: e.target.value })} style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5, margin: "4px 0" }} />
            <div style={{ fontSize: 11.5, color: "#5a6b62", marginBottom: 4 }}>
              {els.length ? els.join(" · ") + " · " : ""}опций {o.options.length} · прибавок {o.eases.length + o.allowances.length} · {o.figureId}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontWeight: m.publish ? "bold" : "normal" }} title="Модель попадёт в файл каталога для сайта">
                <input type="checkbox" data-model-publish checked={m.publish} onChange={(e) => patch(m.id, { publish: e.target.checked })} />В каталог на сайте
              </label>
              <span style={{ flex: 1 }} />
              <button data-model-open onClick={() => onOpen(m)} style={{ fontSize: 12 }} title="Открыть основу с опциями, прибавками и мерками этой модели">Открыть</button>
              <button data-model-xlsx onClick={() => onExport(m)} style={{ fontSize: 12 }} title="Сохранить модель в файл Excel (как «Заказ»)">⬇ Excel</button>
              <button data-model-del onClick={() => { if (window.confirm(`Удалить модель ${m.code}?`)) onChange(models.filter((x) => x.id !== m.id)); }} style={{ fontSize: 12 }}>Удалить</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
