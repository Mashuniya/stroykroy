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

/** Прибавка, которую может задать пользователь (в файле Leko — ease_*): диапазон, значение по умолчанию, текущее значение и размер в лекалах. */
/** Размер готового изделия, который строка spec(...) показывает покупателю: пересчитывается при каждом изменении (не редактируется). */
export interface ScriptSpec { name: string; title: string; value: number; unit: string }

export interface ScriptEase {
  name: string;
  title: string;
  unit?: string;
  /** Допустимый диапазон (null — в построении не вычислился). */
  min: number | null;
  max: number | null;
  /** Размер в лекалах (pattern_…) при текущем значении. */
  pattern: number | null;
  /** Значение, которое прибавка принимает, если пользователь её не задал. */
  default: number | null;
  /** Текущее значение (заданное пользователем или по умолчанию). */
  value: number | null;
  /** Задано пользователем. */
  set: boolean;
}

/**
 * Припуск, который может изменить пользователь. Какие припуски вообще бывают, решает построение: каждая переменная spec_<имя>_max
 * (spec_seam_allowance_max, spec_hem_max, spec_hem_poc_max, spec_hem_neck_max…) объявляет припуск <имя> с верхней границей max.
 */
export interface ScriptAllowance {
  /** Имя переменной припуска: seam_allowance, hem, hem_poc… */
  name: string;
  title: string;
  /** Допустимый диапазон: от 0 до значения spec_<имя>_max. */
  min: number;
  max: number;
  /** Значение, которое построение считает само (по умолчанию). */
  default: number | null;
  /** Текущее значение (заданное пользователем или по умолчанию). */
  value: number | null;
  /** Задано пользователем. */
  set: boolean;
}

export interface ScriptResult {
  /** Прибавки ease_*, объявленные оператором userEase. */
  eases: ScriptEase[];
  /** Припуски, которые пользователь может менять (по spec_*_max). */
  allowances: ScriptAllowance[];
  /** Размеры готового изделия, объявленные оператором spec(). */
  specs: ScriptSpec[];
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
const OP_NAMES = [...Object.keys(ops), "writePiece", "userInputs", "input", "importValue", "measure", "userEase", "userAllowance", "spec"];

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

/** Разбор текста скрипта дорог (сотни проверок по строкам), а текст при перестроении тот же — запоминаем результат. */
const NAMES_CACHE = new Map<string, ExtractedNames>();
function извлечьИмена(код: string): ExtractedNames {
  const hit = NAMES_CACHE.get(код);
  if (hit) return { names: [...hit.names], lineOf: { ...hit.lineOf } };
  const res = извлечьИменаБезКэша(код);
  if (NAMES_CACHE.size >= 64) NAMES_CACHE.delete(NAMES_CACHE.keys().next().value as string);
  NAMES_CACHE.set(код, res);
  return { names: [...res.names], lineOf: { ...res.lineOf } };
}

function извлечьИменаБезКэша(код: string): ExtractedNames {
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
export interface RunSettings { /** значения прибавок ease_* (имя → число), заданные пользователем */ easeValues?: Record<string, number>; /** значения припусков (hem, hem_poc…), заданные пользователем */ allowanceValues?: Record<string, number>; girths?: "full" | "half"; /** рост, см (рз_1) */ height?: number; /** обхват груди третий, см (рз_16, в той же форме, что и остальные обхваты) */ bust?: number }
/** Понятные названия припусков для покупателя (по имени переменной в построении). */
export const ALLOWANCE_TITLES: Record<string, string> = {
  seam_allowance: "Припуск на швы",
  hem: "Припуск на подгиб низа",
  hem_poc: "Припуск на подгиб кармана",
  hem_neck: "Припуск горловины",
  hem_top: "Припуск верхнего среза",
  hem_armh: "Припуск проймы",
  hem_should: "Припуск плеча",
  hem_waist: "Припуск талии",
  seam_allowance_p: "Припуск на швы (боковые срезы)",
  seam_allowance_poc: "Припуск на швы кармана",
};

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
  // userEase("ease_X", {title, pattern, consumer, unit}) — прибавка, которую пользователь может задать; не задана — undefined (в Leko: существует(ease_X) ложно)
  const easeDefs: { name: string; meta: { title?: string; pattern?: string; consumer?: string; unit?: string } }[] = [];
  const userEaseOp = (name: unknown, meta?: unknown): number | undefined => {
    if (typeof name !== "string" || !name) throw new Error('userEase: нужно имя в кавычках, например userEase("ease_shoulder_width")');
    easeDefs.push({ name, meta: (meta && typeof meta === "object" ? meta : {}) as { title?: string; pattern?: string; consumer?: string; unit?: string } });
    const v = settings?.easeValues?.[name];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  // userAllowance("hem", {title}) — припуск, который пользователь может задать; не задан — undefined (в Leko: существует(hem) ложно),
  // и построение считает его само. Диапазон берётся из переменной spec_<имя>_max.
  const allowanceDefs: { name: string; title?: string }[] = [];
  const userAllowanceOp = (name: unknown, meta?: unknown): number | undefined => {
    if (typeof name !== "string" || !name) throw new Error('userAllowance: нужно имя в кавычках, например userAllowance("hem")');
    const m = (meta && typeof meta === "object" ? meta : {}) as { title?: string };
    if (!allowanceDefs.some((d) => d.name === name)) allowanceDefs.push({ name, title: m.title });
    const v = settings?.allowanceValues?.[name];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  // spec("имя", "Название", значение, "см") — размер готового изделия для показа (результат расчёта прибавок); возвращает значение
  const specList: ScriptSpec[] = [];
  const specOp = (name: unknown, title: unknown, value: unknown, unit?: unknown): unknown => {
    if (typeof name !== "string" || !name || typeof title !== "string") throw new Error('spec: нужны имя и название в кавычках, например spec("bust_width", "Обхват изделия по груди", 2*t37.x, "см")');
    if (typeof value === "number" && Number.isFinite(value)) {
      const i = specList.findIndex((x) => x.name === name);
      const it = { name, title, value, unit: typeof unit === "string" ? unit : "см" };
      if (i >= 0) specList[i] = it; else specList.push(it);
    }
    return value;
  };
  const opArgs = OP_NAMES.map((n) => (n === "writePiece" ? writePieceCollecting : n === "userInputs" ? userInputsCollecting : n === "input" ? inputCollecting : n === "importValue" ? importCollecting : n === "measure" ? measureOp : n === "userEase" ? userEaseOp : n === "userAllowance" ? userAllowanceOp : n === "spec" ? specOp : (ops as Record<string, unknown>)[n]));

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "M", "P", opParams,
      `"use strict";\n${код}\nreturn (${returnObj});`
    );
    const переменные = fn(M, P, ...opArgs) as Record<string, unknown>;
    const exports: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(переменные)) if (/^export_/.test(k) && ((typeof v === "number" && Number.isFinite(v)) || typeof v === "string")) exports[k] = v;
    const numOf = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const eases: ScriptEase[] = easeDefs.map(({ name, meta }) => {
      const given = settings?.easeValues?.[name];
      const set = typeof given === "number" && Number.isFinite(given);
      const cons = meta.consumer ? numOf(переменные[meta.consumer]) : null;
      const e: ScriptEase = {
        name, title: meta.title ?? name, min: numOf(переменные[name + "_min"]), max: numOf(переменные[name + "_max"]),
        pattern: meta.pattern ? numOf(переменные[meta.pattern]) : null, default: set ? null : cons, value: set ? given : cons, set,
      };
      if (meta.unit) e.unit = meta.unit;
      return e;
    });
    // Припуски: по переменным spec_<имя>_max. Основной припуск на швы приходит параметром seam_allowance, остальные — через userAllowance
    const allowances: ScriptAllowance[] = [];
    for (const [k, v] of Object.entries(переменные)) {
      const mm = /^spec_(.+)_max$/.exec(k);
      const max = numOf(v);
      if (!mm || max === null || max <= 0) continue;
      const name = mm[1];
      if (name === "seam_allowance") {
        const inp = declaredInputs.find((i) => i.name === "seam_allowance");
        if (!inp) continue;
        const given = inputValues?.seam_allowance;
        allowances.push({ name, title: ALLOWANCE_TITLES[name] ?? name, min: 0, max, default: inp.default, value: inp.value, set: typeof given === "number" && Number.isFinite(given) });
        continue;
      }
      const def = allowanceDefs.find((d) => d.name === name);
      if (!def) continue; // построение не умеет принимать этот припуск снаружи
      const given = settings?.allowanceValues?.[name];
      const set = typeof given === "number" && Number.isFinite(given);
      const own = numOf(переменные[name]);
      allowances.push({ name, title: def.title ?? ALLOWANCE_TITLES[name] ?? name, min: 0, max, default: set ? null : own, value: own, set });
    }
    return { eases, allowances, specs: specList, переменные, строки: lineOf, pieces, userInputs: userInputsList, inputs: declaredInputs, ошибка: null, exports, imports: askedImports };
  } catch (e) {
    return { eases: [], allowances: [], specs: [], переменные: {}, строки: lineOf, pieces, userInputs: userInputsList, inputs: declaredInputs, ошибка: { message: localizeError(e) }, exports: {}, imports: askedImports };
  }
}
