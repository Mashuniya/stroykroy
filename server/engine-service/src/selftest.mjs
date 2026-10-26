// Самопроверка алгоритмов: прогон всех моделей каталога по базе типовых размеров ОСТ.
//   node src/selftest.mjs                 — все модели из STROYKROY_MODELS_DIR, быстрый режим
//   node src/selftest.mjs MOV11001        — одна модель (по id файла без .json)
//   node src/selftest.mjs --full          — все варианты на всех 147 размерах (долго)
//   node src/selftest.mjs --out отчёт.txt — сохранить отчёт в файл
import fs from "node:fs";
import path from "node:path";
import { selfTest, selfTestText } from "./core.mjs";

const MODELS_DIR = process.env.STROYKROY_MODELS_DIR ?? "/var/lib/stroykroy/models";
const args = process.argv.slice(2);
const full = args.includes("--full");
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const only = args.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1);

export function loadAllModels(dir = MODELS_DIR, ids = []) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).filter((f) => !ids.length || ids.includes(f.replace(/\.json$/, "")));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const models = loadAllModels(MODELS_DIR, only);
  const reports = models.map((m) => { process.stderr.write(`проверяю ${m.name}… `); const r = selfTest(m, { mode: full ? "full" : "quick" }); process.stderr.write(`${r.failed ? "ОШИБОК " + r.failed : "ок"} (${r.total}, ${Math.round(r.ms / 1000)} с)\n`); return r; });
  const text = selfTestText(reports);
  if (out) { fs.writeFileSync(out, text); console.log("отчёт записан:", out); } else console.log(text);
  process.exit(reports.some((r) => r.failed) ? 1 : 0);
}
