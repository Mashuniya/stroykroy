import { SWEATSHIRT_SCRIPT } from "./builtinSweatshirt";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  DEFAULT_MEASUREMENTS_W_164_96_104,
  DEFAULT_EASES,
  leko,
  MEASUREMENT_INFO, MEASUREMENT_ORDER, EASE_INFO, USER_EASE_GROUPS,
  STANDARD_FIGURE_GROUPS, getStandardFigure, findStandardFigure,
  type Measurements,
  type Eases,
} from "@stroykroy/pattern-engine";
import NumberField from "./NumberField.js";
import { readUserInputs, writeUserInputs } from "./userInputs.js";
import {
  loadConstructions, saveConstructions, loadSelectedId, saveSelectedId,
  createConstruction, guessKind, ELEMENT_ROLES, SECTIONS, CATEGORY_HINTS, KIND_TITLES, type SavedConstruction, type ElementKind,
} from "./constructions.js";
import { runChain } from "./chain.js";
import Catalog, { allowedElements } from "./Catalog.js";
import StepsEditor from "./StepsEditor.js";
import { dragXf, rotateXf, rotationStep, ZERO_XF, type Xf } from "./pieceMove.js";

const EMPTY_XF: Record<string, Xf> = {};
const EMKO_BUILTIN_ID = "emko-dress-builtin";
const SWEAT_BUILTIN_ID = "wsw210-sweatshirt-builtin";
const EMKO_DRESS_SCRIPT = `// ЕМКО СЭВ — базовая конструкция платья (спинка + перед), группа «Ж».
// Перенесено 1:1 из формул таблицы 7 методики (это то самое построение,
// что раньше было в отдельной вкладке «Формулы ЕМКО»). Мерки M.rz7...rz57
// и прибавки P.* — смотрите/правьте во вкладке «Мерки и прибавки».
//
// Что показывать пользователю — это пробный чертёж: все мерки и основные прибавки.
// Меняйте галочками во вкладке «Мерки и прибавки» или прямо здесь.
userInputs([
  "rz7", "rz9", "rz12", "rz13", "rz14", "rz15",
  "rz18", "rz19", "rz34", "rz35", "rz36", "rz38",
  "rz39", "rz40", "rz44", "rz45", "rz46", "rz47",
  "rz57",
  "PK_31_33", "PK_33_35", "PK_35_37", "P_411_470", "P_511_570"
]);

// Небольшой помощник: строит дугу по центру/радиусу через две точки на ней —
// всегда КОРОТКИМ путём (не более 180°). Без этой нормализации угла на стыке
// +180/-180 дуга иногда "улетала" в обход круга длинным путём — именно это
// и давало на чертеже то, что выглядело как прямые линии не в тех местах.
function arcThrough(center, radius, from, to) {
  const a1 = Math.atan2(from.y - center.y, from.x - center.x) * 180 / Math.PI;
  const a2raw = Math.atan2(to.y - center.y, to.x - center.x) * 180 / Math.PI;
  let diff = a2raw - a1;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return arc(center, radius, a1, a1 + diff);
}

// Из двух точек пересечения берёт правую (с большим x) — это "вправо" из таблицы ЕМКО.
function rightOf(a, b) { return a.x > b.x ? a : b; }
// То же для "вверх" (меньше y — выше на чертеже) и "влево".
function upperOf(a, b) { return a.y < b.y ? a : b; }
function leftOf(a, b) { return a.x < b.x ? a : b; }

// --- Сетка (спинка) ---
const t11 = point(0, 0);
const t31 = point(0, M.rz39 + P.P_11_31);                          // линия груди (Г)
const t41 = point(0, M.rz40 + P.P_11_41);                          // линия талии (Т)
const t51 = point(0, t41.y + 0.65*(M.rz7 - M.rz12) + P.P_41_51);   // линия бёдер (Б)

// --- Ширина по линии груди ---
const w3133 = 0.5*M.rz47 + P.PK_31_33;
const w3335 = M.rz57 + P.PK_33_35;
const w3537 = 0.5*(M.rz45 + M.rz15 - P.a8 - M.rz14) + P.PK_35_37;
const t33 = point(w3133, t31.y);
const t35 = point(w3133 + w3335, t31.y);
const t37 = point(w3133 + w3335 + w3537, t31.y);

// --- Перед: своя вертикаль от t37 ---
const t47 = point(t37.x, t31.y + (M.rz40 - M.rz39) + P.P_37_47);
const t57 = point(t37.x, t47.y + 0.65*(M.rz7 - M.rz12) + P.P_47_57);

// --- Пройма: вершины и глубина ---
const t13 = point(t33.x, t31.y - (0.49*M.rz38 + P.P_33_13));
const t15 = point(t35.x, t31.y - (0.43*M.rz38 + P.P_35_15));
const t331 = point(t33.x, t31.y + P.P_depth);
const t351 = point(t35.x, t31.y + P.P_depth);

// --- Нижняя дуга проймы — спинка ---
const L17 = 0.62*w3335 + P.a17;
const t341 = point(t33.x + L17, t331.y);
const L19 = 0.62*w3335 + P.a19;
const t332 = point(t33.x, t331.y - L19);

// --- Нижняя дуга проймы — перед ---
const L18 = 0.38*w3335 - P.a18;
const t341p = point(t35.x - L18, t351.y);
const L21 = 0.38*w3335 - P.a21;
const t352 = point(t35.x, t351.y - L21);

// --- Горловина и плечо спинки ---
const w1112 = 0.18*M.rz13 + P.P_neck_w;
const t12 = point(w1112, 0);
const h12121 = 0.07*M.rz13 + P.P_neck_d;
const t121 = point(w1112, -h12121);

// Строка 30: t14 — на дуге из t13 (центр t332, радиус |t332-t13|), в 3.5-0.08*rz47
// вправо от t13 (по хорде дуги).
const seg1314 = 3.5 - 0.08*M.rz47;
const t14 = rightOf(intersectCircles(t13, seg1314, t332, dist(t332, t13), 1), intersectCircles(t13, seg1314, t332, dist(t332, t13), -1));


// --- Вытачка на выпуклость лопаток ---
const t32 = point(0.17*M.rz47 + 0.5*P.PK_31_33, t31.y); // строка 32: 0.17·Т47+П, где П = 0.5·ПК31-33 (по книге 31-32 = 6.90)
const t122 = point(t121.x + P.k31*(t14.x - t121.x), t121.y + P.k31*(t14.y - t121.y));
const t22 = point((t122.x + t32.x)/2, (t122.y + t32.y)/2);
const [t122p] = rotate([t122], t22, -P.beta34);

// Строка 35: t14p ("14'") — пересечение дуги (центр t122, радиус |t122p-t14|) с
// дугой из t13 (центр t332, радиус |t332-t13|), вправо.
const t14p = rightOf(intersectCircles(t122, dist(t122p, t14), t332, dist(t332, t13), 1), intersectCircles(t122, dist(t122p, t14), t332, dist(t332, t13), -1));
// Строки 36/36.1: t141 — пересечение дуг (центр t22, радиус |t22-t14p|) и
// (центр t121, радиус |t121-t14|), вправо; прямая
// t121-t141 пересекает продолжение t22-t122p в точке t123p (левый край вытачки на плече).
const t141 = rightOf(intersectCircles(t22, dist(t22, t14p), t121, dist(t121, t14), 1), intersectCircles(t22, dist(t22, t14p), t121, dist(t121, t14), -1));
const t123p = intersectDirections(t121, seg(t121, t141).angle1, t22, seg(t22, t122p).angle1);
// Строка 37: t123 — правый край вытачки на плече: на продолжении t22-t122 на расстоянии |t22-t123p|.
const t123 = layOff(t22, seg(t22, t122).angle1, dist(t22, t123p));

// --- Оформление линии горловины спинки (строки 28, 38-40; рис.17) ---
const t112 = point(0.25*w1112, 0);                                              // строка 28: 11-112 = 0.25·/11-12/
const t113 = intersectDirections(t11, 90, t121, seg(t123p, t121).angle1);       // строка 38.1: вертикаль из t11 ∩ продолжение /123'-121/
const t114 = upperOf(intersectCircles(t121, dist(t121, t113) - P.a39, t112, dist(t121, t113) - P.a39, 1), intersectCircles(t121, dist(t121, t113) - P.a39, t112, dist(t121, t113) - P.a39, -1)); // строки 39, 39.1 — центр дуги горловины
const dNeckBack = arcThrough(t114, dist(t121, t113) - P.a39, t121, t112);       // строка 40: дуга от 121 до 112, дальше прямая 112-11
const segNeckBk = segment(t112, t11);

// --- Перед, группа Ж (строки 45-54 табл.7; рис.19-20) ---
// Выступ живота и вытачка на живот (строки 44 и 46) в книге есть только для
// групп М, Ма, Д1-2 — у Ж их нет, центр груди откладывается прямо от средней
// линии переда (строка 45: 47-46 = 0.5*Т46+П).
const t46 = point(t47.x - (0.5*M.rz46 + 0.5*P.PK_35_37), t47.y);    // строка 45: 0.5·Т46+П, где П = 0.5·ПК35-37
const t36 = point(t46.x, t46.y - (M.rz36 - M.rz35));               // строка 47: вверх по вертикали
const t371 = point(t36.x + dist(t47, t46), t36.y);                 // строка 48: 36-371 = 47-46, вправо

// --- Вытачка на выпуклость груди (строки 49-50.2) ---
const r49 = M.rz35 - M.rz34 + 0.5*P.PK_35_37;                     // строка 49 (прибавка по примечанию: П36-372 = 0.5·П35-37)
const t372 = point(t36.x + r49, t36.y);
const w501 = 0.5*(M.rz15 - P.a8 - M.rz14) - 0.25*P.PK_35_37;       // строка 50.1: ширина вытачки
const t372p = upperOf(intersectCircles(t36, r49, t372, w501, 1), intersectCircles(t36, r49, t372, w501, -1)); // вверх по хорде дуги из t372
const t371p = layOff(t36, seg(t36, t372p).angle1, dist(t36, t371)); // строка 50.2: на продолжении t36-t372p

// --- Горловина и плечо переда (строки 51-54) ---
const w361 = 0.18*M.rz13 + P.P_necklineF_w;                        // строка 51
const t361 = layOff(t371p, seg(t371p, t36).angle1, w361);           // влево по /371'-36/
const r3616 = M.rz44 - (M.rz40 + 0.07*M.rz13) - (M.rz36 - M.rz35);  // строка 52 (Ж)
const t16 = upperOf(intersectCircleDirection(t36, r3616, t361, seg(t36, t371p).angle1 - 90, 1), intersectCircleDirection(t36, r3616, t361, seg(t36, t371p).angle1 - 90, -1)); // дуга вверх до перпендикуляра из t361
const t14pp = leftOf(intersectCircles(t16, dist(t121, t14), t352, dist(t352, t15), 1), intersectCircles(t16, dist(t121, t14), t352, dist(t352, t15), -1)); // строка 53: дуга влево до дуги из t15 (центр t352)
const h54 = 0.205*M.rz13;
const t161 = layOff(t16, seg(t16, t361).angle1, h54);               // строка 54: вниз по /16-361/
const t17 = intersectDirections(t161, seg(t36, t371p).angle1, t371p, seg(t36, t371p).angle1 - 90); // строка 54: из t161 вправо ⊥ до ⊥ из t371p

// --- Линия горловины переда (строки 55-57) ---
// t171: вверх по продолжению /371'-17/ до продолжения /14''-16/; радиус дуги = |t16-t171| - а56
// (а56 в примечаниях книги не уточнена — пока 0, т.е. радиус просто |t16-t171|).
const t171 = intersectDirections(t17, seg(t36, t371p).angle1 - 90, t14pp, seg(t14pp, t16).angle1);
const t172 = upperOf(intersectCircles(t16, dist(t16, t171), t17, dist(t16, t171), 1), intersectCircles(t16, dist(t16, t171), t17, dist(t16, t171), -1)); // центр дуги горловины
const dNeckFr = arcThrough(t172, dist(t16, t171), t16, t17);


// --- Средняя линия спинки, низ и боковой шов (строки 1, 2, 12, 23-26; боковой шов — по строке 17) ---
const t21 = point(0, 0.3*M.rz40 + P.P_11_21);                          // строка 2: линия лопаток
const t411 = point(P.O_center, t41.y);                                  // строка 24: отведение средней линии на талии (О41)
const t511 = point(P.O_center, t51.y);                                  // строка 25: на линии бёдер (О51)
const t91 = point(0, M.rz40 + (M.rz7 - M.rz9) + P.P_11_91);             // строка 1: низ спинки (платье)
const t911 = point(P.O_center, t91.y);                                  // строка 26: на линии низа (О91)
const t97 = point(t37.x, t47.y + (M.rz7 - M.rz9) + P.P_47_97);          // строка 12: низ переда (платье)
// Боковой шов (строка 17): вертикаль вниз из t341 до уровней талии, бёдер и низа.
const t441 = point(t341.x, t41.y);
const t541 = point(t341.x, t51.y);
const t941 = point(t341.x, t91.y);
const t441p = point(t341p.x, t47.y);
const t541p = point(t341p.x, t57.y);
const t941p = point(t341p.x, t97.y);

// --- Ширина изделия по талии и бёдрам (строки 61-62) ---
const t470 = point(t411.x + 0.5*M.rz18 + P.P_411_470, t41.y);           // строка 61: /470-47/ — сумма вытачек по талии
const t570 = point(t511.x + 0.5*M.rz19 + P.P_511_570, t51.y);           // строка 62: /570-57/ — разница ширин по бёдрам и груди
const sumWaist = t47.x - t470.x;
const sumHip = t57.x - t570.x;

// --- Контуры (для наглядности) ---
const plCtrBk = polyline(t11, t21, t411, t511, t911);                   // средняя линия спинки (строка 26)
const plSideBk = polyline(t341, t441, t541, t941);                      // боковой шов спинки
const plSideFr = polyline(t341p, t441p, t541p, t941p);                  // боковой шов переда
const plHemBk = polyline(t911, t941);                                   // низ спинки
const plHemFr = polyline(t941p, t97);                                   // низ переда
const plShBk = polyline(t121, t123p, t22, t123, t14p);                  // плечо спинки с вытачкой на лопатки
const plShFr = polyline(t16, t14pp);                                    // плечо переда
const plCtrFr = polyline(t17, t371p, t36, t371, t47, t57, t97);         // средняя линия переда с вытачкой на грудь
const segWaist = segment(t411, t470);                                   // ширина по талии (вспомогательная)
const segHip = segment(t511, t570);                                     // ширина по бёдрам (вспомогательная)

// --- Линии проймы: сплайны вместо дуг (дуги плохо градуируются на больших размерах) ---
// Касательные — по книге: в точках стыка верха и низа (t332, t352) вертикальные
// (центры нижних дуг 342 и 343 лежат на одной горизонтали с ними), в нижних точках
// касания (t341, t341p) — "угол бокового шва +90°" = горизонталь (боковой шов, строка 17,
// вертикален и направлен вверх: -90° + 90° = 0°). Коэффициенты k подобраны так, чтобы
// сплайн ложился на дугу из самой книги (строки 20-22 и 41-43, 58-60): нижняя спинки — 0.36,
// нижняя переда — 0.44, верх переда — 0.37 (отклонение от книжной дуги 0.6-2 мм); верх
// спинки оставлен вашим k=0.1 (по книге подошло бы 0.45 — дуга чуть круче).
const shoulderAngleBack = seg(t123, t14p).angle1;                        // кусок плеча со стороны проймы — прямая t123-t14p (строка 37)
const chordBackUpper = seg(t14p, t332).angle1;
const sArmBkUp = splineK(t14p, t332, shoulderAngleBack + 90, chordBackUpper - 12, 0.1);
const sArmBkLw = splineK(t332, t341, chordBackUpper - 12, seg(t441, t341).angle1 + 90, 0.36);

const shoulderAngleFront = seg(t16, t14pp).angle1;
const sArmFrUp = splineK(t352, t14pp, -90, shoulderAngleFront + 90, 0.37);
const sArmFrLw = splineK(t341p, t352, seg(t441p, t341p).angle1 + 90, -90, 0.44);

// --- Детали (writePiece — аналог ЗАПИСАТЬ): контур, внутренние линии, метки, надсечки, припуски ---
// ⚠ Припуски (1 см на швы, 4 см на подгиб) взяты для примера. Боковые швы и вытачки по талии ещё не
// оформлены (сумму вытачек распределяет конструктор), поэтому деталь пока "заготовка".
const pieceBack = writePiece({
  name: "Спинка",
  contour: [t11, t112, reverseLine(dNeckBack), t121, t123p, t22, t123, t14p, sArmBkUp, sArmBkLw, t341, t441, t541, t941, t911, t511, t411, t21],
  inner: [[t411, t441], [t511, t541]],                    // линии талии и бёдер
  notches: [t332, t441, t541],
  grain: [point(14, 60), 90],
  allowance: 1,
  allowanceZones: [[t123p, 0, 0, t123], [t941, 4, 4, t911]],  // без припуска вдоль вытачки; подгиб 4 см
  color: 11,
  fabric: "MAIN FABRIC",
});
const pieceFront = writePiece({
  name: "Перед",
  contour: [t14pp, t16, dNeckFr, t17, t371p, t36, t371, t47, t57, t97, t941p, t541p, t441p, t341p, sArmFrLw, sArmFrUp],
  inner: [[t47, t441p], [t57, t541p]],
  marks: [[3, 0, 1, 1, t36]],                              // крестик в центре груди
  notches: [t352, t441p, t541p],
  grain: [point(44, 70), 90],
  allowance: 1,
  allowanceZones: [[t371p, 0, 0, t371], [t97, 4, 4, t941p]],
  color: 12,
  fabric: "MAIN FABRIC",
});
`;

const STARTER_SCRIPT = `// Пишете как в ваших .rb/.ALG файлах, но на JS-синтаксисе.
// Каждая "const имя = ..." становится видимой точкой/линией на чертеже.
// Мерки доступны как M.rz7, M.rz13 и т.д. Операторы — без префикса.

const a0 = point(0, 0);
const t = point(a0.x, a0.y + M.rz40);  // уровень талии
const b = point(t.x, t.y + 19);         // уровень бёдер (упрощённо, для примера)
const g1 = point(a0.x + 0.33*M.rz13 + 1, a0.y); // ширина ростка (пример)

const shoulder = segment(a0, g1);
const side = segment(a0, b);
`;

interface OperatorDoc {
  name: string;
  description: string;
  /** base=null → оператор вставляется как есть (выражение), без "const имя = ". */
  varBase: string | null;
  /** Необязательный суффикс после номера (например "s" для зеркальных точек: t1s, t2s... — как в Leko была приписка к имени при симметрии). */
  varSuffix?: string;
  template: (varName: string) => string;
}

const OPERATOR_DOCS: OperatorDoc[] = [
  { name: "point", varBase: "t", description: "Точка по двум координатам (x, y).", template: (v) => `const ${v} = point(0, 0);` },
  { name: "segment", varBase: "seg", description: "Отрезок между двумя точками. Поля: .p1, .p2, .angle1 (угол от p1 к p2), .angle2 (направление в конце, у отрезка = angle1), .length.", template: (v) => `const ${v} = segment(t1, t2);` },
  { name: "seg", varBase: "seg", description: "То же, что segment — короткая запись для разового использования, напр. seg(a,b).length.", template: (v) => `const ${v} = seg(t1, t2);` },
  { name: "dist", varBase: "len", description: "Расстояние между двумя точками (просто число).", template: (v) => `const ${v} = dist(t1, t2);` },
  { name: "arc", varBase: "d", description: "Дуга: центр, радиус, начальный и конечный угол в градусах.", template: (v) => `const ${v} = arc(tCenter, radius, 0, 90);` },
  { name: "polyline", varBase: "pl", description: "Ломаная — объединяет точки/отрезки/дуги в одну непрерывную линию.", template: (v) => `const ${v} = polyline(t1, t2, t3);` },
  { name: "splineK", varBase: "s", description: "Плавная кривая через 2 точки с углами касательных на концах и коэффициентом выпуклости k (0 = прямая).", template: (v) => `const ${v} = splineK(t1, t2, 0, 90, 1);` },
  { name: "splineKK", varBase: "s", description: "Как splineK, но с отдельным коэффициентом асимметрии k2 (k2=1 — то же самое, что splineK).", template: (v) => `const ${v} = splineKK(t1, t2, 0, 90, 1, 1);` },
  { name: "reverseLine", varBase: "rev", description: "Разворачивает направление линии (как знак \"-\" перед линией в Leko).", template: (v) => `const ${v} = reverseLine(line);` },
  { name: "layOff", varBase: "t", description: "От точки под углом (°) отложить расстояние — новая точка. Можно и цепочкой: layOff(t, [[angle1,d1],[angle2,d2]]).", template: (v) => `const ${v} = layOff(t1, 0, 10);` },
  { name: "layOffAlong", varBase: "t", description: "Отложить расстояние вдоль дуги/сплайна/ломаной (от начала).", template: (v) => `const ${v} = layOffAlong(line, 5);` },
  { name: "split", varBase: "sp", description: "Делит линию точкой на заданном расстоянии от начала. Возвращает {point, part1, part2}.", template: (v) => `const ${v} = split(line, 5);` },
  { name: "splitByDirection", varBase: "sp", description: "Делит линию точкой пересечения с направлением (точка + угол).", template: (v) => `const ${v} = splitByDirection(line, t1, 90);` },
  { name: "canSplitByDirection", varBase: "can", description: "Проверка \"получится ли разделить\" направлением, без самого деления (для if/else).", template: (v) => `const ${v} = canSplitByDirection(line, t1, 90);` },
  { name: "intersect", varBase: "t", description: "Пересечение двух линий (отрезок/дуга/ломаная) как геометрических объектов.", template: (v) => `const ${v} = intersect(line1, line2);` },
  { name: "intersectDirections", varBase: "t", description: "Пересечение двух направлений: точка+угол и точка+угол.", template: (v) => `const ${v} = intersectDirections(t1, 0, t2, 90);` },
  { name: "intersectCircles", varBase: "t", description: "Пересечение двух окружностей. Последний параметр (1 или -1) выбирает одну из двух точек.", template: (v) => `const ${v} = intersectCircles(tC1, r1, tC2, r2, 1);` },
  { name: "intersectCircleDirection", varBase: "t", description: "Пересечение окружности и направления. Последний параметр (1 или -1) выбирает точку.", template: (v) => `const ${v} = intersectCircleDirection(tC1, r1, t1, 0, 1);` },
  { name: "filletArc", varBase: "d", description: "Дуга заданного радиуса, плавно сопрягающая две линии (точка+угол, точка+угол, радиус).", template: (v) => `const ${v} = filletArc(t1, 0, t2, 90, 5);` },
  { name: "mirror", varBase: "t", varSuffix: "s", description: "Осевая симметрия списка точек относительно отрезка (оси). Имя результата получает суффикс \"s\" (t1 → t1s), как в Leko при зеркальном отражении.", template: (v) => `const [${v}] = mirror([t1], axisSegment);` },
  { name: "mirrorPoint", varBase: "t", varSuffix: "s", description: "Центральная симметрия списка точек относительно точки. Имя результата получает суффикс \"s\" (t1 → t1s), как в Leko при зеркальном отражении.", template: (v) => `const [${v}] = mirrorPoint([t1], tCenter);` },
  { name: "translate", varBase: "t", description: "Параллельный перенос списка точек на вектор (отрезок или точка).", template: (v) => `const [${v}] = translate([t1], vector);` },
  { name: "rotate", varBase: "t", description: "Поворот списка точек вокруг центра на угол (°).", template: (v) => `const [${v}] = rotate([t1], tCenter, 90);` },
  { name: "sizeFn", varBase: "k", description: "Табличная линейная интерполяция по размеру (с экстраполяцией за краями таблицы).", template: (v) => `const ${v} = sizeFn(M.rz16, [[80, 0.01], [100, 0.05]]);` },
  { name: "equal", varBase: null, description: "Сравнение \"равно\" (округляет оба числа до целого, как в Leko).", template: () => `equal(a, b)` },
  { name: "greater", varBase: null, description: "Сравнение \"больше\" (без округления).", template: () => `greater(a, b)` },
  { name: "less", varBase: null, description: "Сравнение \"меньше\" (без округления).", template: () => `less(a, b)` },
  { name: "greaterR", varBase: null, description: "Сравнение \"больше\" с округлением до целого.", template: () => `greaterR(a, b)` },
  { name: "lessR", varBase: null, description: "Сравнение \"меньше\" с округлением до целого.", template: () => `lessR(a, b)` },
  { name: "angleAt", varBase: "ang", description: "Угол при вершине tB треугольника tA-tB-tC, в градусах.", template: (v) => `const ${v} = angleAt(tA, tB, tC);` },
  { name: "exists", varBase: null, description: "Проверка, что значение задано (не undefined). Параметр нужно объявить заранее как let.", template: () => `exists(par)` },
  { name: "fit", varBase: "fitted", description: "Переносит/поворачивает/масштабирует фигуру так, чтобы её 2 опорные точки легли на 2 целевые точки.", template: (v) => `const ${v} = fit(shape, tShape1, tShape2, tTarget1, tTarget2);` },
  { name: "label", varBase: "lbl", description: "Внутренняя метка на лекале: центр, тип (1=отрезок, 2=прямоугольник, 3=крестик, 4=Т, 5=крестовина, 6=уголок, 7=треугольник, 8=Н), угол, длина, ширина.", template: (v) => `const ${v} = label(tCenter, 2, 0, 2, 1);` },
  { name: "userInputs", varBase: null, description: "Пометка: какие мерки и прибавки показывать пользователю (остальные видит только конструктор). Ключи — как в M и P: мерки rz13, rz40…, прибавки PK_31_33, P_511_570… Галочки во вкладке «Мерки и прибавки» правят этот же оператор.", template: () => `userInputs(["rz13", "rz18", "rz19", "P_511_570"]);` },
  { name: "writePiece", varBase: "piece", description: "Записать деталь (как ЗАПИСАТЬ в Leko): контур, внутренние линии, метки, надсечки, долевая, припуски на швы — общий и по участкам. Направление контура не важно; линию в обратную сторону — reverseLine(линия). Можно вызывать и без присваивания.", template: (v) => `const ${v} = writePiece({\n  name: "DETAIL",\n  contour: [t1, t2, t3],\n  inner: [[t1, t3]],\n  marks: [[2, 0, 2, 1, t2]],\n  notches: [t2],\n  grain: [t1, 90],\n  allowance: 1,\n  allowanceZones: [[t1, 4, 4, t2]],\n  color: 11,\n});` },
  { name: "outline", varBase: "out", description: "Собирает готовый контур в замкнутую линию для отрисовки отдельно от вспомогательных построений.", template: (v) => `const ${v} = outline("имя", t1, t2, t3);` },
  { name: "ABS", varBase: null, description: "Модуль (абсолютное значение) числа.", template: () => `ABS(x)` },
  { name: "ATAN", varBase: null, description: "Арктангенс, результат в градусах.", template: () => `ATAN(x)` },
  { name: "COS", varBase: null, description: "Косинус угла, заданного в градусах.", template: () => `COS(angle)` },
  { name: "SIN", varBase: null, description: "Синус угла, заданного в градусах.", template: () => `SIN(angle)` },
  { name: "EXP", varBase: null, description: "Экспонента.", template: () => `EXP(x)` },
  { name: "LN", varBase: null, description: "Натуральный логарифм.", template: () => `LN(x)` },
  { name: "ROUND", varBase: null, description: "Округление до ближайшего целого.", template: () => `ROUND(x)` },
  { name: "SQRT", varBase: null, description: "Квадратный корень.", template: () => `SQRT(x)` },
  { name: "SQR", varBase: null, description: "Квадрат числа.", template: () => `SQR(x)` },
  { name: "TRUNC", varBase: null, description: "Отбрасывание дробной части.", template: () => `TRUNC(x)` },
];

const OP_DESCRIPTIONS: Record<string, string> = Object.fromEntries(OPERATOR_DOCS.map((o) => [o.name, o.description]));

/** Подбирает свободное имя переменной вида base+номер(+suffix), которого ещё нет в тексте скрипта. */
function freeVarName(base: string, script: string, suffix = ""): string {
  let n = 1;
  while (new RegExp(`\\b${base}${n}${suffix}\\b`).test(script)) n++;
  return `${base}${n}${suffix}`;
}

/** Что за объект — для подписи в выпадающем списке совпавших элементов. */
function kindOfVar(v: unknown): string {
  if (typeof v === "number") return "число";
  if (!v || typeof v !== "object") return "значение";
  const o = v as Record<string, unknown>;
  if (o.kind === "piece") return "деталь";
  if ("center" in o && "radius" in o) return "дуга";
  if (Array.isArray(o.points)) return "ломаная/сплайн";
  if ("p1" in o && "p2" in o) return "отрезок";
  if (typeof o.x === "number" && typeof o.y === "number") return "точка";
  return "значение";
}

/** Границы [начало, конец) строки с номером lineIndex (считая с 0) в тексте. */
function lineBounds(text: string, lineIndex: number): [number, number] {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < lineIndex; i++) start += lines[i].length + 1; // +1 за "\n"
  const end = start + (lines[lineIndex]?.length ?? 0);
  return [start, end];
}

/** Номер строки (с 0), на которой стоит курсор, по смещению символа в тексте. */
function lineAtOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length - 1;
}

export default function App() {
  const [tab, setTab] = useState<"script" | "measurements" | "catalog">("script");
  const [M, setM] = useState<Measurements>({ ...DEFAULT_MEASUREMENTS_W_164_96_104 });
  const [P, setP] = useState<Eases>({ ...DEFAULT_EASES });

  // --- Построения (несколько именованных скриптов, хранятся в localStorage браузера) ---
  const [constructions, setConstructions] = useState<SavedConstruction[]>(() => {
    const saved = loadConstructions();
    const emkoBuiltin: SavedConstruction = { id: EMKO_BUILTIN_ID, name: "ЕМКО СЭВ — платье", script: EMKO_DRESS_SCRIPT };
    // свитшот добавляется в список один раз (если удалить — не вернётся)
    const sweat: SavedConstruction = { id: SWEAT_BUILTIN_ID, name: "Свитшот женский (WSW210, из Leko)", script: SWEATSHIRT_SCRIPT };
    let seeded = false;
    try { seeded = localStorage.getItem("stroykroy.sweatSeeded2") === "1"; } catch { /* без хранилища — просто добавим */ }
    const extra = seeded || saved.some((c) => c.id === SWEAT_BUILTIN_ID) ? [] : [sweat];
    if (saved.length === 0) return [emkoBuiltin, ...extra, createConstruction("Новое построение", STARTER_SCRIPT)];
    if (!saved.some((c) => c.id === EMKO_BUILTIN_ID)) return [emkoBuiltin, ...saved, ...extra];
    return [...saved, ...extra];
  });
  const [currentId, setCurrentId] = useState<string>(() => {
    const saved = loadConstructions();
    const selected = loadSelectedId();
    if (selected && saved.some((c) => c.id === selected)) return selected;
    return saved.length > 0 ? saved[0].id : constructions[0].id;
  });
  const current = constructions.find((c) => c.id === currentId) ?? constructions[0];
  const script = current.script;

  useEffect(() => { saveConstructions(constructions); try { localStorage.setItem("stroykroy.sweatSeeded2", "1"); } catch { /* ok */ } }, [constructions]);
  useEffect(() => { saveSelectedId(currentId); }, [currentId]);

  function setScript(next: string) {
    setConstructions((prev) => prev.map((c) => (c.id === currentId ? { ...c, script: next } : c)));
  }
  function insertOperator(op: OperatorDoc) {
    const varName = op.varBase ? freeVarName(op.varBase, script, op.varSuffix ?? "") : "";
    const line = op.template(varName);
    // Вставляем новой строкой ниже той, где стоит курсор (если курсор не ставили — в конец кода).
    const caret = caretRef.current;
    let at = script.length;
    if (caret !== null && caret <= script.length) { const e = script.indexOf("\n", caret); at = e < 0 ? script.length : e; }
    pendingSelect.current = { start: at + 1, end: at + 1 + line.length };
    setScript(script.slice(0, at) + "\n" + line + script.slice(at));
  }
  function addConstruction() {
    const name = window.prompt("Название нового построения (например, имя модели):", "Новое построение");
    if (!name) return;
    const c = createConstruction(name, STARTER_SCRIPT);
    setConstructions((prev) => [...prev, c]);
    setCurrentId(c.id);
  }
  async function importAlg(file: File) {
    try {
      const text = leko.decodeAlg(new Uint8Array(await file.arrayBuffer()));
      const res = leko.algToScript(text, { title: file.name, inputsAsConstants: true });
      const c = createConstruction(file.name.replace(/\.alg$/i, ""), res.script);
      const kind = guessKind(file.name);
      if (kind !== "base") c.kind = kind;
      setConstructions((prev) => {
        const next = [...prev, c];
        if (kind === "base") return next;
        // новый элемент сразу подключаем к основе: к текущей, если это основа, иначе к первой
        const target = (current.kind ?? "base") === "base" ? current.id : (prev.find((x) => (x.kind ?? "base") === "base")?.id ?? "");
        return next.map((x) => (x.id === target ? { ...x, attached: { ...(x.attached ?? {}), [kind]: c.id } } : x));
      });
      setCurrentId(c.id);
      setTab("script");
      showNotice(`Файл ${file.name} переведён на наш язык (${res.stats.statements} операторов, записей деталей: ${res.stats.pieces}; при выбранных параметрах строится меньше).` + (res.warnings.length ? ` Замечаний: ${res.warnings.length} — они в начале кода.` : ""));
    } catch (e) {
      alert("Не удалось перевести файл: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  function renameConstruction() {
    const name = window.prompt("Новое название построения:", current.name);
    if (!name) return;
    setConstructions((prev) => prev.map((c) => (c.id === currentId ? { ...c, name } : c)));
  }
  function deleteConstruction() {
    if (constructions.length <= 1) { alert("Нельзя удалить последнее построение."); return; }
    if (!window.confirm(`Удалить построение "${current.name}"? Это необратимо.`)) return;
    const rest = constructions.filter((c) => c.id !== currentId);
    setConstructions(rest);
    setCurrentId(rest[0].id);
  }
  function updateBuiltinToLatest() {
    if (!window.confirm("Заменить текущий текст этого построения на последнюю встроенную версию? Все ваши правки в нём будут потеряны.")) return;
    setConstructions((prev) => prev.map((c) => (c.id === EMKO_BUILTIN_ID ? { ...c, script: EMKO_DRESS_SCRIPT } : c)));
  }

  const scriptWarnings = useMemo(
    () => script.split("\n")
      .filter((l) => l.includes("⚠"))
      .map((l) => l.slice(l.indexOf("⚠")).trim()), // отбрасываем код перед комментарием — оставляем только сам текст
    [script]
  );

  // значения входных параметров построения (input("имя", по_умолчанию)) — отдельно для каждого построения
  const [inputVals, setInputVals] = useState<Record<string, Record<string, number>>>({});
  const curInputs = inputVals[currentId];
  const [openOpt, setOpenOpt] = useState<string | null>(null); // какая опция раскрыта в полоске справа
  function setInputValue(name: string, v: number, id: string = currentId) {
    setInputVals((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [name]: v } }));
  }
  // Изделие собирается из элементов: основа + рукав + воротник… Основа отдаёт export_*, элементы принимают import_* (chain.ts)
  const chain = useMemo(() => runChain(constructions, current, M, P, inputVals), [constructions, current, M, P, inputVals]);
  const scriptResult = useMemo(() => ({ ...chain.own, pieces: chain.pieces }), [chain]);
  const curKind: ElementKind = current.kind ?? "base";
  function patchCurrent(patch: Partial<SavedConstruction>) {
    setConstructions((prev) => prev.map((c) => (c.id === currentId ? { ...c, ...patch } : c)));
  }
  function setSlot(kind: string, id: string) {
    const next = { ...(current.attached ?? {}) };
    if (id) next[kind] = id; else delete next[kind];
    patchCurrent({ attached: next });
  }
  function openFromCatalog(baseId: string, picked: Record<string, string>) {
    setConstructions((prev) => prev.map((c) => (c.id === baseId ? { ...c, attached: picked } : c)));
    setCurrentId(baseId);
    setUserView(true);
    setTab("measurements");
  }
  function publishCatalog() {
    const bases = constructions.filter((c) => (c.kind ?? "base") === "base" && c.category);
    const products = bases.map((b) => {
      const elements: Record<string, { id: string; name: string; script: string }[]> = {};
      for (const r of ELEMENT_ROLES) {
        const list = allowedElements(constructions, b, r.kind);
        if (list.length) elements[r.kind] = list.map((e) => ({ id: e.id, name: e.name, script: e.script }));
      }
      return { id: b.id, name: b.name, section: b.section ?? "Женская одежда", category: b.category, script: b.script, elements, defaultElements: b.attached ?? {} };
    });
    if (products.length === 0) { window.alert("В каталог попадают модели, у которых указана категория (блок «В каталоге» на вкладке «Скрипт»)."); return; }
    const blob = new Blob([JSON.stringify({ format: "stroykroy-catalog", version: 1, exportedAt: new Date().toISOString(), products }, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "stroykroy-catalog.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showNotice(`Файл каталога: моделей ${products.length}.`);
  }
  // Опции для правой полоски: свои + опции подключённых элементов (у каждой группы свой владелец — id построения)
  const optionGroups = useMemo(() => {
    const g: { id: string; title: string | null; inputs: typeof chain.own.inputs }[] = [{ id: currentId, title: null, inputs: chain.own.inputs.filter((i) => i.option) }];
    for (const e of chain.elements) g.push({ id: e.c.id, title: `${e.role}: ${e.c.name}`, inputs: e.result.inputs.filter((i) => i.option) });
    return g.filter((x) => x.inputs.length > 0);
  }, [chain, currentId]);
  const elementCandidates = (kind: string) => allowedElements(constructions, current, kind);
  const showSidePanel = optionGroups.length > 0 || curKind === "base" && constructions.some((c) => (c.kind ?? "base") !== "base") || curKind !== "base";

  const [zoom, setZoom] = useState(1);
  const baseScale = useMemo(() => leko.autoFitScale(scriptResult.переменные, { pieces: scriptResult.pieces }), [scriptResult]);

  // --- Положение деталей на листе (только вид — на построение и текст скрипта не влияет) ---
  const [pieceXf, setPieceXf] = useState<Record<string, Record<string, Xf>>>({}); // id построения → ключ детали → смещение/поворот
  const xfNow = pieceXf[currentId] ?? EMPTY_XF;
  const pieceKeyList = useMemo(() => leko.pieceKeys(scriptResult.pieces), [scriptResult]);
  const [grab, setGrab] = useState<{ key: string; mx: number; my: number; start: Xf } | null>(null);
  const dropRef = useRef(false); // деталь только что положена нажатием кнопки — следующий за ним клик игнорируем
  const hasPieces = scriptResult.pieces.length > 0;
  const figure = useMemo(() => findStandardFigure(M), [M]); // null — мерки менялись вручную

  // --- Пометки «что показывать пользователю»: хранятся в коде оператором userInputs([...]) ---
  const [userView, setUserView] = useState(false); // вкладка «Мерки и прибавки» глазами пользователя
  const marked = useMemo(() => readUserInputs(script), [script]);                        // null — оператора нет, значит показывается всё
  const ALL_FIELD_KEYS: string[] = useMemo(() => [...MEASUREMENT_ORDER, ...USER_EASE_GROUPS.flatMap((g) => g.keys)], []);
  const isMarked = (k: string) => (marked === null ? true : marked.includes(k));
  function toggleMark(k: string) {
    const cur = marked ?? ALL_FIELD_KEYS;
    const next = ALL_FIELD_KEYS.filter((x) => (x === k ? !cur.includes(k) : cur.includes(x)));
    // сохраняем отметки о параметрах, которых нет в списке вкладки (например, свободные члены, помеченные вручную)
    const extra = cur.filter((x) => !ALL_FIELD_KEYS.includes(x));
    setScript(writeUserInputs(script, [...next, ...extra]));
  }

  const [activeEase, setActiveEase] = useState<string | null>(null); // какая прибавка сейчас правится — её участок подсвечивается на чертеже
  const [notice, setNotice] = useState<string | null>(null);        // сообщение о том, что сделано с файлом при выгрузке
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showNotice(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 12000);
  }
  const FIELD = 320; // поле вокруг чертежа, px — чтобы деталь можно было унести
  // Припуски на швы: показывать на чертеже и выгружать в PDF/DXF (выбор запоминается в браузере)
  const [showAllowance, setShowAllowance] = useState<boolean>(() => {
    try { return localStorage.getItem("stroykroy.showAllowance") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("stroykroy.showAllowance", showAllowance ? "1" : "0"); } catch { /* хранилище недоступно — не страшно */ }
  }, [showAllowance]);

  const highlights = useMemo(() => {
    const info = activeEase ? EASE_INFO[activeEase as keyof Eases] : undefined;
    if (!info?.segments) return undefined;
    const v = scriptResult.переменные as Record<string, { x?: number; y?: number } | undefined>;
    const segs = info.segments
      .map(([a, b]) => [v[a], v[b]] as const)
      .filter(([p, q]) => p && q && typeof p.x === "number" && typeof q.x === "number") as unknown as [{ x: number; y: number }, { x: number; y: number }][];
    return segs.length ? { segments: segs, label: info.name } : undefined;
  }, [activeEase, scriptResult]);

  const scriptSvg = useMemo(
    () => leko.renderScriptSvg(scriptResult.переменные, {
      showLabels: true, scale: baseScale * zoom, pieces: scriptResult.pieces,
      pieceTransforms: xfNow, activePiece: grab?.key ?? null, margin: hasPieces ? FIELD : 0, showAllowance,
      showPoints: userView ? "contour" : true, highlights,
    }),
    [scriptResult, baseScale, zoom, xfNow, grab?.key, hasPieces, showAllowance, userView, highlights]
  );

  // --- Скачивание: PDF в натуральную величину, PDF по листам A4, DXF. Положение деталей и припуски — как на экране ---
  function downloadFile(kind: "pdf" | "pdfA4" | "dxf" | "dxfClo") {
    try {
      const cname = constructions.find((c) => c.id === currentId)?.name ?? "stroykroy";
      const opts = { allowance: showAllowance, transforms: xfNow, title: cname };
      const base = cname.replace(/[^\wА-Яа-яЁё .-]+/g, "_").trim() || "stroykroy";
      let blob: Blob, file: string;
      // что сделаем с файлом: разложим наложившиеся детали, притупим острые концы вытачек (для CLO3D)
      const info = leko.exportLayoutInfo(scriptResult.pieces, { ...opts, target: kind === "dxfClo" ? "clo" : "cad" });
      const said: string[] = [];
      if (info.overlapped) said.push("Детали накладывались друг на друга — в файле они разложены в ряд с зазором 2 см");
      if (info.blunted > 0) said.push(`острые концы вытачек (${info.blunted}) притуплены до 6 мм`);
      if (said.length) showNotice(`Файл «${kind === "dxfClo" ? "DXF для CLO3D" : kind === "dxf" ? "DXF" : "PDF"}»: ${said.join("; ")}.`);
      if (kind === "dxfClo") { blob = new Blob([leko.exportDxf(scriptResult.pieces, { ...opts, target: "clo" })], { type: "application/dxf" }); file = `${base} CLO3D.dxf`; }
      else if (kind === "dxf") { blob = new Blob([leko.exportDxf(scriptResult.pieces, opts)], { type: "application/dxf" }); file = `${base}.dxf`; }
      else if (kind === "pdf") { blob = new Blob([leko.exportPdf(scriptResult.pieces, opts) as unknown as BlobPart], { type: "application/pdf" }); file = `${base} 1-1.pdf`; }
      else { blob = new Blob([leko.exportPdfA4(scriptResult.pieces, opts) as unknown as BlobPart], { type: "application/pdf" }); file = `${base} A4.pdf`; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      window.alert("Не удалось сформировать файл: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  // --- Связка чертёж ↔ код: клик по элементу чертежа находит строку в коде, и наоборот ---
  const [editorView, setEditorView] = useState<"steps" | "code">("steps"); // «Шаги» — строки с полями; «Код (JS)» — обычный текст
  const stepsRootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<number | null>(null);            // где стоит курсор в тексте кода — сюда вставляются заготовки
  const pendingSelect = useRef<{ start: number; end: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null); // невидимый "двойник" текста — для точного измерения, где строка окажется на экране (с учётом переноса длинных строк)
  const canvasRef = useRef<HTMLDivElement>(null);
  const [highlightedVar, setHighlightedVar] = useState<string | null>(null);
  const [pickMenu, setPickMenu] = useState<{ x: number; y: number; names: string[] } | null>(null);
  const pickMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickMenu) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setPickMenu(null); };
    const onDown = (ev: MouseEvent) => { if (!pickMenuRef.current?.contains(ev.target as Node)) setPickMenu(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [pickMenu]);

  /** Прокручивает textarea так, чтобы символ на позиции offset оказался по центру видимой области. Учитывает перенос длинных строк (в отличие от простого умножения на высоту строки). */
  function scrollTextareaToOffset(offset: number) {
    const ta = textareaRef.current, mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.style.width = ta.clientWidth + "px";
    mirror.textContent = ta.value.slice(0, offset);
    const marker = document.createElement("span");
    marker.textContent = "|";
    mirror.appendChild(marker);
    const markerTop = marker.offsetTop;
    mirror.removeChild(marker);
    ta.scrollTop = Math.max(0, markerTop - ta.clientHeight / 2);
  }

  const varByLine = useMemo(() => {
    const m: Record<number, string> = {};
    for (const [name, line] of Object.entries(scriptResult.строки)) m[line] = name;
    return m;
  }, [scriptResult.строки]);

  function handleTextareaCursor() {
    const ta = textareaRef.current;
    if (!ta) return;
    caretRef.current = ta.selectionStart;
    const line = lineAtOffset(ta.value, ta.selectionStart);
    const varName = varByLine[line];
    setHighlightedVar(varName ?? null);
  }

  // Выделить переменную: подсветить на чертеже и показать её строку в коде
  function jumpToVar(varName: string) {
    setHighlightedVar(varName);
    if (editorView === "steps") {
      const el = stepsRootRef.current?.querySelector(`[data-step-var="${varName}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const line = scriptResult.строки[varName];
    if (line === undefined) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const [start, end] = lineBounds(script, line);
    ta.focus();
    ta.setSelectionRange(start, end);
    scrollTextareaToOffset(start);
  }

  // Клик по чертежу: берём ВСЕ элементы под курсором. Один — сразу в код; несколько (совпавшие точки
  // и проходящие рядом линии) — выпадающий список, чтобы выбрать нужный.
  function setXf(key: string, f: (prev: Xf) => Xf) {
    setPieceXf((all) => {
      const mine = all[currentId] ?? EMPTY_XF;
      return { ...all, [currentId]: { ...mine, [key]: f(mine[key] ?? ZERO_XF) } };
    });
  }

  function handleCanvasClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (dropRef.current) return; // это отпускание кнопки после укладки детали
    // Деталь всё ещё держится (на случай, если нажатие не поймали) — клик кладёт её на место.
    if (grab) { setGrab(null); return; }
    // Клик по крупной точке в центре детали — взять деталь.
    const handle = (e.target as Element).closest("[data-piece-index]");
    if (handle) {
      const key = pieceKeyList[Number(handle.getAttribute("data-piece-index"))];
      if (key) {
        setPickMenu(null);
        setGrab({ key, mx: e.clientX, my: e.clientY, start: xfNow[key] ?? ZERO_XF });
        return;
      }
    }
    const root = canvasRef.current;
    const names: string[] = [];
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const g = el.closest("[data-var]");
      if (!g || !root || !root.contains(g)) continue;
      const n = g.getAttribute("data-var");
      if (n && !names.includes(n)) names.push(n);
    }
    if (names.length === 0) { setPickMenu(null); return; }
    if (names.length === 1) { setPickMenu(null); jumpToVar(names[0]); return; }
    // точки — первыми (их обычно и ищут), дальше линии и детали
    const isPt = (n: string) => kindOfVar(scriptResult.переменные[n]) === "точка";
    names.sort((a, b) => Number(isPt(b)) - Number(isPt(a)));
    setPickMenu({ x: e.clientX, y: e.clientY, names });
  }

  // Пока деталь "прилипла": следует за курсором; ←/→ поворачивают (Shift — 10°, Alt — 0.1°); Enter — положить; Esc — вернуть как было.
  useEffect(() => {
    if (!grab) return;
    const scale = baseScale * zoom;
    let raf = 0, lastX = grab.mx, lastY = grab.my;
    const apply = () => {
      raf = 0;
      setXf(grab.key, (cur) => ({ ...dragXf(grab.start, lastX - grab.mx, lastY - grab.my, scale), angle: cur.angle }));
    };
    const onMove = (ev: MouseEvent) => { lastX = ev.clientX; lastY = ev.clientY; if (!raf) raf = requestAnimationFrame(apply); };
    const onKey = (ev: KeyboardEvent) => {
      const step = rotationStep(ev.key, ev.shiftKey, ev.altKey);
      if (step !== 0) { ev.preventDefault(); setXf(grab.key, (cur) => rotateXf(cur, step)); }
      else if (ev.key === "Escape") { ev.preventDefault(); setXf(grab.key, () => grab.start); setGrab(null); }
      else if (ev.key === "Enter") { ev.preventDefault(); setGrab(null); }
    };
    const onDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      dropRef.current = true;
      setTimeout(() => { dropRef.current = false; }, 300);
      setGrab(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grab, baseScale, zoom, currentId]);

  // Когда впервые появились детали, у чертежа появилось поле вокруг — сдвигаем прокрутку, чтобы чертёж остался на виду.
  const scrolledFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    const root = canvasRef.current;
    if (!root || !hasPieces || scrolledFor.current.has(currentId)) return;
    scrolledFor.current.add(currentId);
    root.scrollTo(FIELD, FIELD);
  }, [hasPieces, currentId, scriptSvg]);

  useEffect(() => {
    const p = pendingSelect.current;
    if (!p) return;
    pendingSelect.current = null;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(p.start, p.end);
    caretRef.current = p.end;
    scrollTextareaToOffset(p.start);
  }, [script]);

  // Подсветка найденного элемента прямо в SVG (сам SVG вставлен как сырой HTML, поэтому — через DOM напрямую)
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const items = root.querySelectorAll<SVGGElement>(".sv-item");
    items.forEach((item) => {
      const isHighlighted = item.getAttribute("data-var") === highlightedVar;
      const marks = item.querySelectorAll<SVGElement>(".sv-mark");
      marks.forEach((mark) => {
        // исходные цвет и толщина берём из самого чертежа (у линий построения — серый, у контура детали — цвет детали)
        if (mark.tagName === "circle") {
          if (!mark.hasAttribute("data-r0")) { mark.setAttribute("data-r0", mark.getAttribute("r") ?? "2.2"); mark.setAttribute("data-f0", mark.getAttribute("fill") ?? "#2f6f4f"); }
          mark.setAttribute("fill", isHighlighted ? "#c0392b" : mark.getAttribute("data-f0")!);
          mark.setAttribute("r", isHighlighted ? "4.5" : mark.getAttribute("data-r0")!);
        } else {
          if (!mark.hasAttribute("data-s0")) { mark.setAttribute("data-s0", mark.getAttribute("stroke") ?? "#8d9a94"); mark.setAttribute("data-w0", mark.getAttribute("stroke-width") ?? "1.1"); }
          mark.setAttribute("stroke", isHighlighted ? "#c0392b" : mark.getAttribute("data-s0")!);
          mark.setAttribute("stroke-width", isHighlighted ? String(Number(mark.getAttribute("data-w0")) + 1.6) : mark.getAttribute("data-w0")!);
        }
      });
    });
  }, [highlightedVar, scriptSvg]);

  // --- Ширина окон: левая колонка и правая полоска «Опции» тянутся мышью за границу (запоминается в браузере) ---
  const [leftW, setLeftW] = useState<number>(() => { try { return Number(localStorage.getItem("stroykroy.leftW")) || 420; } catch { return 420; } });
  const [rightW, setRightW] = useState<number>(() => { try { return Number(localStorage.getItem("stroykroy.rightW")) || 210; } catch { return 210; } });
  useEffect(() => { try { localStorage.setItem("stroykroy.leftW", String(leftW)); localStorage.setItem("stroykroy.rightW", String(rightW)); } catch { /* ok */ } }, [leftW, rightW]);
  function dragWidth(e: ReactMouseEvent, start: number, sign: 1 | -1, min: number, max: number, set: (w: number) => void) {
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: MouseEvent) => set(Math.max(min, Math.min(max, start + sign * (ev.clientX - x0))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${leftW}px 6px minmax(0, 1fr)`, height: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ padding: 16, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={() => setTab("script")} style={{ fontWeight: tab === "script" ? "bold" : "normal" }}>
            Скрипт
          </button>
          <button onClick={() => setTab("measurements")} style={{ fontWeight: tab === "measurements" ? "bold" : "normal" }}>
            Мерки и прибавки
          </button>
          <button data-tab="catalog" onClick={() => setTab("catalog")} style={{ fontWeight: tab === "catalog" ? "bold" : "normal" }} title="Как каталог выглядит на сайте: раздел → категория → модель → дополнения">
            Каталог
          </button>
        </div>

        {tab === "catalog" && (
          <>
            <Catalog list={constructions} onOpen={openFromCatalog} />
            <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #dfe8e2" }}>
              <button data-publish onClick={publishCatalog} style={{ fontSize: 12.5 }} title="Один файл со всеми моделями каталога, их элементами и текстами построений — его будет читать сайт">⬇ Файл каталога для сайта (.json)</button>
            </div>
          </>
        )}

        {tab === "measurements" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "#2f6f4f", fontWeight: 600, display: "block", marginBottom: 3 }}>
                Типовая фигура женщин (ОСТ 17-326-81)
              </label>
              <select
                data-figure-select value={figure?.id ?? ""}
                onChange={(e) => { const f = getStandardFigure(e.target.value); if (f) setM({ ...f.measurements }); }}
                style={{ width: "100%", fontSize: 13, padding: "4px 6px", borderRadius: 4, border: "1px solid #c7d6cd" }}
              >
                <option value="" disabled={figure !== null}>{figure ? "— выберите другую —" : "Свои мерки (изменены вручную)"}</option>
                {STANDARD_FIGURE_GROUPS.map((g) => (
                  <optgroup key={g.group} label={`${g.title} — ${g.figures.length} фигур`}>
                    {g.figures.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
                  </optgroup>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "#5a6b62", marginTop: 3 }}>
                {figure
                  ? <>Рост {figure.height} см, обхват груди {figure.bust} см, обхват бёдер {figure.hips} см · таблица {figure.table} ОСТ. Обозначение: рост-грудь-бёдра.</>
                  : <>Выберите типовую фигуру — все мерки ниже заполнятся по стандарту; потом любую можно поправить.</>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#5a6b62" }}>Вид:</span>
              <button onClick={() => setUserView(false)} style={{ fontWeight: !userView ? "bold" : "normal" }}>Конструктор</button>
              <button onClick={() => setUserView(true)} style={{ fontWeight: userView ? "bold" : "normal" }} title="Только то, что отмечено галочками, — как увидит пользователь">Пользователь</button>
            </div>
            {!userView ? (
              <p style={{ fontSize: 11.5, color: "#5a6b62", marginTop: 0 }}>
                Размерные признаки по ЕМКО СЭВ (типовая женская фигура 164-96-104). Меняйте значения — чертёж перестраивается.
                <b> Галочка слева</b> — показывать это поле пользователю; пометка записывается в код оператором <code>userInputs([...])</code>
                и её можно править в «Скрипте».{marked === null && " Сейчас в коде пометок нет — пользователю показывается всё."}
              </p>
            ) : (
              <p style={{ fontSize: 11.5, color: "#5a6b62", marginTop: 0 }}>
                Так форму увидит пользователь: только помеченные поля. {marked !== null && `Отмечено: ${marked.filter((k) => ALL_FIELD_KEYS.includes(k)).length}.`}
              </p>
            )}
            {(() => {
              const mk = (k: string) => (userView ? undefined : { checked: isMarked(k), onToggle: () => toggleMark(k) });
              const measures = MEASUREMENT_ORDER.filter((k) => !userView || isMarked(k));
              const groups = USER_EASE_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => !userView || isMarked(k)) })).filter((g) => g.keys.length > 0);
              if (userView && measures.length === 0 && groups.length === 0) {
                return <p style={{ fontSize: 12, color: "#8a5a2a" }}>Ничего не отмечено — пользователь не увидит ни одного поля. Отметьте нужные галочками на виде «Конструктор».</p>;
              }
              return (
                <>
                  {measures.length > 0 && <h2 style={{ fontSize: 13, color: "#2f6f4f" }}>Мерки, см</h2>}
                  {measures.map((k) => (
                    <NumberField
                      key={k} label={MEASUREMENT_INFO[k].name} code={userView ? undefined : `Т${MEASUREMENT_INFO[k].number} · ${k}`}
                      value={M[k]} onChange={(v) => setM({ ...M, [k]: v })} mark={mk(k)}
                    />
                  ))}
                  {groups.map((g) => (
                    <div key={g.title}>
                      <h2 style={{ fontSize: 13, color: "#2f6f4f" }}>{g.title}, см</h2>
                      {g.keys.map((k) => (
                        <NumberField
                          key={k} label={EASE_INFO[k]!.name} code={userView ? undefined : EASE_INFO[k]!.hint}
                          value={P[k]} onChange={(v) => setP({ ...P, [k]: v })} mark={mk(k)}
                          onActive={(on) => setActiveEase((cur) => (on ? k : cur === k ? null : cur))}
                        />
                      ))}
                    </div>
                  ))}
                </>
              );
            })()}
            <button
              onClick={() => {
                setM({ ...DEFAULT_MEASUREMENTS_W_164_96_104 }); setP({ ...DEFAULT_EASES });
                setInputVals((prev) => { const n = { ...prev }; delete n[currentId]; return n; }); // и опции построения
              }}
              style={{ marginTop: 12, fontSize: 12 }}
            >
              ↺ вернуть значения по умолчанию
            </button>
          </>
        )}

        {tab === "script" && (
          <>
            <div style={{ fontSize: 11, color: "#5a6b62", marginBottom: 4 }}>Построение:</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <select
                value={currentId}
                onChange={(e) => setCurrentId(e.target.value)}
                style={{ flex: 1, fontSize: 12.5, padding: "4px 6px", borderRadius: 4, border: "1px solid #c7d6cd" }}
              >
                {constructions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button onClick={addConstruction} title="Новое построение">+ новое</button>
              <label style={{ cursor: "pointer", fontSize: 12.5, padding: "3px 8px", border: "1px solid #c7d6cd", borderRadius: 4, background: "#f4f7f5" }} title="Перевести файл .ALG (язык Leko) на наш язык и открыть как новое построение">
                ⇪ Импорт .ALG
                <input type="file" accept=".alg,.ALG" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importAlg(f); e.target.value = ""; }} />
              </label>
            </div>
            {scriptResult.inputs.some((i) => !i.option) && (
              <details style={{ marginBottom: 8, border: "1px solid #c7d6cd", borderRadius: 4, padding: "4px 8px", background: "#f9fbfa" }}>
                <summary style={{ fontSize: 12, cursor: "pointer", fontWeight: "bold" }}>Параметры построения ({scriptResult.inputs.filter((i) => !i.option).length})</summary>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
                  {scriptResult.inputs.filter((i) => !i.option).map((inp) => (
                    <label key={inp.name} style={{ fontSize: 11.5, display: "flex", justifyContent: "space-between", gap: 4, alignItems: "center" }}>
                      <span title={`по умолчанию ${inp.default}`}>{inp.name}</span>
                      <input type="number" step="any" value={inp.value} style={{ width: 62 }}
                        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setInputVals((prev) => ({ ...prev, [currentId]: { ...(prev[currentId] ?? {}), [inp.name]: v } })); }} />
                    </label>
                  ))}
                </div>
                {curInputs && <button style={{ fontSize: 11, marginTop: 6 }} onClick={() => setInputVals((prev) => { const n = { ...prev }; delete n[currentId]; return n; })}>↺ вернуть значения по умолчанию</button>}
              </details>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }} title="Основа — само изделие; рукав, воротник и т.п. — элементы, которые подключаются к основе и получают от неё длины срезов (export_/import_)">
                Это:
                <select data-kind value={curKind} onChange={(e) => { const k = e.target.value as ElementKind; patchCurrent({ kind: k === "base" ? undefined : k }); }} style={{ fontSize: 11.5 }}>
                  {(Object.keys(KIND_TITLES) as ElementKind[]).map((k) => <option key={k} value={k}>{KIND_TITLES[k]}</option>)}
                </select>
              </label>
              <button onClick={renameConstruction} style={{ fontSize: 11.5 }}>✎ переименовать</button>
              <button onClick={deleteConstruction} style={{ fontSize: 11.5 }}>✕ удалить</button>
              {currentId === EMKO_BUILTIN_ID && (
                <button onClick={updateBuiltinToLatest} style={{ fontSize: 11.5 }} title="Заменить на последнюю версию встроенного построения ЕМКО СЭВ (правки будут потеряны)">
                  ⟳ обновить до последней версии
                </button>
              )}
            </div>

            {curKind === "base" && (
              <details data-panel="catalog-meta" style={{ marginBottom: 8, border: "1px solid #c7d6cd", borderRadius: 4, padding: "4px 8px", background: "#f9fbfa" }}>
                <summary style={{ fontSize: 12, cursor: "pointer", fontWeight: "bold" }}>В каталоге{current.category ? `: ${current.section ?? SECTIONS[0]} › ${current.category}` : " (не указано)"}</summary>
                <div style={{ display: "grid", gap: 6, marginTop: 6, fontSize: 11.5 }}>
                  <label>Раздел
                    <select data-meta="section" value={current.section ?? SECTIONS[0]} onChange={(e) => patchCurrent({ section: e.target.value })} style={{ width: "100%", fontSize: 12 }}>
                      {SECTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                  <label>Категория
                    <input data-meta="category" list="cat-hints" value={current.category ?? ""} placeholder="например, Свитшоты" onChange={(e) => patchCurrent({ category: e.target.value })} style={{ width: "100%", boxSizing: "border-box", fontSize: 12 }} />
                    <datalist id="cat-hints">{CATEGORY_HINTS.map((x) => <option key={x} value={x} />)}</datalist>
                  </label>
                  {ELEMENT_ROLES.map((r) => {
                    const all = constructions.filter((c) => c.kind === r.kind);
                    if (all.length === 0) return null;
                    const sel = current.allowed?.[r.kind] ?? [];
                    return (
                      <div key={r.kind}>
                        <div style={{ color: "#5a6b62" }}>{r.title} — что можно выбрать на сайте {sel.length === 0 && "(сейчас: любой)"}</div>
                        {all.map((c) => (
                          <label key={c.id} style={{ display: "block" }}>
                            <input type="checkbox" data-allowed={r.kind + ":" + c.id} checked={sel.includes(c.id)}
                              onChange={(e) => patchCurrent({ allowed: { ...(current.allowed ?? {}), [r.kind]: e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id) } })} /> {c.name}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#5a6b62" }}>Вид:</span>
              <button onClick={() => setEditorView("steps")} style={{ fontWeight: editorView === "steps" ? "bold" : "normal" }}>Шаги</button>
              <button onClick={() => setEditorView("code")} style={{ fontWeight: editorView === "code" ? "bold" : "normal" }}>Код (JS)</button>
            </div>
            {editorView === "steps" ? (
              null
            ) : (
              <p style={{ fontSize: 11.5, color: "#5a6b62" }}>
                Пишете как в ваших <code>.rb</code>/<code>.ALG</code>-файлах, но на JS-синтаксисе
                (<code>const имя = ...;</code> вместо <code>имя:=...;</code>, обычные <code>if/else</code> вместо{" "}
                <code>если/то/иначе</code>). Каждая переменная верхнего уровня становится видимой на чертеже
                автоматически. Мерки — <code>M.rz7</code>, <code>M.rz13</code> и т.д.
              </p>
            )}
            {scriptWarnings.length > 0 && (
              <div style={{ marginBottom: 8, background: "#fdecea", border: "1px solid #c0392b", borderRadius: 4, padding: "7px 9px" }}>
                <div style={{ fontSize: 11.5, fontWeight: "bold", color: "#c0392b", marginBottom: 4 }}>
                  ⚠ Отмеченные в коде проблемные места ({scriptWarnings.length}):
                </div>
                {scriptWarnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#8a2a1f", fontFamily: "monospace", lineHeight: 1.5 }}>{w}</div>
                ))}
              </div>
            )}
            {editorView === "steps" && (
              <StepsEditor
                script={script} setScript={setScript} highlightedVar={highlightedVar} setHighlightedVar={setHighlightedVar}
                varNames={Object.keys(scriptResult.переменные)} descriptions={OP_DESCRIPTIONS} rootRef={stepsRootRef}
              />
            )}
            {editorView === "code" && (
              <>
            <style>{`
              .leko-script-editor::selection { background: #ffd966; color: #1f2d28; }
            `}</style>
            <div
              ref={mirrorRef}
              aria-hidden="true"
              style={{
                position: "absolute", top: -99999, left: -99999, visibility: "hidden",
                whiteSpace: "pre-wrap", wordWrap: "break-word", overflowWrap: "break-word",
                fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.5,
                padding: 8, boxSizing: "border-box", border: "1px solid transparent",
              }}
            />
            <textarea
              ref={textareaRef}
              className="leko-script-editor"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              onClick={handleTextareaCursor}
              onKeyUp={handleTextareaCursor}
              onSelect={handleTextareaCursor}
              spellCheck={false}
              style={{
                width: "100%", minHeight: 480, fontFamily: "monospace", fontSize: 12.5,
                border: scriptResult.ошибка ? "1px solid #c0392b" : "1px solid #c7d6cd",
                borderRadius: 4, padding: 8, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box",
              }}
            />
              </>
            )}
            {scriptResult.ошибка && (
              <div style={{ marginTop: 8, background: "#f7ecdd", borderLeft: "3px solid #8a5a2a", padding: "7px 9px", fontSize: 12 }}>
                ⚠ {scriptResult.ошибка.message}
              </div>
            )}
            {scriptResult.pieces.length > 0 && (
              <p style={{ fontSize: 11, color: "#2f6f4f", marginTop: 4 }}>
                Детали (writePiece): {scriptResult.pieces.map((pc) => `${pc.name} — ${pc.area.toFixed(0)} см²`).join("; ")}
              </p>
            )}
            {editorView === "code" && (
            <details open style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 11.5, cursor: "pointer", color: "#2f6f4f" }}>Доступные операторы</summary>
              <p style={{ fontSize: 10.5, color: "#5a6b62", margin: "4px 0 6px" }}>
                Клик — вставить заготовку строкой ниже того места, где стоит курсор (она выделится — сразу правьте значения). Наведите — подсказка, что оператор делает.
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
                {OPERATOR_DOCS.map((op) => (
                  <li key={op.name}>
                    <button
                      onClick={() => insertOperator(op)}
                      title={op.description}
                      style={{
                        fontFamily: "monospace", fontSize: 11.5, padding: "2px 7px",
                        background: "#eef3f0", border: "1px solid #c7d6cd", borderRadius: 3, cursor: "pointer",
                      }}
                    >
                      {op.name}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
            )}
          </>
        )}
      </div>
      <div data-resize="left" onMouseDown={(e) => dragWidth(e, leftW, 1, 280, 900, setLeftW)} onDoubleClick={() => setLeftW(420)} title="Тяните, чтобы изменить ширину (двойной клик — вернуть)"
        style={{ cursor: "col-resize", background: "#c7d6cd", borderLeft: "1px solid #b3c5ba", borderRight: "1px solid #b3c5ba" }} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: "100vh" }}>
        {/* Панель над чертежом: три строки ФИКСИРОВАННОЙ высоты (инструменты, скачивание, подсказка), полос прокрутки нет —
            иначе при "взятии" детали панель меняла высоту и чертёж прыгал под курсором. */}
        <style>{`.sv-row{scrollbar-width:none;-ms-overflow-style:none}.sv-row::-webkit-scrollbar{display:none}`}</style>
        <div style={{ borderBottom: "1px solid #c7d6cd", background: "#fff", padding: "6px 12px 2px" }}>
          <div className="sv-row" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", height: 30 }}>
            <button onClick={() => setZoom((z) => z / 1.25)} title="Уменьшить">🔍−</button>
            <button onClick={() => setZoom((z) => z * 1.25)} title="Увеличить">🔍+</button>
            <button onClick={() => setZoom(1)} title="Сбросить масштаб">100%</button>
            <span style={{ fontSize: 11, color: "#5a6b62", minWidth: 34 }}>{Math.round(zoom * 100)}%</span>
            {hasPieces && (
              <>
                <span style={{ width: 1, alignSelf: "stretch", background: "#c7d6cd", margin: "0 6px", flex: "none" }} />
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }} title="Припуски на швы: пунктир вокруг деталей. Выключено — на чертеже и в файлах только контур.">
                  <input type="checkbox" data-toggle="allowance" checked={showAllowance} onChange={(e) => setShowAllowance(e.target.checked)} />
                  Припуски на швы
                </label>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }} title="Так чертёж видит пользователь: точки построения скрыты, остаются линии и детали.">
                  <input type="checkbox" data-toggle="userview" checked={userView} onChange={(e) => setUserView(e.target.checked)} />
                  Вид пользователя
                </label>
                {scriptResult.pieces.length > 1 && (
                  <button
                    data-arrange onClick={() => setPieceXf((all) => ({ ...all, [currentId]: leko.arrangePieces(scriptResult.pieces, { allowance: showAllowance, transforms: xfNow }) }))}
                    style={{ fontSize: 11.5, flex: "none" }} title="Разложить детали в ряд без наложений (так же они попадут в PDF и DXF, если накладываются)"
                  >⊞ разложить</button>
                )}
                <button
                  data-reset-pieces disabled={Object.keys(xfNow).length === 0}
                  onClick={() => { setGrab(null); setPieceXf((all) => ({ ...all, [currentId]: {} })); }} style={{ fontSize: 11.5, flex: "none" }}
                  title="Вернуть детали на исходные места (как в построении)"
                >↺ детали на место</button>
              </>
            )}
          </div>
          {hasPieces && (
            <div className="sv-row" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", height: 30 }}>
              <span style={{ fontSize: 11.5, color: "#5a6b62", whiteSpace: "nowrap", flex: "none" }}>Скачать:</span>
              <button data-download="pdf" onClick={() => downloadFile("pdf")} style={{ fontSize: 11.5, flex: "none" }} title="PDF в натуральную величину на одном листе (для плоттера или печати на заказ)">⬇ PDF 1:1</button>
              <button data-download="pdfA4" onClick={() => downloadFile("pdfA4")} style={{ fontSize: 11.5, flex: "none" }} title="PDF по листам A4 с метками склейки — печатается на домашнем принтере, масштаб 100%">⬇ PDF A4</button>
              <button data-download="dxf" onClick={() => downloadFile("dxf")} style={{ fontSize: 11.5, flex: "none" }} title="DXF (AutoCAD R12) в сантиметрах: слои контур, припуск, внутренние линии, надсечки, долевая">⬇ DXF</button>
              <button data-download="dxfClo" onClick={() => downloadFile("dxfClo")} style={{ fontSize: 11.5, flex: "none" }} title="DXF для CLO3D и других 3D-программ: один чистый контур на деталь, без вложенных контуров и надсечек, острые концы вытачек притуплены до 6 мм">⬇ DXF для CLO3D</button>
            </div>
          )}
          {hasPieces && (
            <div style={{ height: 20, lineHeight: "20px", fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: grab ? "#8a2a1f" : "#5a6b62" }}>
              {grab
                ? <>Деталь «{grab.key}» взята: двигайте мышью, <b>←/→</b> — повернуть (Shift — 10°, Alt — 0.1°), клик — положить, <b>Esc</b> — отмена</>
                : notice ? <span data-notice title={notice} style={{ color: "#8a5a2a" }}>{notice}</span>
                : "Детали: клик по крупной точке в центре — взять и двигать"}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ padding: 16, overflow: "auto", background: "#eef3f0", flex: 1, minWidth: 0, minHeight: 0, cursor: grab ? "grabbing" : undefined }}
          dangerouslySetInnerHTML={{ __html: scriptSvg }}
        />
        {showSidePanel && (
          <>
          <div data-resize="right" onMouseDown={(e) => dragWidth(e, rightW, -1, 160, 700, setRightW)} onDoubleClick={() => setRightW(210)} title="Тяните, чтобы изменить ширину (двойной клик — вернуть)"
            style={{ width: 6, flexShrink: 0, cursor: "col-resize", background: "#c7d6cd" }} />
          <div data-panel="options" style={{ width: rightW, flexShrink: 0, overflowY: "auto", background: "#fff", padding: "8px 8px 24px" }}>
            {(curKind === "base" || chain.from) && (
              <div data-panel="elements" style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>Элементы изделия</div>
                {curKind === "base" ? ELEMENT_ROLES.map((r) => {
                  const cands = elementCandidates(r.kind);
                  if (cands.length === 0 && !current.attached?.[r.kind]) return null;
                  return (
                    <label key={r.kind} style={{ display: "block", fontSize: 10.5, color: "#5a6b62", marginBottom: 4 }}>
                      {r.slot}
                      <select data-slot={r.kind} value={current.attached?.[r.kind] ?? ""} onChange={(e) => setSlot(r.kind, e.target.value)}
                        style={{ width: "100%", fontSize: 12, padding: "3px 4px", marginTop: 1 }}>
                        <option value="">— без элемента —</option>
                        {cands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                  );
                }) : (
                  <div style={{ fontSize: 11.5, color: "#5a6b62" }}>Получает значения от основы «{chain.from?.name}».</div>
                )}
                {curKind === "base" && !constructions.some((c) => (c.kind ?? "base") !== "base") && (
                  <div style={{ fontSize: 11, color: "#5a6b62" }}>Импортируйте рукав (.ALG): он подключится сюда.</div>
                )}
                <details data-panel="links" style={{ marginTop: 4, fontSize: 11 }} open={chain.elements.some((e) => e.result.imports.some((i) => !i.found) || e.result.ошибка) || (curKind !== "base" && chain.own.imports.some((i) => !i.found))}>
                  <summary style={{ cursor: "pointer", fontWeight: "bold" }}>Связи ({Object.keys(chain.exports).length} знач.)</summary>
                  {curKind === "base" ? (
                    <>
                      <div style={{ color: "#5a6b62", margin: "3px 0" }}>Основа отдаёт: {Object.keys(chain.own.exports).length} значений (export_…)</div>
                      {chain.elements.map((e) => {
                        const miss = e.result.imports.filter((i) => !i.found);
                        return (
                          <div key={e.c.id} style={{ marginBottom: 4 }}>
                            <b>{e.role}</b> «{e.c.name}»: запросил {e.result.imports.length}, получил {e.result.imports.length - miss.length}
                            {miss.length > 0 && <div style={{ color: "#9a3a1f" }}>нет у основы: {miss.map((m) => m.name).join(", ")}</div>}
                            {e.result.ошибка && <div style={{ color: "#9a3a1f" }}>ошибка: {e.result.ошибка.message}</div>}
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {(() => { const miss = chain.own.imports.filter((i) => !i.found); return (
                        <div>запросил {chain.own.imports.length}, получил {chain.own.imports.length - miss.length}
                          {miss.length > 0 && <div style={{ color: "#9a3a1f" }}>нет у основы: {miss.map((m) => m.name).join(", ")}</div>}</div>
                      ); })()}
                    </>
                  )}
                  <div style={{ color: "#5a6b62", marginTop: 3, maxHeight: 140, overflowY: "auto" }}>
                    {Object.entries(chain.exports).map(([k, v]) => <div key={k} title={k}>{k.replace(/^export_/, "")} = {typeof v === "number" ? Math.round(v * 100) / 100 : v}</div>)}
                  </div>
                </details>
              </div>
            )}
            {optionGroups.some((g) => g.inputs.length) && <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 6 }}>Опции</div>}
            {optionGroups.flatMap((grp) => [
              ...(grp.title ? [<div key={"t" + grp.id} style={{ fontSize: 11, fontWeight: "bold", color: "#2f6f4f", margin: "8px 0 4px" }}>{grp.title}</div>] : []),
              ...grp.inputs.map((o) => { const okey = grp.id + ":" + o.name; return { o, okey, gid: grp.id }; }).map(({ o, okey, gid }) => {
              const label = (v: number | [number, string]) => (typeof v === "number" ? String(v) : `${v[0]} — ${v[1]}`);
              const cur = o.values?.find((v) => (typeof v === "number" ? v : v[0]) === o.value);
              const curText = cur !== undefined ? (typeof cur === "number" ? String(cur) : cur[1]) : String(o.value);
              const open = openOpt === okey;
              return (
                <div key={okey} style={{ marginBottom: 4, border: "1px solid #d5e0d9", borderRadius: 5, background: open ? "#f1f7f3" : "#fafcfb" }}>
                  <button data-opt={o.name} onClick={() => setOpenOpt(open ? null : okey)}
                    style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "5px 7px", cursor: "pointer", fontSize: 12 }}>
                    <div style={{ color: "#5a6b62", fontSize: 10.5 }}>{o.title ?? o.name}</div>
                    <div style={{ fontWeight: "bold" }}>{curText}</div>
                  </button>
                  {open && (
                    <div style={{ padding: "0 7px 6px" }}>
                      {o.values ? o.values.map((v) => {
                        const val = typeof v === "number" ? v : v[0];
                        return (
                          <button key={val} data-opt-value={val} onClick={() => { setInputValue(o.name, val, gid); setOpenOpt(null); }}
                            style={{ display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "3px 6px", marginTop: 2, cursor: "pointer", borderRadius: 4, border: "1px solid " + (val === o.value ? "#2f6f4f" : "#d5e0d9"), background: val === o.value ? "#dff0e5" : "#fff" }}>
                            {label(v)}
                          </button>
                        );
                      }) : (
                        <>
                          <input type="number" step="any" value={o.value} style={{ width: "100%", boxSizing: "border-box" }}
                            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setInputValue(o.name, v, gid); }} />
                          {o.hint && <div style={{ fontSize: 10.5, color: "#5a6b62", marginTop: 3 }}>{o.hint}</div>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            }) ])}
            <button disabled={!optionGroups.some((g) => inputVals[g.id])} style={{ fontSize: 11, marginTop: 6 }} onClick={() => setInputVals((prev) => { const n = { ...prev }; for (const g of optionGroups) delete n[g.id]; return n; })}>↺ значения по умолчанию</button>
          </div>
          </>
        )}
        </div>
        {pickMenu && (
          <div
            ref={pickMenuRef}
            style={{
              position: "fixed", zIndex: 1000, minWidth: 200, maxHeight: "60vh", overflowY: "auto",
              left: Math.min(pickMenu.x + 6, window.innerWidth - 240),
              top: Math.min(pickMenu.y + 6, window.innerHeight - (pickMenu.names.length * 30 + 50)),
              background: "#fff", border: "1px solid #2f6f4f", borderRadius: 6, padding: 4,
              boxShadow: "0 4px 14px rgba(0,0,0,.25)",
            }}
          >
            <div style={{ fontSize: 10.5, color: "#5a6b62", padding: "2px 8px 4px" }}>Здесь несколько элементов — выберите:</div>
            {pickMenu.names.map((n, i) => {
              const v = scriptResult.переменные[n]
                ?? (scriptResult.pieces.some((pc) => pc.name.replace(/[^\wА-Яа-яЁё]/g, "_") === n) ? { kind: "piece" } : undefined);
              const prev = i > 0 ? scriptResult.переменные[pickMenu.names[i - 1]] : undefined;
              const firstNonPoint = i > 0 && kindOfVar(v) !== "точка" && kindOfVar(prev) === "точка";
              return (
                <div key={n}>
                {firstNonPoint && <div style={{ fontSize: 10.5, color: "#5a6b62", padding: "6px 8px 2px", borderTop: "1px solid #dfe8e2", marginTop: 3 }}>Линии и детали рядом:</div>}
                <button
                  onMouseEnter={() => setHighlightedVar(n)}
                  onClick={(ev) => {
                    setPickMenu(null); jumpToVar(n);
                    // выбрана деталь — сразу берём её (прилипает к курсору), как по клику на крупную точку
                    const pcs = scriptResult.pieces;
                    const vv = scriptResult.переменные[n];
                    let idx = pcs.findIndex((pc) => pc === vv);
                    if (idx < 0) idx = pcs.findIndex((pc) => pc.name.replace(/[^\wА-Яа-яЁё]/g, "_") === n);
                    const key = idx >= 0 ? pieceKeyList[idx] : undefined;
                    if (key) setGrab({ key, mx: ev.clientX, my: ev.clientY, start: xfNow[key] ?? ZERO_XF });
                  }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%", gap: 14,
                    padding: "4px 8px", border: "none", textAlign: "left", cursor: "pointer",
                    fontFamily: "monospace", fontSize: 12.5,
                    background: highlightedVar === n ? "#fff3c4" : "transparent",
                  }}
                >
                  <b>{n}</b>
                  <span style={{ color: "#5a6b62", fontFamily: "sans-serif", fontSize: 11 }}>{kindOfVar(v)}</span>
                </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
