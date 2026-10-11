// Проверка ядра на реальном .ALG: node src/test.mjs /путь/WSW210.ALG
import fs from "node:fs";
import { leko } from "../../../packages/pattern-engine/dist/index.js";
import { describe, previewSvg, buildList } from "./core.mjs";

const file = process.argv[2] ?? "/mnt/user-data/uploads/WSW210.ALG";
const text = leko.decodeAlg(new Uint8Array(fs.readFileSync(file)));
const res = leko.algToScript(text, { title: "WSW210", inputsAsConstants: true });
const model = { id: "c_test", name: "WSW210", mode: "ready", script: res.script, elements: {}, links: [], defaultElements: {}, shownOptions: null, shop: { title: "Свитшот" } };
const d = describe(model);
console.log("поля мерок:", d.measurements.length, "прибавок:", d.eases.reduce((n, g) => n + g.items.length, 0), "опций:", d.options.length);
const a = previewSvg(model, { figure: "164-96-104" });
console.log("ошибка:", a.error, "svg байт:", a.svg?.length, "путей:", (a.svg?.match(/<path/g) ?? []).length);
const b = previewSvg(model, { figure: "170-104-112" });
console.log("другой размер, svg отличается:", a.svg !== b.svg);
// ответ не содержит исходный скрипт
const leak = JSON.stringify(a.describe).includes(res.script.slice(0, 40));
console.log("скрипт в ответе:", leak);
const bad = previewSvg(model, { figure: "нет", measurements: { rz13: -5, rz14: "x" }, eases: { PK_31_33: 1e9 }, options: { zzz: NaN } });
console.log("мусор на входе — ошибка:", bad.error, "svg:", !!bad.svg);
fs.writeFileSync("/tmp/claude-0/preview.svg", a.svg ?? "");
