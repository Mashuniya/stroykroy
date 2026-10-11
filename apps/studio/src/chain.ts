// Расчёт цепочки «основа + элементы» живёт в движке (его же использует сервер магазина).
export { runChain, linksOf, linkedIds, findBaseFor } from "@stroykroy/pattern-engine";
export type { Chain, ElementRun, RunSettings, ExportMap } from "@stroykroy/pattern-engine";
