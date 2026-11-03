import { useState } from "react";
import type { SavedModel } from "./models";
import type { ParamListLine } from "@stroykroy/pattern-engine";

/** Что нужно панели «Параметры списком»: применить список к основе и сохранить результат. */
export interface ParamPasteApi {
  bases: string[];       // коды основ, к которым можно применить список
  current: string;       // основа, открытая сейчас ("" — нет)
  apply: (text: string, baseCode: string) => ParamListLine[] | string; // отчёт по строкам или текст ошибки
  saveModel: (title: string, asNew?: boolean) => void;
  openCode: string | null; // открытая модель: «Сохранить» обновляет её
  saveOrder: (title: string) => void;
}

/** Вставка параметров списком «имя = значение» (как в алгоритме): применить к основе и сохранить как модель или как заказ. */
function ParamPaste({ api }: { api: ParamPasteApi }) {
  const [text, setText] = useState("");
  const [base, setBase] = useState(api.current || api.bases[0] || "");
  const [title, setTitle] = useState("");
  const [report, setReport] = useState<ParamListLine[] | string | null>(null);
  const applied = Array.isArray(report);
  const bad = applied ? report.filter((r) => !r.ok).length : 0;
  return (
    <details data-param-paste open style={{ border: "1px solid #d5e0d9", borderRadius: 6, padding: "6px 8px", marginBottom: 12, background: "#fafcfb" }}>
      <summary style={{ cursor: "pointer", fontWeight: "bold", fontSize: 13 }}>Параметры списком</summary>
      <div style={{ fontSize: 12, color: "#5a6b62", margin: "4px 0 6px" }}>
        По строке «имя = значение», как в алгоритме: пар_N и другие параметры, прибавки ease_* (можно формулой с мерками rz_N), мерки rz_N, элементы «рукав = DMRK45001», «манжета = UMN001» (или отметьте их справа от чертежа: «＋ Подключить любой элемент»). Строки с # — заметки. Порядок строк не важен.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap", fontSize: 12.5 }}>
        <label>Основа{" "}
          <select data-param-base value={base} onChange={(e) => setBase(e.target.value)} style={{ fontSize: 12.5 }}>
            {!api.bases.includes(base) && <option value={base}>{base || "— выберите —"}</option>}
            {api.bases.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="название (для себя, необязательно)" style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5 }} />
        </label>
      </div>
      <textarea data-param-text value={text} onChange={(e) => { setText(e.target.value); setReport(null); }} rows={10} spellCheck={false}
        placeholder={"пар_1 = 1\nfacing_b = 1\nease_chest = rz_16 * 0.01"}
        style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 12.5 }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <button data-param-apply disabled={!text.trim() || !base} onClick={() => setReport(api.apply(text, base))} style={{ fontWeight: "bold", fontSize: 12.5 }}>Применить</button>
        <button data-param-save-model disabled={!applied} onClick={() => api.saveModel(title)} style={{ fontSize: 12.5 }} title={api.openCode ? `Записать в открытую модель ${api.openCode}` : "Сохранить как модель (появится в списке ниже; галочкой — в каталог на сайте)"}>💾 {api.openCode ? `Сохранить ${api.openCode}` : "Сохранить как модель"}</button>
        {api.openCode && <button data-param-save-new disabled={!applied} onClick={() => api.saveModel(title, true)} style={{ fontSize: 12.5 }}>＋ как новую модель</button>}
        <button data-param-save-order disabled={!applied} onClick={() => api.saveOrder(title)} style={{ fontSize: 12.5 }} title="Сохранить как заказ — файл Excel">⬇ Сохранить как заказ (.xlsx)</button>
      </div>
      {typeof report === "string" && <div style={{ color: "#b0303a", fontSize: 12.5, marginTop: 6 }}>{report}</div>}
      {applied && (
        <div data-param-report style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12.5, marginBottom: 2 }}>Принято строк: {report.length - bad}{bad ? `, не принято: ${bad}` : ""}. Чертёж с этими параметрами — на вкладке построения.</div>
          {report.map((r) => (
            <div key={r.line} style={{ fontFamily: "monospace", fontSize: 12, color: r.ok ? "#0b7a62" : "#b0303a" }}>{r.ok ? "✓" : "✗"} {r.text}{r.note ? " — " + r.note : ""}</div>
          ))}
        </div>
      )}
    </details>
  );
}

/** Страница «Модели»: все сохранённые наборы (основа + элементы + опции + прибавки), галочка «В каталог на сайте». */
export function ModelsPage({ models, onChange, onOpen, onExport, onPublish, paste, openId }: {
  models: SavedModel[]; onChange: (list: SavedModel[]) => void;
  onOpen: (m: SavedModel) => void; onExport: (m: SavedModel) => void; onPublish: () => void;
  paste: ParamPasteApi; openId: string | null;
}) {
  const patch = (id: string, p: Partial<SavedModel>) => onChange(models.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const pub = models.filter((m) => m.publish).length;
  const sorted = [...models].sort((a, b) => b.created.localeCompare(a.created));
  return (
    <div data-models-page>
      <ParamPaste api={paste} />
      <div style={{ fontSize: 12.5, color: "#5a6b62", marginBottom: 8 }}>
        Сохранённые модели: набор алгоритмов, опций, прибавок и мерок. Сохранить текущую — кнопка «💾 Сохранить модель» над чертежом. «Открыть» — модель откроется на чертеже справа; правьте и жмите «💾 Сохранить …» — изменения запишутся в неё же, а «＋ как новую» сохранит копию с новым номером. Отмеченные галочкой уйдут на сайт в файле каталога.
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
              {m.id === openId && <span style={{ fontSize: 11.5, color: "#fff", background: "#2f6f4f", borderRadius: 3, padding: "0 5px" }}>открыта — «💾 Сохранить» обновит её</span>}
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
              <button data-model-open onClick={() => onOpen(m)} style={{ fontSize: 12 }} title="Открыть основу с элементами, опциями, прибавками и мерками этой модели — чертёж справа; потом «💾 Сохранить» запишет изменения в эту же модель">Открыть</button>
              <button data-model-xlsx onClick={() => onExport(m)} style={{ fontSize: 12 }} title="Сохранить модель в файл Excel (как «Заказ»)">⬇ Excel</button>
              <button data-model-del onClick={() => { if (window.confirm(`Удалить модель ${m.code}?`)) onChange(models.filter((x) => x.id !== m.id)); }} style={{ fontSize: 12 }}>Удалить</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
