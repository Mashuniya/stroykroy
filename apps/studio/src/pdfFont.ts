/// <reference types="vite/client" />
import regularUrl from "../../../server/engine-service/fonts/DejaVuSans.ttf?url";
import boldUrl from "../../../server/engine-service/fonts/DejaVuSans-Bold.ttf?url";

let cache: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

/** Шрифт для русского текста в PDF (тот же, что у сервиса чертежей на сайте). Загружается один раз. */
export function loadPdfFont() {
  const get = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error("не загрузился шрифт для PDF");
    return new Uint8Array(await r.arrayBuffer());
  };
  cache ??= Promise.all([get(regularUrl), get(boldUrl)]).then(([regular, bold]) => ({ regular, bold }));
  cache.catch(() => { cache = null; });
  return cache;
}
