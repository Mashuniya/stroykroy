/** Блоки опций в правой панели: горловина и все её настройки, рукав и пройма и т. д. */
export const OPTION_BLOCKS = ["Общее", "Ткань", "Горловина", "Рукав и пройма", "Низ", "Пояс", "Застёжка", "Карманы"] as const;
export type OptionBlock = typeof OPTION_BLOCKS[number];

const BY_CODE: Record<string, OptionBlock> = {
  facing_t: "Горловина", opt_5: "Горловина", opt_17: "Горловина", opt_facing: "Горловина",
  opt_8: "Рукав и пройма", facing_s: "Рукав и пройма", opt_24: "Рукав и пройма", opt_26: "Рукав и пройма", opt_81: "Рукав и пройма",
  opt_31: "Низ", opt_32: "Низ", ruffle: "Низ", facing_v: "Низ",
  facing_b: "Пояс",
  opt_16: "Застёжка", opt_18: "Застёжка", opt_21: "Застёжка",
  opt_012: "Карманы",
  fabric: "Ткань",
  opt_1: "Общее", opt_2: "Общее", opt_3: "Общее", opt_4: "Общее", opt_20: "Общее", opt_44: "Общее", opt_45: "Общее",
};

// порядок внутри блока: главное — первым (для рукава — длина рукава, затем низ рукава)
const ORDER = ["opt_8", "facing_s", "opt_24", "opt_26", "opt_81", "facing_t", "opt_5", "opt_17", "opt_facing", "opt_31", "opt_32", "ruffle", "facing_b", "opt_16", "opt_21", "opt_18"];

export function blockOf(code: string, title?: string): OptionBlock {
  const hit = BY_CODE[code];
  if (hit) return hit;
  const t = (title ?? "").toLowerCase();
  if (/горловин|воротник|стойк/.test(t)) return "Горловина";
  if (/рукав|пройм|манжет/.test(t)) return "Рукав и пройма";
  if (/пояс|резинк/.test(t)) return "Пояс";
  if (/застёж|застеж|молни|пугов|планк/.test(t)) return "Застёжка";
  if (/карман/.test(t)) return "Карманы";
  if (/низ|разрез|волан|подгиб|клеш|длина изделия/.test(t)) return "Низ";
  if (/ткан/.test(t)) return "Ткань";
  return "Общее";
}
export const optionRank = (code: string): number => { const i = ORDER.indexOf(code); return i < 0 ? 999 : i; };
