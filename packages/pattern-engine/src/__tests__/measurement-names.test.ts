import { MEASUREMENT_INFO, MEASUREMENT_ORDER, EASE_INFO, USER_EASE_GROUPS, parseDecimalInput } from "../measurement-names.js";
import { DEFAULT_MEASUREMENTS_W_164_96_104, DEFAULT_EASES } from "../types.js";

let failed = false;
const ok = (c: boolean, m: string) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) failed = true; };

// у каждой мерки есть русское название, порядок — по номерам из книги
const keys = Object.keys(DEFAULT_MEASUREMENTS_W_164_96_104);
ok(keys.every((k) => (MEASUREMENT_INFO as Record<string, { name: string }>)[k]?.name.length > 3), `у всех ${keys.length} мерок есть русское название`);
ok(MEASUREMENT_ORDER.map((k) => MEASUREMENT_INFO[k].number).join(",") === "7,9,12,13,14,15,18,19,34,35,36,38,39,40,44,45,46,47,57", "мерки идут в порядке номеров: Т7, Т9, Т12, Т13…");
ok(MEASUREMENT_INFO.rz13.name === "Обхват шеи" && MEASUREMENT_INFO.rz47.name === "Ширина спины", "rz13 — «Обхват шеи», rz47 — «Ширина спины»");

// показываются только прибавки: свободные члены и коэффициенты не попадают в список
const shown = USER_EASE_GROUPS.flatMap((g) => g.keys);
ok(shown.every((k) => k in DEFAULT_EASES && EASE_INFO[k]), `все ${shown.length} показываемых прибавок существуют и имеют название`);
ok(!shown.some((k) => /^a\d+$/.test(k) || ["beta34", "k31", "O_center", "shoulderAngleDeg"].includes(k)), "свободные члены (a8, a17…), угол β34, k31 и отвод среди показываемых нет");
ok(new Set(shown).size === shown.length, "ни одна прибавка не показана дважды");
ok(EASE_INFO.P_511_570!.name.includes("обхвату бёдер"), "прибавка по линии бёдер называется «Прибавка к обхвату бёдер…»");

// ввод числа
const cases: [string, number | null][] = [["", null], ["-", null], [".", null], ["0", 0], ["0.", 0], ["0.5", 0.5], ["0,5", 0.5], ["12,3", 12.3], ["-3", -3], [" 7 ", 7], ["1e5", null], ["abc", null], ["5.5.5", null], ["00", 0]];
for (const [t, want] of cases) ok(parseDecimalInput(t) === want, `ввод «${t}» → ${want}`);

if (failed) throw new Error("Есть провалившиеся проверки.");
console.log("\nВсе проверки названий и ввода пройдены.");
