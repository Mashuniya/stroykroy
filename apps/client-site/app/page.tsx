"use client";

import { useMemo, useState } from "react";
import {
  evalFormulaSteps,
  renderFormulaSvg,
  DEFAULT_DRESS_BODICE_STEPS,
  DEFAULT_DRESS_BODICE_LINES,
  DEFAULT_MEASUREMENTS_W_164_96_104,
  DEFAULT_EASES,
  MEASUREMENT_INFO,
  MEASUREMENT_ORDER,
  STANDARD_FIGURE_GROUPS,
  getStandardFigure,
  findStandardFigure,
  type Measurements,
} from "@stroykroy/pattern-engine";
import NumberField from "./NumberField";

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

      <div style={{ margin: "16px 0 4px" }}>
        <label style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
          Типовая фигура (рост-грудь-бёдра) — выберите готовую или введите свои мерки ниже:
        </label>
        <select
          value={findStandardFigure(M)?.id ?? ""}
          onChange={(e) => { const f = getStandardFigure(e.target.value); if (f) setM({ ...f.measurements }); }}
          style={{ fontSize: 14, padding: "4px 8px" }}
        >
          <option value="" disabled={findStandardFigure(M) !== null}>{findStandardFigure(M) ? "— выберите другую —" : "Свои мерки"}</option>
          {STANDARD_FIGURE_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.title}>
              {g.figures.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px,1fr))", gap: "4px 24px", margin: "16px 0" }}>
        {MEASUREMENT_ORDER.map((k) => (
          <NumberField
            key={k} label={MEASUREMENT_INFO[k].name} code={`Т${MEASUREMENT_INFO[k].number}`}
            value={M[k]} onChange={(v) => setM({ ...M, [k]: v })}
          />
        ))}
      </div>

      <div style={{ background: "#eef3f0", borderRadius: 8, padding: 16, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />
    </main>
  );
}
