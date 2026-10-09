import * as ops from "./ops.js";
import { writePiece, type Piece, type PieceSpec } from "./piece.js";
import type { Measurements, Eases } from "../types.js";
import { localizeError } from "../error-i18n.js";

export interface ScriptError {
  message: string;
}
/** Входной параметр построения: объявлен в скрипте оператором input("имя", значение_по_умолчанию). */
export interface ScriptInput {
  name: string;
  default: number;
  /** Значение, с которым выполнен скрипт: введённое пользователем или значение по умолчанию. */
  value: number;
  /** Это «опция» (выбор пользователя; в переведённых из Leko файлах — пар_N → opt_N): показывается полоской справа от чертежа. */
  option?: boolean;
  /** Русское название опции (если известно). */
  title?: string;
  /** Допустимые значения: число или пара [число, подпись]. Нет — вводится любое число. */
  values?: (number | [number, string])[];
  /** Пояснение для значений, которые нельзя перечислить списком. */
  hint?: string;
}

export interface ScriptResult {
  /** Входные параметры, объявленные в скрипте (в порядке объявления). Пусто, если input() нигде не вызывался. */
  inputs: ScriptInput[];
  /** Все детали, записанные оператором writePiece (в том числе без присваивания переменной). */
  pieces: Piece[];
  /**
   * Что показывать пользователю: ключи мерок (rz13…) и прибавок (PK_31_33…) из оператора userInputs([...]).
   * null — оператор в скрипте не вызывался (тогда показывается всё).
   */
  userInputs: string[] | null;
  /** Все переменные верхнего уровня скрипта (имя -> значение: point/segment/arc/polyline/число/...). */
  переменные: Record<string, unknown>;
  /** Имя переменной -> номер строки (считая с 0) в ИСХОДНОМ тексте скрипта, где она объявлена. Для связки чертёж ↔ код. */
  строки: Record<string, number>;
  ошибка: ScriptError | null;
  /** Что построение отдаёт другим элементам: переменные export_* с числом или текстом (длины срезов, углы, тип ткани…). */
  exports: Record<string, number | string>;
  /** Что построение запросило у других элементов (import_*) и пришло ли это. */
  imports: { name: string; found: boolean }[];
}

/**
 * Имена операторов Leko, доступные внутри скрипта без префикса (ops.* разворачивается
 * в список параметров функции при исполнении — см. runLekoScript).
 */
const OP_NAMES = [...Object.keys(ops), "writePiece", "userInputs", "input", "importValue", "measure"];

/**
 * Грубое (не настоящий парсер JS) извлечение имён переменных ВЕРХНЕГО
 * УРОВНЯ, объявленных через const/let/var — то есть НЕ внутри функций,
 * if/else, циклов и т.д. (там тоже может быть const/let — это нормальный
 * локальный код, он просто не выводится на чертёж как отдельная точка).
 * Отслеживаем глубину вложенности по фигурным скобкам построчно (однострочные
 * // комментарии перед подсчётом вырезаем, чтобы случайные { } в них не сбивали счёт).
 */
const ID = "[a-zA-Zа-яёёА-ЯЁ_$][\\wа-яёёА-ЯЁ$]*";
const RE_SIMPLE = new RegExp(`^\\s*(?:const|let|var)\\s+(${ID})\\s*=`);
const RE_BARE = new RegExp(`^\\s*(?:let|var)\\s+(${ID})\\s*;`); // let x; (без значения на этой же строке)
const RE_ARRAY_DESTRUCTURE = new RegExp(`^\\s*const\\s*\\[\\s*(${ID})\\s*\\]\\s*=`); // const [x] = ...

interface ExtractedNames {
  names: string[];
  /** имя -> номер строки (с 0), где оно объявлено — для связки чертёж ↔ код. */
  lineOf: Record<string, number>;
}

function извлечьИмена(код: string): ExtractedNames {
  const names = new Set<string>();
  const lineOf: Record<string, number> = {};
  let depth = 0;
  const rawLines = код.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace(/\/\/.*$/, ""); // грубое удаление однострочного комментария для подсчёта скобок
    if (depth === 0) {
      // «let a, b, c;» и «let a = 1, b = 2;» — несколько простых имён в одной строке
      const ml = /^\s*(?:let|var)\s+(.+);\s*$/.exec(line);
      const parts = ml ? ml[1].split(",").map((x) => x.trim()) : [];
      const listRe = new RegExp(`^(${ID})(?:\\s*=\\s*-?[\\d.]+)?$`);
      if (ml && parts.length > 1 && parts.every((x) => listRe.test(x))) {
        for (const x of parts) { const nm = listRe.exec(x)![1]; if (!names.has(nm)) { names.add(nm); lineOf[nm] = i; } }
      } else {
        const m = RE_SIMPLE.exec(line) || RE_BARE.exec(line) || RE_ARRAY_DESTRUCTURE.exec(line);
        if (m && !names.has(m[1])) { names.add(m[1]); lineOf[m[1]] = i; }
      }
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  // Имена, объявленные без значения (let a, b; — их значения задаются позже, часто внутри if/else), ведут на первое присваивание,
  // иначе клик по кривой на чертеже открывает пустое объявление, а не то место, где кривая построена.
  const esc = (x: string) => x.replace(/[$]/g, "\\$&");
  for (const nm of names) {
    const decl = rawLines[lineOf[nm]] ?? "";
    if (/=/.test(decl.replace(/\/\/.*$/, "")) && !/^\s*(?:let|var)\s+[^=]*$/.test(decl)) continue; // объявление со значением — оставляем
    const e = esc(nm);
    const pre = "(?<![\\wа-яёА-ЯЁ$])";
    const assign = new RegExp(`(?:^|[;{}]|^\\s*)\\s*${pre}${e}\\s*=(?!=)|^\\s*(?:const|let|var)?\\s*\\[[^\\]]*${pre}${e}(?![\\wа-яёА-ЯЁ$])[^\\]]*\\]\\s*=(?!=)`);
    for (let i = 0; i < rawLines.length; i++) {
      if (i === lineOf[nm]) continue;
      if (assign.test(rawLines[i].replace(/\/\/.*$/, ""))) { lineOf[nm] = i; break; }
    }
  }
  return { names: [...names], lineOf };
}

/**
 * Выполняет скрипт (JS-синтаксис, операторы Leko без префикса, мерки доступны
 * как M.rz7 и т.д.) и возвращает все переменные верхнего уровня для отрисовки.
 */
/** Настройки запуска. girths: в какой форме заданы ОБХВАТЫ в мерках — «full» (полные, как в наших базах и ОСТ-таблицах студии) или «half» (половины, как в ОСТ Leko). */
export interface RunSettings { girths?: "full" | "half"; /** рост, см (рз_1) */ height?: number; /** обхват груди третий, см (рз_16, в той же форме, что и остальные обхваты) */ bust?: number }
/** Мерки-обхваты, которые в Leko бывают половинными (ОСТ.rb удваивает их: рз_13…20, 45…47). */
const GIRTH_KEYS = new Set(["rz13", "rz14", "rz15", "rz16", "rz17", "rz18", "rz19", "rz20", "rz45", "rz46", "rz47"]);

export function runLekoScript(код: string, M: Measurements, P: Eases, inputValues?: Record<string, number>, imported?: Record<string, number | string>, settings?: RunSettings): ScriptResult {
  const { names, lineOf } = извлечьИмена(код);
  const returnObj = "{" + names.map((n) => `"${n}":${n}`).join(",") + "}";
  const opParams = OP_NAMES.join(", ");
  const pieces: Piece[] = [];
  // writePiece — как ЗАПИСАТЬ в Leko: деталь регистрируется, даже если результат никуда не присвоен
  const writePieceCollecting = (spec: PieceSpec): Piece => { const pc = writePiece(spec); pieces.push(pc); return pc; };
  // userInputs — пометка в коде: какие мерки и прибавки выводить пользователю (остальные видит только конструктор)
  let userInputsList: string[] | null = null;
  const userInputsCollecting = (keys: unknown): void => {
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
      throw new Error('userInputs: нужен список в кавычках, например userInputs(["rz13", "PK_31_33"])');
    }
    const known = new Set([...Object.keys(M), ...Object.keys(P)]);
    const bad = (keys as string[]).filter((k) => !known.has(k));
    if (bad.length) throw new Error(`userInputs: неизвестные параметры: ${bad.map((b) => "«" + b + "»").join(", ")}. Мерки называются rz13, rz40…, прибавки — PK_31_33, P_511_570…`);
    userInputsList = Array.from(new Set(userInputsList ? [...userInputsList, ...(keys as string[])] : (keys as string[])));
  };
  // input("имя", по_умолчанию) — параметр построения: то, что в Leko приходило снаружи (пар_16, рз_1, вид…).
  // Значение берётся из полей студии (inputValues) или, если там не задано, по умолчанию.
  const declaredInputs: ScriptInput[] = [];
  const inputCollecting = (name: unknown, def: unknown, meta?: unknown): number => {
    if (typeof name !== "string" || !name) throw new Error('input: первым аргументом нужно имя в кавычках, например input("пар_16", 5)');
    const d = typeof def === "number" && Number.isFinite(def) ? def : 0;
    const given = inputValues?.[name];
    const value = typeof given === "number" && Number.isFinite(given) ? given : d;
    if (!declaredInputs.some((i) => i.name === name)) {
      const m = (meta && typeof meta === "object" ? meta : {}) as { option?: unknown; title?: unknown; values?: unknown; hint?: unknown };
      const item: ScriptInput = { name, default: d, value };
      if (m.option === true) item.option = true;
      if (typeof m.title === "string") item.title = m.title;
      if (typeof m.hint === "string") item.hint = m.hint;
      if (Array.isArray(m.values)) item.values = m.values.filter((v) => typeof v === "number" || (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "string")) as ScriptInput["values"];
      declaredInputs.push(item);
    }
    return value;
  };
  // importValue("import_имя") — значение, которое отдал другой элемент изделия переменной export_имя; нет — undefined
  const askedImports: { name: string; found: boolean }[] = [];
  const importCollecting = (name: unknown): number | string | undefined => {
    if (typeof name !== "string" || !name) throw new Error('importValue: нужно имя в кавычках, например importValue("import_sleeve_width")');
    const ex = name.replace(/^import_/, "export_");
    let v = imported?.[ex] ?? imported?.[ex.replace(/opt_/g, "par_")]; // старые копии основы отдают export_par_N
    if (v === undefined && imported) { // в Leko регистр букв в именах не важен (П39 = п39)
      const lo = ex.toLowerCase(), lo2 = lo.replace(/opt_/g, "par_");
      for (const k of Object.keys(imported)) { const kl = k.toLowerCase(); if (kl === lo || kl === lo2) { v = imported[k]; break; } }
    }
    if (!askedImports.some((i) => i.name === name)) askedImports.push({ name, found: v !== undefined });
    return v;
  };
  // measure("rz16", по_умолчанию, "half") — мерка из набора мерок студии. Третий аргумент — в какой форме её ждёт построение:
  // "half" (ждёт половину обхвата, как после ОСТ Leko) или не задан (ждёт как есть / полный обхват). Студия сама пересчитывает полные ↔ половины.
  const measureOp = (name: unknown, def: unknown, expect?: unknown): number => {
    const d = typeof def === "number" ? def : 0;
    let v: unknown = typeof name === "string" ? (M as unknown as Record<string, unknown>)[name] : undefined;
    if (v === undefined && name === "rz1") v = settings?.height;
    if (v === undefined && name === "rz16") v = settings?.bust;
    if (typeof v !== "number" || !Number.isFinite(v)) return d;
    if (typeof name !== "string" || !GIRTH_KEYS.has(name)) return v;
    const have = settings?.girths === "half" ? "half" : "full";
    const want = expect === "half" ? "half" : "full";
    return have === want ? v : have === "full" ? v / 2 : v * 2;
  };
  const opArgs = OP_NAMES.map((n) => (n === "writePiece" ? writePieceCollecting : n === "userInputs" ? userInputsCollecting : n === "input" ? inputCollecting : n === "importValue" ? importCollecting : n === "measure" ? measureOp : (ops as Record<string, unknown>)[n]));

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "M", "P", opParams,
      `"use strict";\n${код}\nreturn (${returnObj});`
    );
    const переменные = fn(M, P, ...opArgs) as Record<string, unknown>;
    const exports: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(переменные)) if (/^export_/.test(k) && ((typeof v === "number" && Number.isFinite(v)) || typeof v === "string")) exports[k] = v;
    return { переменные, строки: lineOf, pieces, userInputs: userInputsList, inputs: declaredInputs, ошибка: null, exports, imports: askedImports };
  } catch (e) {
    return { переменные: {}, строки: lineOf, pieces, userInputs: userInputsList, inputs: declaredInputs, ошибка: { message: localizeError(e) }, exports: {}, imports: askedImports };
  }
}
