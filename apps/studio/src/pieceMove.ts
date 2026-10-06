/**
 * Положение деталей на листе — только "вид", как в режиме просмотра Leko («ВСЕ ЛЕКАЛА»:
 * деталь тянут мышью и поворачивают стрелками). На построение и на текст скрипта
 * это не влияет, а нужно, чтобы приложить одну деталь к другой.
 */
export interface Xf { dx: number; dy: number; angle: number }

export const ZERO_XF: Xf = { dx: 0, dy: 0, angle: 0 };

/** Смещение деталь получает вслед за курсором: исходное положение + сдвиг мыши в пикселях, переведённый в см. */
export function dragXf(start: Xf, mouseDxPx: number, mouseDyPx: number, scalePxPerCm: number): Xf {
  return { dx: start.dx + mouseDxPx / scalePxPerCm, dy: start.dy + mouseDyPx / scalePxPerCm, angle: start.angle };
}

/** Поворот на deg градусов по часовой стрелке (отрицательное — против), приводится к диапазону (-180; 180]. */
export function rotateXf(xf: Xf, deg: number): Xf {
  let a = (xf.angle + deg) % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return { ...xf, angle: Math.round(a * 1000) / 1000 };
}

/** Шаг поворота: стрелка — 1°, с Shift — 10°, с Alt — 0.1°. Вправо — по часовой, влево — против. */
export function rotationStep(key: string, shift: boolean, alt: boolean): number {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return 0;
  const step = shift ? 10 : alt ? 0.1 : 1;
  return key === "ArrowRight" ? step : -step;
}
