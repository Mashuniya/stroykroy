import * as ops from "./ops.js";
import { writePiece, type Piece, type PieceSpec } from "./piece.js";
import type { Measurements, Eases } from "../types.js";
import { localizeError } from "../error-i18n.js";

export interface ScriptError {
  message: string;
}
export interface ScriptResult {
  /** Все детали, записанные оператором writePiece (в том числе без присваивания переменной). */
  pieces: Piece[];
  /** Все переменные верхнего уровня скрипта (имя -> значение: point/segment/arc/polyline/число/...). */
  переменные: Record<string, unknown>;
  /** Имя переменной -> номер строки (считая с 0) в ИСХОДНОМ тексте скрипта, где она объявлена. Для связки чертёж ↔ код. */
  строки: Record<string, number>;
  ошибка: ScriptError | null;
}

/**
 * Имена операторов Leko, доступные внутри скрипта без префикса (ops.* разворачивается
 * в список параметров функции при исполнении — см. runLekoScript).
 */
const OP_NAMES = [...Object.keys(ops), "writePiece"];

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
      const m = RE_SIMPLE.exec(line) || RE_BARE.exec(line) || RE_ARRAY_DESTRUCTURE.exec(line);
      if (m && !names.has(m[1])) { names.add(m[1]); lineOf[m[1]] = i; }
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return { names: [...names], lineOf };
}

/**
 * Выполняет скрипт (JS-синтаксис, операторы Leko без префикса, мерки доступны
 * как M.rz7 и т.д.) и возвращает все переменные верхнего уровня для отрисовки.
 */
export function runLekoScript(код: string, M: Measurements, P: Eases): ScriptResult {
  const { names, lineOf } = извлечьИмена(код);
  const returnObj = "{" + names.map((n) => `"${n}":${n}`).join(",") + "}";
  const opParams = OP_NAMES.join(", ");
  const pieces: Piece[] = [];
  // writePiece — как ЗАПИСАТЬ в Leko: деталь регистрируется, даже если результат никуда не присвоен
  const writePieceCollecting = (spec: PieceSpec): Piece => { const pc = writePiece(spec); pieces.push(pc); return pc; };
  const opArgs = OP_NAMES.map((n) => (n === "writePiece" ? writePieceCollecting : (ops as Record<string, unknown>)[n]));

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "M", "P", opParams,
      `"use strict";\n${код}\nreturn (${returnObj});`
    );
    const переменные = fn(M, P, ...opArgs) as Record<string, unknown>;
    return { переменные, строки: lineOf, pieces, ошибка: null };
  } catch (e) {
    return { переменные: {}, строки: lineOf, pieces, ошибка: { message: localizeError(e) } };
  }
}
