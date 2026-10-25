import type { SavedConstruction } from "./constructions.js";

/**
 * Файл «каталог.txt» в папке с алгоритмами: паспорта изделий текстом, чтобы не отмечать всё мышкой в десятке мест.
 *
 *   JPL10001
 *     раздел: Женская одежда
 *     категория: Платья
 *     название: Платье прямое
 *     цена: 300
 *     продаётся: да
 *     рукава: JRK10001, WSL21001
 *     рукав по умолчанию: JRK10001
 *     без рукава: да
 *
 * Запись начинается со строки без двоеточия (код изделия). Строки с «#» — заметки. Что не указано — в студии остаётся как было.
 */
export interface CatalogEntry { code: string; fields: Record<string, string>; line: number }

export function parseCatalogFile(text: string): { entries: CatalogEntry[]; problems: string[] } {
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  let cur: CatalogEntry | null = null;
  text.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const colon = line.indexOf(":");
    if (colon < 0) { cur = { code: line, fields: {}, line: i + 1 }; entries.push(cur); return; }
    if (!cur) { problems.push(`строка ${i + 1}: сначала укажите код изделия отдельной строкой`); return; }
    const key = line.slice(0, colon).trim().toLowerCase().replace(/\s+/g, " ");
    cur.fields[key] = line.slice(colon + 1).trim();
  });
  return { entries, problems };
}

const yes = (v: string | undefined): boolean | undefined => {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (["да", "yes", "1", "true", "есть", "+"].includes(s)) return true;
  if (["нет", "no", "0", "false", "-"].includes(s)) return false;
  return undefined;
};
const norm = (s: string) => s.trim().toUpperCase();
const ROLES: { kind: "sleeve" | "collar" | "other"; many: string; one: string; none: string }[] = [
  { kind: "sleeve", many: "рукава", one: "рукав по умолчанию", none: "без рукава" },
  { kind: "collar", many: "воротники", one: "воротник по умолчанию", none: "без воротника" },
  { kind: "other", many: "другие элементы", one: "другой элемент по умолчанию", none: "без другого элемента" },
];
const KNOWN = new Set(["раздел", "категория", "название", "описание", "цена", "продаётся", "продается", "режим", ...ROLES.flatMap((r) => [r.many, r.one, r.none])]);

/** Находит построение по коду: имя совпадает или оканчивается кодом («Рукав WSL21001»). */
function findByCode(list: SavedConstruction[], code: string, kind?: string): SavedConstruction | undefined {
  const c = norm(code);
  const pool = kind ? list.filter((x) => x.kind === kind) : list.filter((x) => (x.kind ?? "base") === "base");
  return pool.find((x) => norm(x.name) === c) ?? pool.find((x) => norm(x.name).endsWith(" " + c));
}

export function applyCatalogFile(text: string, list: SavedConstruction[]): { list: SavedConstruction[]; updated: string[]; problems: string[] } {
  const { entries, problems } = parseCatalogFile(text);
  const updated: string[] = [];
  let out = list;
  for (const e of entries) {
    const base = findByCode(out, e.code);
    if (!base) { problems.push(`${e.code}: изделие не загружено в мастерскую — откройте его из VS Code (Ctrl+S в файле)`); continue; }
    const f = e.fields;
    for (const k of Object.keys(f)) if (!KNOWN.has(k)) problems.push(`${e.code}: непонятная строка «${k}:» — пропущена`);
    const next: SavedConstruction = { ...base };
    if (f["раздел"]) next.section = f["раздел"];
    if (f["категория"]) next.category = f["категория"];
    if (f["режим"]) {
      const m = f["режим"].toLowerCase();
      if (/готов/.test(m)) next.mode = "ready"; else if (/констр/.test(m)) next.mode = "constructor";
      else problems.push(`${e.code}: режим «${f["режим"]}» не понят (нужно «готовое» или «конструктор»)`);
    }
    const shop = { ...(base.shop ?? {}) };
    let shopTouched = false;
    if (f["название"] !== undefined) { shop.title = f["название"]; shopTouched = true; }
    if (f["описание"] !== undefined) { shop.description = f["описание"]; shopTouched = true; }
    if (f["цена"] !== undefined) {
      const n = Number(f["цена"].replace(/\s+/g, "").replace(",", ".").replace(/[^\d.]/g, ""));
      if (Number.isFinite(n) && n > 0) { shop.price = n; shopTouched = true; } else problems.push(`${e.code}: цена «${f["цена"]}» не понята`);
    }
    const sale = yes(f["продаётся"] ?? f["продается"]);
    if (sale !== undefined) { shop.forSale = sale; shopTouched = true; }
    if (shopTouched) next.shop = shop;
    for (const r of ROLES) {
      if (f[r.many] !== undefined) {
        const ids: string[] = [];
        for (const code of f[r.many].split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
          const el = findByCode(out, code, r.kind);
          if (el) ids.push(el.id);
          else problems.push(`${e.code}: элемент «${code}» (${r.many}) не найден среди загруженных — откройте его из VS Code и проверьте, что у него вид «${r.kind === "sleeve" ? "Рукав" : r.kind === "collar" ? "Воротник" : "Другой элемент"}»`);
        }
        next.allowed = { ...(next.allowed ?? {}), [r.kind]: ids };
      }
      const none = yes(f[r.none]);
      if (none !== undefined) next.required = { ...(next.required ?? {}), [r.kind]: !none };
      if (f[r.one] !== undefined) {
        const code = f[r.one];
        const el = /^(нет|без|-)?$/i.test(code) ? undefined : findByCode(out, code, r.kind);
        const att = { ...(next.attached ?? {}) };
        if (el) att[r.kind] = el.id;
        else { delete att[r.kind]; if (code && !/^(нет|без|-)$/i.test(code)) problems.push(`${e.code}: «${code}» по умолчанию не найден`); }
        next.attached = att;
      }
    }
    out = out.map((c) => (c.id === base.id ? next : c));
    updated.push(e.code);
  }
  return { list: out, updated, problems };
}
