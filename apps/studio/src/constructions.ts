export interface SavedConstruction {
  id: string;
  name: string;
  script: string;
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
