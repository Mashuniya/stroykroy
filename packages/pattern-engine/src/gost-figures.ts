import { BOY_LABELS, BOY_NAMES, BOY_ROWS, BOY_UNCERTAIN } from "./gost-boys-data.js";

/**
 * Типовые фигуры мальчиков — ГОСТ 17917-86 «Фигуры мальчиков типовые. Размерные признаки для проектирования одежды»,
 * таблица 5 (459 фигур, 85 размерных признаков). Данные получены распознаванием скана, поэтому часть ячеек
 * (около 5%) помечена как сомнительная — см. uncertainKeys.
 *
 * Фигура обозначается «рост-обхват груди III-обхват талии», например 134-64-57.
 * Мерки лежат под ключами rz{номер признака по ГОСТ}: rz1 — рост, rz16 — обхват груди третий, rz18 — обхват талии.
 */

export const GOST_BOYS_SOURCE = "ГОСТ 17917-86 (типовые фигуры мальчиков), таблица 5";

export interface KidFigure {
  /** «рост-обхват груди-обхват талии», например «134-64-57» */
  id: string;
  sex: "boy";
  height: number;
  chest: number;
  waist: number;
  /** мерки по ключам rz{N} в сантиметрах (включая rz1, rz16, rz18) */
  measurements: Record<string, number>;
  /** ключи мерок, значения которых при распознавании скана вызывают сомнение — их стоит сверить */
  uncertainKeys: string[];
}

const uncertainByFigure = new Map<number, string[]>();
for (const u of BOY_UNCERTAIN) {
  const fi = Math.floor(u / 100), li = u % 100;
  const arr = uncertainByFigure.get(fi) ?? [];
  arr.push("rz" + BOY_LABELS[li]);
  uncertainByFigure.set(fi, arr);
}

export const BOY_FIGURES: KidFigure[] = BOY_ROWS.map((r, fi) => {
  const [height, chest, waist] = r;
  const measurements: Record<string, number> = { rz1: height, rz16: chest, rz18: waist };
  BOY_LABELS.forEach((n, i) => { measurements["rz" + n] = r[3 + i] / 10; });
  return { id: `${height}-${chest}-${waist}`, sex: "boy", height, chest, waist, measurements, uncertainKeys: uncertainByFigure.get(fi) ?? [] };
});

/** Группы по росту — удобно для выпадающего списка. */
export const BOY_FIGURE_GROUPS: { height: number; title: string; figures: KidFigure[] }[] = Array.from(new Set(BOY_FIGURES.map((f) => f.height)))
  .sort((a, b) => a - b)
  .map((h) => ({ height: h, title: `Рост ${h}`, figures: BOY_FIGURES.filter((f) => f.height === h) }));

export function getBoyFigure(id: string): KidFigure | undefined {
  return BOY_FIGURES.find((f) => f.id === id);
}

/** Какая фигура мальчика выставлена: совпадают все мерки набора. null — «свои мерки». */
export function findBoyFigure(m: Record<string, number>): KidFigure | null {
  return BOY_FIGURES.find((f) => Object.keys(f.measurements).every((k) => m[k] !== undefined && Math.abs(f.measurements[k] - m[k]) < 0.005)) ?? null;
}

/** Название размерного признака по ГОСТ 17917-86 (табл. 4) для ключа rz{N}. */
export function kidMeasurementName(key: string): string | undefined {
  if (key === "rz1") return "Рост (высота верхушечной точки)";
  if (key === "rz16") return "Обхват груди третий";
  if (key === "rz18") return "Обхват талии";
  return BOY_NAMES[Number(key.replace("rz", ""))];
}
