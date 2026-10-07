export interface SavedConstruction {
  id: string;
  name: string;
  script: string;
  /** Что это: основа изделия (по умолчанию) или элемент к ней — рукав, воротник… */
  kind?: ElementKind;
  /** Для основы: какие элементы подключены (роль → id построения-элемента). */
  attached?: Record<string, string>;
}

export type ElementKind = "base" | "sleeve" | "collar" | "other";
/** Роли, которые можно подключать к основе (порядок = порядок построения: каждый следующий видит то, что отдали предыдущие). */
export const ELEMENT_ROLES: { kind: Exclude<ElementKind, "base">; title: string; slot: string }[] = [
  { kind: "sleeve", title: "Рукав", slot: "Рукав" },
  { kind: "collar", title: "Воротник", slot: "Воротник" },
  { kind: "other", title: "Другой элемент", slot: "Другой элемент" },
];
export const KIND_TITLES: Record<ElementKind, string> = { base: "Изделие (основа)", sleeve: "Рукав", collar: "Воротник", other: "Другой элемент" };

/** По имени файла Leko угадываем, что это: WSL… — рукав, WSC…/COLLAR — воротник; остальное — основа. */
export function guessKind(fileName: string): ElementKind {
  const n = fileName.toUpperCase();
  if (/^WSL/.test(n) || /SLEEVE/.test(n)) return "sleeve";
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
