import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  OPS_META, parseSteps, rowText, replaceRow, deleteRow, insertStatement, insertBefore,
  defaultArgs, newOpStatement, freeVarName, isIdent, isSafeField, type Row,
} from "./steps.js";

interface Props {
  script: string;
  setScript: (s: string) => void;
  highlightedVar: string | null;
  setHighlightedVar: (v: string | null) => void;
  /** Все имена переменных — для подсказок в полях. */
  varNames: string[];
  /** Русские описания операторов (по английскому имени) — всплывающие подсказки на кнопках. */
  descriptions: Record<string, string>;
  /** Корень списка шагов — App по нему находит строку, когда кликнули по элементу на чертеже. */
  rootRef: RefObject<HTMLDivElement>;
}

const card = (hl: boolean): CSSProperties => ({
  border: "1px solid " + (hl ? "#d9a400" : "#d3e0d8"), borderRadius: 5, padding: "5px 7px", marginBottom: 4,
  background: hl ? "#fff3c4" : "#fff",
});
const small: CSSProperties = { fontSize: 11.5, border: "1px solid #c7d6cd", borderRadius: 3, padding: "2px 4px", boxSizing: "border-box" };
const mono: CSSProperties = { fontFamily: "monospace", fontSize: 12 };
const bad: CSSProperties = { border: "1px solid #c0392b", background: "#fdecea" };

function OpCard(p: { row: Extract<Row, { kind: "op" }>; hl: boolean; onChange: (r: Row) => void; onDelete: () => void }) {
  const { row, hl, onChange, onDelete } = p;
  const meta = OPS_META[row.op];
  // Пока поле правится, показываем то, что набирает человек (оно может быть пустым); в код при этом идёт значение по умолчанию.
  const [draft, setDraft] = useState<{ name?: string; args?: string[]; comment?: string } | null>(null);
  const args = draft?.args ?? meta.params.map((_, i) => row.args[i] ?? "");
  const full = meta.params.map((_, i) => row.args[i] ?? "");
  const argOk = (i: number, v: string) => isSafeField(v, meta.params[i]?.kind === "list");
  const nameOk = (v: string) => isIdent(v.trim());
  const commentOk = (v: string) => !v.includes("\n");
  const emit = (patch: { name?: string; args?: string[]; comment?: string }) => {
    const next = { ...(draft ?? {}), ...patch };
    setDraft(next);
    // в код записываем только законченные значения; недописанные остаются в поле (красная рамка), код при этом не трогаем
    const nm = next.name !== undefined && nameOk(next.name) ? next.name.trim() : row.name;
    const ag = (next.args ?? full).map((v, i) => (argOk(i, v) ? v : (full[i] ?? "")));
    const cm = next.comment !== undefined && commentOk(next.comment) ? next.comment : row.comment;
    onChange({ ...row, name: nm, args: ag, comment: cm });
  };
  const setArg = (i: number, v: string) => { const a = [...args]; a[i] = v; emit({ args: a }); };
  return (
    <div style={card(hl)} data-step-var={row.name}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          data-field="name" value={draft?.name ?? row.name} onChange={(e) => emit({ name: e.target.value })} onBlur={() => setDraft(null)}
          title="Имя точки/линии. Переименование не меняет ссылки на неё в других шагах."
          style={{ ...small, ...mono, width: 78, fontWeight: 700, ...(draft?.name !== undefined && !nameOk(draft.name) ? bad : {}) }}
        />
        <span style={{ color: "#2f6f4f", fontWeight: 600, fontSize: 12.5 }}>{meta.ru}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onDelete} title="Удалить шаг" style={{ fontSize: 11, padding: "0 6px" }}>✕</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px", marginTop: 3 }}>
        {meta.params.map((pm, i) => (
          <label key={i} style={{ display: "flex", flexDirection: "column", fontSize: 10.5, color: "#5a6b62" }}>
            {pm.label}
            <input
              list="step-vars" data-param={i} value={args[i] ?? ""} placeholder={pm.def} onChange={(e) => setArg(i, e.target.value)} onBlur={() => setDraft(null)}
              title={args[i] !== undefined && !argOk(i, args[i]) ? "Выражение не закончено (скобки/кавычки/лишняя запятая) — в код пока не записано" : undefined}
              style={{ ...small, ...mono, width: pm.kind === "list" ? 230 : 86, ...(args[i] !== undefined && args[i] !== "" && !argOk(i, args[i]) ? bad : {}) }}
            />
          </label>
        ))}
      </div>
      {row.comment && <div style={{ fontSize: 10.5, color: "#7a8a82", marginTop: 2, whiteSpace: "pre-wrap" }}>// {row.comment}</div>}
    </div>
  );
}

function FormulaCard(p: { row: Extract<Row, { kind: "formula" }>; hl: boolean; onChange: (r: Row) => void; onDelete: () => void }) {
  const { row, hl, onChange, onDelete } = p;
  const [draft, setDraft] = useState<{ name?: string; expr?: string; comment?: string } | null>(null);
  const emit = (patch: { name?: string; expr?: string; comment?: string }) => {
    const next = { ...(draft ?? {}), ...patch };
    setDraft(next);
    const nm = next.name !== undefined && isIdent(next.name.trim()) ? next.name.trim() : row.name;
    const ex = next.expr !== undefined && isSafeField(next.expr, true) ? next.expr : row.expr;
    const cm = next.comment !== undefined && !next.comment.includes("\n") ? next.comment : row.comment;
    onChange({ ...row, name: nm, expr: ex, comment: cm });
  };
  const exprBad = draft?.expr !== undefined && draft.expr !== "" && !isSafeField(draft.expr, true);
  return (
    <div style={card(hl)} data-step-var={row.name}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input data-field="name" value={draft?.name ?? row.name} onChange={(e) => emit({ name: e.target.value })} onBlur={() => setDraft(null)} style={{ ...small, ...mono, width: 78, fontWeight: 700, ...(draft?.name !== undefined && !isIdent(draft.name.trim()) ? bad : {}) }} />
        <span style={{ color: "#8a5a2a", fontWeight: 600, fontSize: 12.5 }}>=</span>
        <input
          list="step-vars" data-param={0} value={draft?.expr ?? row.expr} onChange={(e) => emit({ expr: e.target.value })} onBlur={() => setDraft(null)}
          title="Формула: числа, мерки (M.rz40), прибавки (P.PK_31_33), имена других шагов, + − * /, функции COS(), SQRT()…"
          style={{ ...small, ...mono, flex: 1, minWidth: 0, ...(exprBad ? bad : {}) }}
        />
        <button onClick={onDelete} title="Удалить шаг" style={{ fontSize: 11, padding: "0 6px" }}>✕</button>
      </div>
      {row.comment && <div style={{ fontSize: 10.5, color: "#7a8a82", marginTop: 2, whiteSpace: "pre-wrap" }}>// {row.comment}</div>}
    </div>
  );
}

function NoteCard(p: { row: Extract<Row, { kind: "note" }>; onChange: (r: Row) => void; onDelete: () => void }) {
  const { row, onChange, onDelete } = p;
  const heading = row.text.trim().startsWith("---");
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start", marginBottom: 4, marginTop: heading ? 8 : 0 }}>
      <textarea
        value={row.text} rows={Math.min(8, row.text.split("\n").length)}
        onChange={(e) => onChange({ ...row, text: e.target.value })}
        spellCheck={false}
        style={{
          ...small, flex: 1, resize: "vertical", fontFamily: "sans-serif", fontSize: 11.5,
          background: heading ? "#dcebe2" : "#f6f9f7", fontWeight: heading ? 700 : 400, color: "#3a4a41", border: "1px dashed #c7d6cd",
        }}
      />
      <button onClick={onDelete} title="Удалить заметку" style={{ fontSize: 11, padding: "0 6px" }}>✕</button>
    </div>
  );
}

function CodeCard(p: { row: Extract<Row, { kind: "code" }>; onChange: (r: Row) => void; onDelete: () => void }) {
  const { row, onChange, onDelete } = p;
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 10.5, color: "#8a5a2a" }}>
        <button onClick={() => { if (window.confirm("Удалить этот блок кода?")) onDelete(); }} title="Удалить блок" style={{ fontSize: 11, padding: "0 6px" }}>✕</button>
      </div>
      <textarea
        value={row.text} rows={Math.min(14, row.text.split("\n").length)}
        onChange={(e) => onChange({ ...row, text: e.target.value })}
        spellCheck={false}
        style={{ ...small, ...mono, width: "100%", resize: "vertical", background: "#fbf8f1", border: "1px solid #e3d8bf", whiteSpace: "pre" }}
      />
    </div>
  );
}

/** Промежуток между строками: клик — «сюда вставлять новые шаги». Выбранное место подсвечено зелёной полосой. */
function Gap(p: { index: number; active: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  if (p.active) {
    return (
      <div
        data-gap-index={p.index} data-gap-active="1" onClick={p.onPick}
        style={{ margin: "3px 0", padding: "2px 8px", background: "#dff0e6", border: "1px solid #2f6f4f", borderRadius: 4, color: "#1f5a3c", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
      >
        ▶ новый шаг будет вставлен сюда
      </div>
    );
  }
  return (
    <div
      data-gap-index={p.index} onClick={p.onPick} title="Вставлять новые шаги сюда"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ height: hover ? 16 : 6, lineHeight: "16px", textAlign: "center", fontSize: 10.5, color: "#2f6f4f", cursor: "pointer", borderTop: hover ? "1px dashed #2f6f4f" : "none" }}
    >
      {hover ? "＋ вставить сюда" : ""}
    </div>
  );
}

export default function StepsEditor(props: Props) {
  const { script, setScript, highlightedVar, setHighlightedVar, varNames, descriptions, rootRef } = props;
  const rows = useMemo(() => parseSteps(script), [script]);
  const [insertAt, setInsertAt] = useState<number | null>(null); // ПЕРЕД какой строкой вставлять новый шаг (null — в конец)
  const pendingFocus = useRef<number | null>(null);

  // После вставки — ставим курсор в первое поле нового шага («открытое поле для ввода»).
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const start = pendingFocus.current;
    pendingFocus.current = null;
    const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-row-start="${start}"] input[data-param="0"]`)
      ?? rootRef.current?.querySelector<HTMLInputElement>(`[data-row-start="${start}"] input`);
    if (el) { el.focus(); el.select(); el.scrollIntoView({ block: "center" }); }
    const idx = rows.findIndex((r) => r.start === start);
    if (idx >= 0) setInsertAt(idx + 1); // следующий шаг встанет сразу под только что добавленным
  }, [script, rows, rootRef]);

  // Служебные строки импорта (константы, опции input(), объявления, import_*, вводные заметки) по умолчанию скрыты — чертёж от них не зависит
  const [showService, setShowService] = useState(false);
  const imported = /переведённое из файла Leko/.test(script.slice(0, 400));
  const hidden = useMemo(() => {
    const h = rows.map(() => false);
    let firstOp = rows.findIndex((r) => r.kind === "op");
    if (firstOp < 0) firstOp = rows.length;
    rows.forEach((r, i) => {
      const src = script.slice(r.start, r.end);
      const service = /^\s*(?:let|const|var)\s+[\w$]+\s*=\s*(?:input|importValue)\(/.test(src)       // let opt_1 = input(...), let import_x = importValue(...)
        || /^\s*(?:let|var)\s+[\w$]+(?:\s*,\s*[\w$]+)+\s*;/.test(src)                                      // let a, b, c;
        || /^\s*(?:let|var)\s+[\w$]+\s*;/.test(src)                                                         // let a;
        || /^\s*let\s+[\w$]+\s*=\s*-?[\d.]+\s*,/.test(src);                                                 // let rz_16 = 96, rz_1 = 164, …
      if (service || (imported && i < firstOp)) h[i] = true; // в импортированном файле всё до первого построения — настройки и константы
    });
    return h;
  }, [rows, script, imported]);
  const hiddenCount = hidden.filter(Boolean).length;
  const vis = (i: number) => showService || !hidden[i];
  let activeAt = insertAt === null ? rows.length : Math.min(insertAt, rows.length);
  while (activeAt < rows.length && !vis(activeAt)) activeAt++;
  const at = insertAt === null ? rows.length : Math.min(insertAt, rows.length);
  const insertHere = (stmt: string) => {
    let r: { src: string; start: number };
    if (rows.length === 0) r = insertStatement(script, null, stmt);
    else if (at === 0) r = insertBefore(script, rows[0].start, stmt);          // в самое начало
    else r = insertStatement(script, rows[at - 1].end, stmt);                  // под выбранной строкой / в конец
    pendingFocus.current = r.start;
    setScript(r.src);
  };
  const addOp = (op: string) => {
    const meta = OPS_META[op];
    insertHere(newOpStatement(op, freeVarName(meta.varBase, script, meta.varSuffix ?? ""), defaultArgs(op, rows)));
  };
  const addFormula = () => insertHere(`const ${freeVarName("w", script)} = 0;`);
  const addNote = () => insertHere("// заметка");

  const change = (r: Row) => (nr: Row) => setScript(replaceRow(script, r, rowText(nr)));
  const remove = (r: Row) => () => setScript(deleteRow(script, r));

  return (
    <div>
      <datalist id="step-vars">{varNames.map((n) => <option key={n} value={n} />)}</datalist>


      {hiddenCount > 0 && (
        <label style={{ display: "block", fontSize: 11, color: "#5a6b62", marginBottom: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={showService} onChange={(e) => setShowService(e.target.checked)} /> показать служебные строки ({hiddenCount}): константы, опции, объявления
        </label>
      )}
      <div ref={rootRef} style={{ maxHeight: "58vh", overflowY: "auto", paddingRight: 3 }}>
        {rows.map((r, i) => {
          if (!vis(i)) return null;
          const name = r.kind === "op" || r.kind === "formula" ? r.name : null;
          const hl = name !== null && name === highlightedVar;
          return (
            <div key={i}>
              <Gap index={i} active={activeAt === i} onPick={() => setInsertAt(i)} />
              <div
                data-row-start={r.start}
                onFocusCapture={() => { setInsertAt(i + 1); if (name) setHighlightedVar(name); }}
                onClick={() => { setInsertAt(i + 1); if (name) setHighlightedVar(name); }}
              >
                {r.kind === "op" && <OpCard row={r} hl={hl} onChange={change(r)} onDelete={remove(r)} />}
                {r.kind === "formula" && <FormulaCard row={r} hl={hl} onChange={change(r)} onDelete={remove(r)} />}
                {r.kind === "note" && <NoteCard row={r} onChange={change(r)} onDelete={remove(r)} />}
                {r.kind === "code" && <CodeCard row={r} onChange={change(r)} onDelete={remove(r)} />}
              </div>
            </div>
          );
        })}
        {rows.length > 0 && <Gap index={rows.length} active={activeAt === rows.length} onPick={() => setInsertAt(rows.length)} />}
        {rows.length === 0 && <div style={{ fontSize: 12, color: "#5a6b62", padding: 8 }}>Пока пусто — нажмите «Точка» выше.</div>}
      </div>
      <details open style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 11.5, cursor: "pointer", color: "#2f6f4f" }}>Добавить шаг — вставится туда, где зелёная полоса (место выбирается кликом между строками или по строке)</summary>
        <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 5px" }}>
          {Object.entries(OPS_META).map(([op, meta]) => (
            <li key={op}>
              <button
                onClick={() => addOp(op)} title={`${op} — ${descriptions[op] ?? ""}`}
                style={{ fontSize: 11.5, padding: "2px 7px", background: "#eef3f0", border: "1px solid #c7d6cd", borderRadius: 3, cursor: "pointer" }}
              >
                {meta.ru}
              </button>
            </li>
          ))}
          <li><button onClick={addFormula} title="Число, посчитанное по формуле: const w1 = 0.5*M.rz47 + 1;" style={{ fontSize: 11.5, padding: "2px 7px", background: "#f4eedd", border: "1px solid #e3d8bf", borderRadius: 3, cursor: "pointer" }}>Формула</button></li>
          <li><button onClick={addNote} title="Вставить комментарий отдельной строкой (в то место, где зелёная полоса)" style={{ fontSize: 11.5, padding: "2px 7px", background: "#f4eedd", border: "1px solid #e3d8bf", borderRadius: 3, cursor: "pointer" }}>Комментарий</button></li>
        </ul>
      </details>
    </div>
  );
}
