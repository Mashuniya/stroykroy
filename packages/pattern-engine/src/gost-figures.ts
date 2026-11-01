import { BOY_LABELS, BOY_NAMES, BOY_ROWS, BOY_UNCERTAIN } from "./gost-boys-data.js";
import { MEN_LABELS, MEN_ROWS } from "./gost-men-data.js";
import { GIRL_LABELS, GIRL_ROWS, GIRL_UNCERTAIN } from "./gost-girls-data.js";

/**
 * Типовые фигуры детей: мальчики — ГОСТ 17917-86 (таблица 5: 459 фигур, 85 признаков), девочки — ГОСТ 17916-86 (таблица 5: 440
 * фигур, 84 признака). Данные из текстового слоя PDF, у мальчиков сверены с распознаванием скана и перечитаны по картинке.
 * Сомнительны только ячейки, которые в самом источнике стёрты или смазаны (в данных там оценка по соседям): см. uncertainKeys.
 *
 * Фигура обозначается «рост-обхват груди III-обхват талии», например 134-64-57.
 * Мерки лежат под ключами rz{номер признака по ГОСТ}: rz1 — рост, rz16 — обхват груди третий, rz18 — обхват талии.
 */

export const GOST_BOYS_SOURCE = "ГОСТ 17917-86 (типовые фигуры мальчиков), таблица 5";

export interface KidFigure {
  /** «рост-обхват груди-обхват талии», например «134-64-57» */
  id: string;
  sex: "boy" | "girl" | "man";
  height: number;
  chest: number;
  waist: number;
  /** мерки по ключам rz{N} в сантиметрах (включая rz1, rz16, rz18) */
  measurements: Record<string, number>;
  /** ключи мерок, значения которых при распознавании скана вызывают сомнение — их стоит сверить */
  uncertainKeys: string[];
}

function buildFigures(sex: "boy" | "girl" | "man", labels: number[], rows: number[][], uncertain: number[]): KidFigure[] {
  const uncertainByFigure = new Map<number, string[]>();
  for (const u of uncertain) {
    const fi = Math.floor(u / 100), li = u % 100;
    const arr = uncertainByFigure.get(fi) ?? [];
    arr.push("rz" + labels[li]);
    uncertainByFigure.set(fi, arr);
  }
  return rows.map((r, fi) => {
    const [height, chest, waist] = r;
    const measurements: Record<string, number> = { rz1: height, rz16: chest, rz18: waist };
    labels.forEach((n, i) => { measurements["rz" + n] = r[3 + i] / 10; });
    return { id: `${height}-${chest}-${waist}`, sex, height, chest, waist, measurements, uncertainKeys: uncertainByFigure.get(fi) ?? [] };
  });
}

function groupsOf(figs: KidFigure[]): { height: number; title: string; figures: KidFigure[] }[] {
  return Array.from(new Set(figs.map((f) => f.height))).sort((a, b) => a - b)
    .map((h) => ({ height: h, title: `Рост ${h}`, figures: figs.filter((f) => f.height === h) }));
}

const findIn = (figs: KidFigure[], m: Record<string, number>) =>
  figs.find((f) => Object.keys(f.measurements).every((k) => m[k] !== undefined && Math.abs(f.measurements[k] - m[k]) < 0.005)) ?? null;

export const BOY_FIGURES: KidFigure[] = buildFigures("boy", BOY_LABELS, BOY_ROWS, BOY_UNCERTAIN);
/** Группы по росту — удобно для выпадающего списка. */
export const BOY_FIGURE_GROUPS = groupsOf(BOY_FIGURES);
export const getBoyFigure = (id: string): KidFigure | undefined => BOY_FIGURES.find((f) => f.id === id);
/** Какая фигура мальчика выставлена: совпадают все мерки набора. null — «свои мерки». */
export const findBoyFigure = (m: Record<string, number>): KidFigure | null => findIn(BOY_FIGURES, m);

export const GOST_MEN_SOURCE = "ГОСТ 17521-72 (типовые фигуры мужчин), таблица 5 — только особо большие размеры и ростовки";
/**
 * ВНИМАНИЕ: в ГОСТ 17521-72 абсолютные величины даны только для мужчин особо больших размеров и ростов (73 фигуры);
 * для обычных фигур мужчин в стандарте сделана ссылка на ОСТ 17-325-86 — этих данных здесь пока нет.
 */
export const MEN_FIGURES: KidFigure[] = buildFigures("man", MEN_LABELS, MEN_ROWS, []);
export const MEN_FIGURE_GROUPS = groupsOf(MEN_FIGURES);
export const getMenFigure = (id: string): KidFigure | undefined => MEN_FIGURES.find((f) => f.id === id);
export const findMenFigure = (m: Record<string, number>): KidFigure | null => findIn(MEN_FIGURES, m);

export const GOST_GIRLS_SOURCE = "ГОСТ 17916-86 (типовые фигуры девочек), таблица 5";
export const GIRL_FIGURES: KidFigure[] = buildFigures("girl", GIRL_LABELS, GIRL_ROWS, GIRL_UNCERTAIN);
export const GIRL_FIGURE_GROUPS = groupsOf(GIRL_FIGURES);
export const getGirlFigure = (id: string): KidFigure | undefined => GIRL_FIGURES.find((f) => f.id === id);
export const findGirlFigure = (m: Record<string, number>): KidFigure | null => findIn(GIRL_FIGURES, m);

/** Название размерного признака по ГОСТ 17917-86 (табл. 4) для ключа rz{N}. */
export function kidMeasurementName(key: string): string | undefined {
  if (key === "rz1") return "Рост (высота верхушечной точки)";
  if (key === "rz16") return "Обхват груди третий";
  if (key === "rz18") return "Обхват талии";
  if (key === "rz17") return "Обхват груди четвертый";
  return BOY_NAMES[Number(key.replace("rz", ""))];
}

/** Типовая фигура ребёнка по умолчанию (≈ 8–9 лет): для построений детской одежды, когда выставлена взрослая женская фигура. Есть и у мальчиков, и у девочек. */
export const DEFAULT_KID_FIGURE_ID = "134-64-57";
