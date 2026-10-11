import { ELEMENT_ROLES, KIND_TITLES, type ChainConstruction, type ElementKind, type ElementLink } from "@stroykroy/pattern-engine";
export { ELEMENT_ROLES, KIND_TITLES };
export type { ElementKind, ElementLink };

export interface SavedConstruction extends ChainConstruction {
  id: string;
  name: string;
  script: string;
  /** Исходный текст .ALG (если построение импортировано) — по нему можно заново перевести файл новым переводчиком. */
  source?: string;
  /** Раздел и категория каталога. */
  section?: string;      // «Женская одежда» / «Мужская одежда» / «Детская одежда»
  category?: string;     // «Свитшоты», «Платья»…
  /** Для основы: какие элементы пользователь может выбрать на сайте (вид → id построений-элементов). Пусто — любые подходящие. */
  allowed?: Record<string, string[]>;
  /** Для основы: как лекала выглядят в магазине (название, описание, цена, фото). */
  shop?: ShopInfo;
}

/** Витрина: то, что покупатель видит в магазине на странице лекал. */
export interface ShopInfo {
  /** Название для сайта (если пусто — название построения). */
  title?: string;
  description?: string;
  /** Цена в рублях. */
  price?: number;
  /** Фото: небольшие JPEG в виде data-URL (до SHOP_MAX_PHOTOS штук). */
  photos?: string[];
  /** Выставлять в магазин. Снятая галочка — модель остаётся в каталоге студии, но на сайт не попадает. */
  forSale?: boolean;
}
export const SHOP_MAX_PHOTOS = 4;

export const MODES: { id: "ready" | "constructor"; title: string; hint: string }[] = [
  { id: "ready", title: "Готовые изделия", hint: "дизайнерские модели целиком" },
  { id: "constructor", title: "Конструктор", hint: "основа + рукава, воротники и другие элементы на выбор" },
];
export const modeOf = (c: { mode?: "constructor" | "ready" }): "constructor" | "ready" => c.mode ?? "constructor";
export const SECTIONS = ["Женская одежда", "Мужская одежда", "Детская одежда"];
export const CATEGORY_HINTS = ["Платья", "Жакеты", "Юбки", "Свитшоты", "Брюки", "Пальто", "Блузки", "Топы"];

/** По имени файла Leko угадываем, что это: WSL… — рукав, WSC…/COLLAR — воротник; остальное — основа. */
export function guessKind(fileName: string): ElementKind {
  const n = fileName.toUpperCase();
  if (/^WSL/.test(n) || /SLEEVE/.test(n)) return "sleeve";
  if (/^[MWK]CF/.test(n) || /CUFF/.test(n)) return "cuff";
  if (/^WSC/.test(n) || /COLLAR/.test(n)) return "collar";
  return "base";
}

const STORAGE_KEY = "stroykroy:constructions";
const SELECTED_KEY = "stroykroy:selected-construction";

function newId(): string {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadConstructions(): SavedConstruction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export function saveConstructions(list: SavedConstruction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // тихо игнорируем (например, если localStorage недоступен) — работа в студии не должна падать из-за этого
  }
}

export function loadSelectedId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedId(id: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // игнорируем
  }
}

export function createConstruction(name: string, script: string): SavedConstruction {
  return { id: newId(), name, script };
}
