import { useState } from "react";
import { parseDecimalInput } from "@stroykroy/pattern-engine";

/**
 * Поле для числа: можно стереть всё и набрать своё значение — «0», «0.5», «0,5», «-3».
 * Пока вы печатаете, в поле остаётся именно набранный текст; в расчёт идёт только то, что уже стало числом.
 * (Раньше значение пересчитывалось после каждой клавиши, и пустое поле сразу превращалось в «0».)
 */
export default function NumberField(props: {
  label: string; code?: string; hint?: string; value: number; onChange: (v: number) => void;
  /** Галочка «показывать пользователю» (пометка записывается в код оператором userInputs). */
  mark?: { checked: boolean; onToggle: () => void };
  /** Поле «активно» (в фокусе или под мышью) — студия подсвечивает связанный участок чертежа. */
  onActive?: (active: boolean) => void;
}) {
  const { label, code, hint, value, onChange, mark, onActive } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && draft.trim() !== "" && parseDecimalInput(draft) === null;
  return (
    <label title={hint} onMouseEnter={() => onActive?.(true)} onMouseLeave={() => { if (document.activeElement?.getAttribute("data-field-label") !== label) onActive?.(false); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, margin: "4px 0", gap: 10 }}>
      {mark && (
        <input
          type="checkbox" checked={mark.checked} onChange={mark.onToggle} data-mark={label}
          title="Показывать пользователю (пометка записывается в код оператором userInputs)"
          style={{ margin: 0, flex: "none" }}
        />
      )}
      <span style={{ flex: 1, lineHeight: 1.25, color: mark && !mark.checked ? "#8a9a91" : undefined }}>
        {label}
        {code && <span style={{ color: "#8a9a91", fontSize: 10.5, marginLeft: 6, whiteSpace: "nowrap" }}>{code}</span>}
      </span>
      <input
        type="text" inputMode="decimal" data-field-label={label}
        value={draft ?? String(value)}
        onFocus={(e) => { e.target.select(); onActive?.(true); }}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const n = parseDecimalInput(t);
          if (n !== null) onChange(n);
        }}
        onBlur={() => { setDraft(null); onActive?.(false); }}
        style={{ width: 76, fontFamily: "monospace", textAlign: "right", ...(bad ? { border: "1px solid #c0392b", background: "#fdecea" } : {}) }}
      />
    </label>
  );
}
