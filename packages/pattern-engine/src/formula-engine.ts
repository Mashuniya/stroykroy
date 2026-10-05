import type { Measurements, Eases, Point, Arc } from "./types.js";
import { dist, circleIntersect, circleVerticalLineIntersect, pick, rotateAround } from "./geometry.js";
import { localizeError } from "./error-i18n.js";

/**
 * Один шаг построения — ровно то же самое, что одна строка таблицы 7
 * методики ЕМКО СЭВ: обозначение отрезка/точки и формула для него.
 *
 * kind:
 *  - "value" — вспомогательная числовая величина (например, "31-33" — длина отрезка),
 *               доступна в последующих формулах как V["id"]
 *  - "point" — координатная точка {x,y}, доступна как pt["id"]
 *  - "arc"   — дуга {center,radius,from,to,sweep}; центр дуги автоматически
 *               становится доступен и как точка pt["id"] (так же, как в
 *               оригинале: например, точка 342 — это и центр дуги, и
 *               полноценная конструктивная точка)
 *
 * formula — JS-выражение (строка). Доступны: M (мерки), P (прибавки),
 * V (уже посчитанные значения), pt (уже посчитанные точки), и функции
 * dist, circleIntersect, circleVerticalLineIntersect, rotateAround, pick.
 * Шаги вычисляются строго по порядку — формула может ссылаться только
 * на то, что вычислено ВЫШЕ неё.
 */
export interface FormulaStep {
  id: string;
  label: string;
  kind: "value" | "point" | "arc";
  formula: string;
}

/** Прямая линия между двумя уже вычисленными точками — для отрисовки контура/вытачек. */
export interface FormulaLine {
  from: string;
  to: string;
  style?: "seg" | "aux" | "dart";
}

export interface FormulaEvalError {
  stepId: string;
  message: string;
}

export interface FormulaEvalResult {
  points: Record<string, Point>;
  values: Record<string, number>;
  arcs: Record<string, Arc>;
  errors: FormulaEvalError[];
}

/**
 * Выполняет список шагов по порядку. Шаг, формула которого упала с ошибкой
 * (опечатка, деление на несуществующую точку, непересёкшиеся окружности —
 * circleIntersect/circleVerticalLineIntersect возвращают [] вместо броска
 * исключения, поэтому "не пересеклись" тоже нужно проверять через throw
 * внутри формулы, как это сделано в формулах по умолчанию), просто
 * пропускается — его точки/значения не появляются, ошибка попадает в
 * errors, а все остальные шаги, которые от него не зависят, всё равно
 * считаются.
 */
export function evalFormulaSteps(steps: FormulaStep[], M: Measurements, P: Eases): FormulaEvalResult {
  const pt: Record<string, Point> = {};
  const V: Record<string, number> = {};
  const arcs: Record<string, Arc> = {};
  const errors: FormulaEvalError[] = [];

  for (const step of steps) {
    try {
      // eslint-disable-next-line no-new-func
      const run = new Function(
        "M", "P", "V", "pt",
        "dist", "circleIntersect", "circleVerticalLineIntersect", "rotateAround", "pick",
        `"use strict"; return (${step.formula});`
      );
      const value = run(M, P, V, pt, dist, circleIntersect, circleVerticalLineIntersect, rotateAround, pick);

      if (step.kind === "value") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error("формула должна вернуть число");
        }
        V[step.id] = value;
      } else if (step.kind === "point") {
        if (!value || typeof value.x !== "number" || typeof value.y !== "number") {
          throw new Error("формула должна вернуть точку {x, y}");
        }
        pt[step.id] = { x: value.x, y: value.y };
      } else {
        if (!value || !value.center || typeof value.radius !== "number" || !value.from || !value.to) {
          throw new Error("формула должна вернуть дугу {center, radius, from, to, sweep}");
        }
        arcs[step.id] = value as Arc;
        pt[step.id] = value.center; // центр дуги — тоже полноценная точка (как в оригинале таблицы)
      }
    } catch (e) {
      errors.push({ stepId: step.id, message: localizeError(e) });
    }
  }

  return { points: pt, values: V, arcs, errors };
}
