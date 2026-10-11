/**
 * Фото для витрины: уменьшаем до разумного размера и сжимаем в JPEG,
 * чтобы файл каталога и память браузера не раздувались.
 */
export async function photoToDataUrl(file: File, maxSide = 800, quality = 0.78): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Не удалось прочитать файл"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Это не картинка"));
    i.src = src;
  });
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать картинку");
  ctx.fillStyle = "#fff"; // прозрачные места (png) станут белыми
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Примерный размер data-URL в килобайтах (для подсказки в интерфейсе). */
export const dataUrlKb = (u: string): number => Math.round((u.length * 3) / 4 / 1024);
