/**
 * Пометка «что показывать пользователю» хранится в самом коде как оператор
 *   userInputs(["rz13", "rz40", "PK_31_33"]);
 * Эти функции читают и переписывают его, чтобы галочки во вкладке «Мерки и прибавки»
 * и текст скрипта всегда совпадали.
 */

const CALL = /(^|\n)([ \t]*)userInputs[ \t]*\(\s*\[([\s\S]*?)\]\s*\)[ \t]*;?[ \t]*(?=\n|$)/g;

/** Список ключей из userInputs([...]) в тексте скрипта; null — оператора в скрипте нет (значит, показывается всё). */
export function readUserInputs(script: string): string[] | null {
  let found = false;
  const keys: string[] = [];
  for (const m of script.matchAll(CALL)) {
    found = true;
    for (const k of m[3].matchAll(/["']([^"']+)["']/g)) if (!keys.includes(k[1])) keys.push(k[1]);
  }
  return found ? keys : null;
}

function format(keys: string[]): string {
  if (keys.length === 0) return "userInputs([]);";
  const rows: string[] = [];
  for (let i = 0; i < keys.length; i += 6) rows.push("  " + keys.slice(i, i + 6).map((k) => JSON.stringify(k)).join(", "));
  return "userInputs([\n" + rows.join(",\n") + "\n]);";
}

/** Записывает список в скрипт: заменяет существующий userInputs (лишние повторы убирает), а если его нет — добавляет в начало. */
export function writeUserInputs(script: string, keys: string[]): string {
  const call = format(keys);
  let first = true;
  const replaced = script.replace(CALL, (_m, lead: string, indent: string) => {
    if (first) { first = false; return `${lead}${indent}${call}`; }
    return lead === "\n" ? "" : lead; // повторные вызовы убираем
  });
  if (!first) return replaced.replace(/\n{3,}/g, "\n\n");
  return `// Что показывать пользователю (галочки во вкладке «Мерки и прибавки» правят этот список):\n${call}\n\n${script}`;
}
