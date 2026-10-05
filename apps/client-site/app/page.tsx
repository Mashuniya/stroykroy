"use client";

import { useMemo, useState } from "react";
import {
  evalFormulaSteps,
  renderFormulaSvg,
  DEFAULT_DRESS_BODICE_STEPS,
  DEFAULT_DRESS_BODICE_LINES,
  DEFAULT_MEASUREMENTS_W_164_96_104,
  DEFAULT_EASES,
  type Measurements,
} from "@stroykroy/pattern-engine";

// Дружелюбные подписи для клиента — без Т-кодов и упоминания формул.
const FIELD_LABELS: Record<keyof Measurements, string> = {
  rz7: "Высота линии талии",
  rz9: "Высота колена",
  rz12: "Высота ягодичной складки",
  rz13: "Обхват шеи",
  rz14: "Обхват груди (по выступающим точкам)",
  rz15: "Обхват груди (по проймам)",
  rz18: "Обхват талии",
  rz34: "Расстояние от плеча до груди спереди",
  rz35: "Высота груди",
  rz36: "Длина переда до талии",
  rz38: "Дуга через высшую точку плеча",
  rz39: "Расстояние от шеи до груди сзади",
  rz40: "Длина спины до талии",
  rz44: "Дуга через основание шеи (перед-плечо-спина)",
  rz45: "Ширина груди",
  rz46: "Расстояние между сосковыми точками",
  rz47: "Ширина спины",
  rz57: "Глубина руки (переднезадний размер)",
};

export default function Page() {
  const [M, setM] = useState<Measurements>({ ...DEFAULT_MEASUREMENTS_W_164_96_104 });
  const result = useMemo(
    () => evalFormulaSteps(DEFAULT_DRESS_BODICE_STEPS, M, DEFAULT_EASES),
    [M]
  );
  const svg = useMemo(
    () => renderFormulaSvg(result, DEFAULT_DRESS_BODICE_LINES, { showLabels: false }),
    [result]
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Снимите мерки — получите готовую выкройку</h1>
      <p style={{ color: "#5a6b62", fontSize: 13 }}>
        Введите свои мерки в сантиметрах. Выкройка строится индивидуально под ваши параметры.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px,1fr))", gap: "4px 24px", margin: "16px 0" }}>
        {(Object.keys(M) as (keyof Measurements)[]).map((k) => (
          <label key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>{FIELD_LABELS[k]}</span>
            <input
              type="number" step="0.1" value={M[k]} style={{ width: 80 }}
              onChange={(e) => setM({ ...M, [k]: parseFloat(e.target.value) || 0 })}
            />
          </label>
        ))}
      </div>

      <div style={{ background: "#eef3f0", borderRadius: 8, padding: 16, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />
    </main>
  );
}
