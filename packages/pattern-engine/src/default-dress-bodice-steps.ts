import type { FormulaStep, FormulaLine } from "./formula-engine.js";

/**
 * Базовая конструкция платья (спинка + перед), группа «Ж», по Таблице 7
 * ЕМКО СЭВ. Источник: https://studfile.net/preview/8697497/
 * (страницы 5-7: Таблица 7 и примечания к ней).
 *
 * Это ДАННЫЕ, не код — редактируются прямо в студии разработчика, без
 * пересборки приложения. Каждый шаг — одна строка оригинальной таблицы.
 */
export const DEFAULT_DRESS_BODICE_STEPS: FormulaStep[] = [
  { id: "11", kind: "point", label: "11 — основание шеи сзади (начало координат)", formula: `({x:0, y:0})` },
  { id: "31", kind: "point", label: "31 — линия груди (Г), стр.3", formula: `({x:0, y: M.rz39 + P.P_11_31})` },
  { id: "41", kind: "point", label: "41 — линия талии (Т), стр.4", formula: `({x:0, y: M.rz40 + P.P_11_41})` },
  { id: "51", kind: "point", label: "51 — линия бёдер (Б), стр.5", formula: `({x:0, y: pt["41"].y + 0.65*(M.rz7-M.rz12) + P.P_41_51})` },

  { id: "w3133", kind: "value", label: "31-33 — ширина спинки, стр.6", formula: `0.5*M.rz47 + P.PK_31_33` },
  { id: "w3335", kind: "value", label: "33-35 — ширина проймы, стр.7", formula: `M.rz57 + P.PK_33_35` },
  { id: "w3537", kind: "value", label: "35-37 — ширина переда, стр.8", formula: `0.5*(M.rz45+M.rz15-P.a8-M.rz14) + P.PK_35_37` },

  { id: "33", kind: "point", label: "33", formula: `({x:V["w3133"], y:pt["31"].y})` },
  { id: "35", kind: "point", label: "35", formula: `({x:V["w3133"]+V["w3335"], y:pt["31"].y})` },
  { id: "37", kind: "point", label: "37", formula: `({x:V["w3133"]+V["w3335"]+V["w3537"], y:pt["31"].y})` },

  { id: "47", kind: "point", label: "47 — линия талии переда, стр.10", formula: `({x:pt["37"].x, y:pt["31"].y+(M.rz40-M.rz39)+P.P_37_47})` },
  { id: "57", kind: "point", label: "57 — линия бёдер переда, стр.11", formula: `({x:pt["37"].x, y:pt["47"].y+0.65*(M.rz7-M.rz12)+P.P_47_57})` },

  { id: "13", kind: "point", label: "13 — вершина проймы спинки, стр.13", formula: `({x:pt["33"].x, y:pt["31"].y-(0.49*M.rz38+P.P_33_13)})` },
  { id: "15", kind: "point", label: "15 — вершина проймы переда, стр.14", formula: `({x:pt["35"].x, y:pt["31"].y-(0.43*M.rz38+P.P_35_15)})` },
  { id: "331", kind: "point", label: "331 — глубина проймы спинки, стр.15", formula: `({x:pt["33"].x, y:pt["31"].y+P.P_depth})` },
  { id: "351", kind: "point", label: "351 — глубина проймы переда, стр.16", formula: `({x:pt["35"].x, y:pt["31"].y+P.P_depth})` },

  { id: "L17", kind: "value", label: "331-341, стр.17", formula: `0.62*V["w3335"]+P.a17` },
  { id: "341", kind: "point", label: "341", formula: `({x:pt["33"].x+V["L17"], y:pt["331"].y})` },
  { id: "L19", kind: "value", label: "331-332, стр.19", formula: `0.62*V["w3335"]+P.a19` },
  { id: "332", kind: "point", label: "332", formula: `({x:pt["33"].x, y:pt["331"].y-V["L19"]})` },
  {
    id: "342", kind: "arc", label: "342 — дуга нижней проймы спинки (341→332), стр.20-20.2",
    formula: `(()=>{const c=pick(circleIntersect(pt["332"],V["L19"],pt["341"],V["L19"]),p=>-p.y); if(!c) throw new Error("окружности не пересеклись — проверьте а17/а19"); return {center:c, radius:dist(c,pt["341"]), from:pt["341"], to:pt["332"], sweep:1};})()`,
  },

  { id: "L18", kind: "value", label: "351-341', стр.18", formula: `0.38*V["w3335"]-P.a18` },
  { id: "341p", kind: "point", label: "341'", formula: `({x:pt["35"].x-V["L18"], y:pt["351"].y})` },
  { id: "L21", kind: "value", label: "351-352, стр.21", formula: `0.38*V["w3335"]-P.a21` },
  { id: "352", kind: "point", label: "352", formula: `({x:pt["35"].x, y:pt["351"].y-V["L21"]})` },
  {
    id: "343", kind: "arc", label: "343 — дуга нижней проймы переда (341'→352), стр.22-22.2",
    formula: `(()=>{const c=pick(circleIntersect(pt["352"],V["L21"],pt["341p"],V["L21"]),p=>-p.y); if(!c) throw new Error("окружности не пересеклись — проверьте а18/а21"); return {center:c, radius:dist(c,pt["341p"]), from:pt["341p"], to:pt["352"], sweep:0};})()`,
  },

  { id: "411", kind: "point", label: "411 — отведение сред. линии спинки на талии, стр.24", formula: `({x:P.O_center, y:pt["41"].y})` },
  { id: "511", kind: "point", label: "511 — отведение сред. линии спинки на бёдрах, стр.26", formula: `({x:P.O_center, y:pt["51"].y})` },

  { id: "w1112", kind: "value", label: "11-12 — ширина горловины спинки, стр.27", formula: `0.18*M.rz13+P.P_neck_w` },
  { id: "12", kind: "point", label: "12", formula: `({x:V["w1112"], y:0})` },
  { id: "h12121", kind: "value", label: "12-121 — глубина горловины спинки, стр.29", formula: `0.07*M.rz13+P.P_neck_d` },
  { id: "121", kind: "point", label: "121", formula: `({x:V["w1112"], y:-V["h12121"]})` },

  { id: "seg1314", kind: "value", label: "13-14 — коррекция ширины плеча, стр.30", formula: `3.5-0.08*M.rz47` },
  {
    id: "14", kind: "point", label: "14 — плечо спинки (⚠ направление от 13 — приближение, угол: P.shoulderAngleDeg)",
    formula: `({x: pt["33"].x - V["seg1314"]*Math.cos(P.shoulderAngleDeg*Math.PI/180), y: pt["13"].y + V["seg1314"]*Math.sin(P.shoulderAngleDeg*Math.PI/180)})`,
  },

  { id: "113", kind: "point", label: "113", formula: `({x:0, y:pt["121"].y})` },
  { id: "r39", kind: "value", label: "радиус горловины спинки, стр.39", formula: `Math.max(0.5, dist(pt["121"],pt["113"]) - P.a39)` },
  {
    id: "114", kind: "arc", label: "114 — дуга горловины спинки, стр.38-40",
    formula: `(()=>{const c=pick(circleIntersect(pt["121"],V["r39"],pt["12"],V["r39"]),p=>p.y); if(!c) throw new Error("дуга горловины не построилась — проверьте а39"); return {center:c, radius:V["r39"], from:pt["121"], to:pt["11"], sweep:0};})()`,
  },

  { id: "32", kind: "point", label: "32 — опорная точка вытачки на лопатки, стр.31", formula: `({x:0.17*M.rz47, y:pt["31"].y})` },
  { id: "122", kind: "point", label: "122 — вершина вытачки по плечу, стр.31", formula: `({x: pt["121"].x + P.k31*(pt["14"].x-pt["121"].x), y: pt["121"].y + P.k31*(pt["14"].y-pt["121"].y)})` },
  { id: "22", kind: "point", label: "22 — вершина (апекс) вытачки на лопатки, стр.33", formula: `({x:(pt["122"].x+pt["32"].x)/2, y:(pt["122"].y+pt["32"].y)/2})` },
  { id: "122p", kind: "point", label: "122' — после раствора вытачки на угол β34", formula: `rotateAround(pt["122"], pt["22"], -P.beta34)` },
  {
    id: "14p", kind: "point", label: "14' — плечо спинки после вытачки на лопатки, стр.35",
    formula: `(()=>{const r1=dist(pt["122"],pt["14"]), r2=dist(pt["13"],pt["14"]); const c=pick(circleIntersect(pt["122p"],r1,pt["13"],r2),p=>p.y); if(!c) throw new Error("вытачка на лопатки не раскрылась при текущем угле плеча (P.shoulderAngleDeg)"); return c;})()`,
  },
  {
    id: "342pp", kind: "arc", label: "верхняя дуга проймы спинки (14'→332), стр.41-43 (упрощённый центр)",
    formula: `(()=>{const r=dist(pt["14p"],pt["332"]); const cands=circleIntersect(pt["14p"],r*0.7,pt["332"],r*0.7); const c=cands.length?pick(cands,p=>p.x):{x:(pt["14p"].x+pt["332"].x)/2,y:(pt["14p"].y+pt["332"].y)/2}; return {center:c, radius:dist(c,pt["14p"]), from:pt["14p"], to:pt["332"], sweep:1};})()`,
  },

  { id: "d47_471", kind: "value", label: "47-471 — вытачка на живот, стр.44", formula: `0.24*M.rz18 - 0.5*(M.rz45+M.rz15-P.a8-M.rz14)` },
  { id: "471", kind: "point", label: "471", formula: `({x:pt["37"].x - Math.max(0,V["d47_471"]), y:pt["47"].y})` },
  { id: "d471_46", kind: "value", label: "471-46, стр.46", formula: `0.5*M.rz46+P.P_bellyDart` },
  { id: "46", kind: "point", label: "46", formula: `({x:pt["471"].x - V["d471_46"], y:pt["47"].y})` },

  { id: "36", kind: "point", label: "36 — центр груди, стр.47", formula: `({x:pt["46"].x, y:pt["47"].y-(M.rz36-M.rz35)})` },
  { id: "371", kind: "point", label: "371", formula: `({x:pt["46"].x+(pt["37"].x-pt["471"].x), y:pt["36"].y})` },
  { id: "r49", kind: "value", label: "радиус вытачки на грудь, стр.49", formula: `M.rz35-M.rz34+P.P_bustDartR` },
  { id: "372", kind: "point", label: "372", formula: `({x:pt["36"].x+V["r49"], y:pt["36"].y})` },
  { id: "w501", kind: "value", label: "раствор вытачки на грудь, стр.50.1", formula: `0.5*(M.rz15-P.a8-M.rz14)-0.25*P.PK_35_37` },
  { id: "372p", kind: "point", label: "372'", formula: `({x:pt["372"].x, y:pt["372"].y-V["w501"]})` },
  {
    id: "371p", kind: "point", label: "371' — вторая сторона вытачки на грудь, стр.50.2",
    formula: `(()=>{const c=pick(circleIntersect(pt["36"],V["r49"],pt["372p"],dist(pt["372"],pt["372p"])),p=>-p.y); return c||pt["372p"];})()`,
  },

  { id: "w361", kind: "value", label: "ширина горловины переда, стр.51", formula: `0.18*M.rz13+P.P_necklineF_w` },
  { id: "361", kind: "point", label: "361", formula: `({x:pt["36"].x-V["w361"], y:pt["36"].y})` },
  {
    id: "r3616", kind: "value", label: "36-16, стр.52 (⚠ НЕ ПРОВЕРЕНО по рис.19 — см. предупреждение)",
    formula: `M.rz44-(M.rz40+0.07*M.rz13)-(M.rz36-M.rz35)`,
  },
  {
    id: "16", kind: "point", label: "16 — вершина горловины переда (⚠ см. выше)",
    formula: `(()=>{const cands=circleVerticalLineIntersect(pt["36"],V["r3616"],pt["361"].x); const c=pick(cands,p=>p.y); return c || {x:pt["361"].x, y:pt["36"].y-V["r3616"]};})()`,
  },
  { id: "14pp", kind: "point", label: "14\" — плечо переда", formula: `({x:pt["16"].x+dist(pt["121"],pt["14"]), y:pt["16"].y})` },
  { id: "h54", kind: "value", label: "16-161, стр.54", formula: `0.205*M.rz13` },
  { id: "161", kind: "point", label: "161", formula: `({x:pt["16"].x, y:pt["16"].y+V["h54"]})` },
];

export const DEFAULT_DRESS_BODICE_LINES: FormulaLine[] = [
  { from: "11", to: "51", style: "aux" },
  { from: "33", to: "35", style: "seg" },
  { from: "35", to: "37", style: "seg" },
  { from: "33", to: "331", style: "aux" },
  { from: "121", to: "122", style: "seg" },
  { from: "122p", to: "14p", style: "seg" },
  { from: "13", to: "14p", style: "seg" },
  { from: "22", to: "122", style: "dart" },
  { from: "22", to: "122p", style: "dart" },
  { from: "37", to: "57", style: "aux" },
  { from: "471", to: "37", style: "seg" },
  { from: "46", to: "471", style: "dart" },
  { from: "36", to: "371p", style: "dart" },
  { from: "36", to: "372p", style: "dart" },
  { from: "16", to: "161", style: "seg" },
  { from: "16", to: "14pp", style: "seg" },
];
