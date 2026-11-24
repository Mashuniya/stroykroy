import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  analyzePiece,
  detectFold,
  type Gauge,
  type PieceAnalysis,
  type PieceLike,
} from "./engine";
import "./knitting.css";

const GAUGE_KEY = "stroykroy.knitting.gauge.v1";
const FOLD_KEY = (constructionId: string) => `stroykroy.knitting.fold.${constructionId || "default"}`;
const ALL_ROWS_KEY = "stroykroy.knitting.allRows.v1";
const CHECKS_KEY = (constructionId: string) => `stroykroy.knitting.checks.${constructionId || "default"}`;
const OPS_KEY = (constructionId: string) => `stroykroy.knitting.ops.${constructionId || "default"}`;
const PARTIAL_KEY = (constructionId: string) => `stroykroy.knitting.partial.${constructionId || "default"}`;
const AYAB_KEY = (constructionId: string) => `stroykroy.knitting.ayab.${constructionId || "default"}`;

interface AyabPattern {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

type AyabMap = Record<string, AyabPattern>;

type Checks = Record<string, Record<string, boolean>>;
type Op = "dec" | "bind" | "inc" | "part" | "center" | "none";
type Ops = Record<string, Record<string, Op>>;

interface TechRow {
  row: number;
  stitches: number;
  widthCm: number;
  delta: number | null;
  op: Op;
  center: boolean;
}

const OP_LABEL: Record<Op, string> = {
  dec: "убавить",
  bind: "закрыть",
  inc: "прибавить",
  part: "частичное",
  center: "центр",
  none: "—",
};

/** Предложение по умолчанию: горловина — центр, крупное — закрыть, мелкое — убавить/прибавить. */
function defaultOp(delta: number | null, center = false): Op {
  if (center) return "center";
  if (delta === null || delta === 0) return "none";
  if (delta < 0) return Math.abs(delta) >= 8 ? "bind" : "dec";
  return "inc";
}

const DEFAULT_GAUGE: Gauge = { stsPer10: 22, rowsPer10: 30, needles: 200 };

function loadGauge(): Gauge {
  try {
    const raw = localStorage.getItem(GAUGE_KEY);
    if (!raw) return { ...DEFAULT_GAUGE };
    const p = JSON.parse(raw) as Partial<Gauge>;
    return {
      stsPer10: Number(p.stsPer10) > 0 ? Number(p.stsPer10) : DEFAULT_GAUGE.stsPer10,
      rowsPer10: Number(p.rowsPer10) > 0 ? Number(p.rowsPer10) : DEFAULT_GAUGE.rowsPer10,
      needles: Number(p.needles) > 0 ? Math.round(Number(p.needles)) : DEFAULT_GAUGE.needles,
    };
  } catch {
    return { ...DEFAULT_GAUGE };
  }
}

function loadFold(constructionId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLD_KEY(constructionId));
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(p)) if (typeof v === "boolean") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function loadAllRows(): boolean {
  try {
    return localStorage.getItem(ALL_ROWS_KEY) === "1";
  } catch {
    return false;
  }
}

function loadChecks(constructionId: string): Checks {
  try {
    const raw = localStorage.getItem(CHECKS_KEY(constructionId));
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Checks = {};
    for (const [piece, rows] of Object.entries(p)) {
      if (!rows || typeof rows !== "object") continue;
      const set: Record<string, boolean> = {};
      for (const [row, on] of Object.entries(rows as Record<string, unknown>)) {
        if (on === true) set[row] = true;
      }
      out[piece] = set;
    }
    return out;
  } catch {
    return {};
  }
}

function saveChecks(constructionId: string, value: Checks): void {
  try {
    localStorage.setItem(CHECKS_KEY(constructionId), JSON.stringify(value));
  } catch {
    /* хранилище недоступно */
  }
}

function loadOps(constructionId: string): Ops {
  try {
    const raw = localStorage.getItem(OPS_KEY(constructionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const allowed = new Set<Op>(["dec", "bind", "inc", "part", "center", "none"]);
    const out: Ops = {};
    for (const [piece, rows] of Object.entries(parsed)) {
      if (!rows || typeof rows !== "object") continue;
      const set: Record<string, Op> = {};
      for (const [row, op] of Object.entries(rows as Record<string, unknown>)) {
        if (typeof op === "string" && allowed.has(op as Op)) set[row] = op as Op;
      }
      out[piece] = set;
    }
    return out;
  } catch {
    return {};
  }
}

function saveOps(constructionId: string, value: Ops): void {
  try {
    localStorage.setItem(OPS_KEY(constructionId), JSON.stringify(value));
  } catch {
    /* хранилище недоступно */
  }
}

function loadPartial(constructionId: string): boolean {
  try {
    return localStorage.getItem(PARTIAL_KEY(constructionId)) === "1";
  } catch {
    return false;
  }
}

function savePartial(constructionId: string, value: boolean): void {
  try {
    localStorage.setItem(PARTIAL_KEY(constructionId), value ? "1" : "0");
  } catch {
    /* хранилище недоступно */
  }
}

function loadAyab(constructionId: string): AyabMap {
  try {
    const raw = localStorage.getItem(AYAB_KEY(constructionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: AyabMap = {};
    for (const [piece, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const p = value as Partial<AyabPattern>;
      if (typeof p.dataUrl === "string" && Number(p.width) > 0 && Number(p.height) > 0) {
        out[piece] = {
          dataUrl: p.dataUrl,
          width: Number(p.width),
          height: Number(p.height),
          name: typeof p.name === "string" ? p.name : "рисунок.png",
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveAyab(constructionId: string, value: AyabMap): boolean {
  try {
    localStorage.setItem(AYAB_KEY(constructionId), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n);
}

function cm(n: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n)} см`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image error"));
    image.src = src;
  });
}

function filePart(text: string): string {
  return text.replace(/[^\wА-Яа-яЁё.-]+/g, "_").slice(0, 60);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = (
    window as unknown as {
      CompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).CompressionStream;
  if (!Ctor) throw new Error("no CompressionStream");
  const stream = new Blob([bytes]).stream().pipeThrough(new Ctor("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** PNG 1 бит/пиксель, ч/б — формат, который AYAB читает без пересчёта. */
async function encodeMonoPng(width: number, height: number, rgba: Uint8ClampedArray): Promise<Blob> {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);

  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      const light =
        alpha < 128 ? 255 : 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (light >= 128) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const pixels = await deflate(raw);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", pixels),
      pngChunk("IEND", new Uint8Array(0)),
    ],
    { type: "image/png" },
  );
}

export interface KnittingTabProps {
  pieces: PieceLike[];
  title: string;
  constructionId: string;
}

export default function KnittingTab({ pieces, title, constructionId }: KnittingTabProps) {
  const [gauge, setGauge] = useState<Gauge>(loadGauge);
  const [selected, setSelected] = useState(0);
  const [foldMap, setFoldMap] = useState<Record<string, boolean>>(() => loadFold(constructionId));
  const [full, setFull] = useState(false);
  const [allRows, setAllRows] = useState<boolean>(loadAllRows);
  const [checks, setChecks] = useState<Checks>(() => loadChecks(constructionId));
  const [ops, setOps] = useState<Ops>(() => loadOps(constructionId));
  const [partialShoulder, setPartialShoulder] = useState<boolean>(() => loadPartial(constructionId));
  const [ayab, setAyab] = useState<AyabMap>(() => loadAyab(constructionId));
  const [showAyab, setShowAyab] = useState(true);
  const [ayabError, setAyabError] = useState<string | null>(null);
  const [printScope, setPrintScope] = useState<"one" | "all">("one");
  const ayabInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(GAUGE_KEY, JSON.stringify(gauge));
    } catch {
      /* хранилище недоступно — расчёт всё равно работает */
    }
  }, [gauge]);

  useEffect(() => {
    setSelected(0);
    setFoldMap(loadFold(constructionId));
    setChecks(loadChecks(constructionId));
    setOps(loadOps(constructionId));
    setPartialShoulder(loadPartial(constructionId));
    setAyab(loadAyab(constructionId));
    setAyabError(null);
  }, [constructionId]);

  useEffect(() => {
    try {
      localStorage.setItem(ALL_ROWS_KEY, allRows ? "1" : "0");
    } catch {
      /* хранилище недоступно */
    }
  }, [allRows]);

  useEffect(() => {
    if (selected >= pieces.length && pieces.length > 0) setSelected(0);
  }, [pieces.length, selected]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const analyses = useMemo(() => {
    if (!(gauge.stsPer10 > 0) || !(gauge.rowsPer10 > 0)) return [];
    return pieces.map((p) => analyzePiece(p, gauge, foldMap[p.name] ?? detectFold(p.name)));
  }, [pieces, gauge, foldMap]);

  const sel: PieceAnalysis | undefined = analyses[Math.min(selected, Math.max(0, analyses.length - 1))];
  const invalidGauge = !(gauge.stsPer10 > 0) || !(gauge.rowsPer10 > 0);
  const fitCount = analyses.filter((a) => a.fits).length;
  const shoulderStart = sel
    ? (sel.changes.find((c) => c.center)?.row ?? Math.floor(sel.rows * 0.85))
    : 0;
  const pattern = sel ? ayab[sel.name] : undefined;

  const rowList: TechRow[] = (() => {
    if (!sel) return [];
    const changeByRow = new Map(sel.changes.map((c) => [c.row, c]));
    if (!allRows) {
      return sel.changes.map((c) => ({
        row: c.row,
        stitches: c.stitches,
        widthCm: sel.rowWidths[c.row - 1]?.widthCm ?? 0,
        delta: c.delta,
        op: opFor(sel.name, c.row, c.delta, c.center),
        center: c.center,
      }));
    }
    const widths = sel.rowWidths;
    return widths.map((r, i) => {
      const delta = i === 0 ? null : r.stitches - widths[i - 1].stitches;
      const center = changeByRow.get(r.row)?.center ?? false;
      return {
        row: r.row,
        stitches: r.stitches,
        widthCm: r.widthCm,
        delta,
        op: opFor(sel.name, r.row, delta, center),
        center,
      };
    });
  })();
  const selectedName = sel?.name;
  const checkedCount = selectedName
    ? rowList.filter((r) => checks[selectedName]?.[r.row]).length
    : 0;

  function setFold(name: string, value: boolean) {
    setFoldMap((prev) => {
      const next = { ...prev, [name]: value };
      try {
        localStorage.setItem(FOLD_KEY(constructionId), JSON.stringify(next));
      } catch {
        /* хранилище недоступно */
      }
      return next;
    });
  }

  function toggleCheck(name: string, row: number, value: boolean) {
    setChecks((prev) => {
      const piece = { ...(prev[name] ?? {}) };
      if (value) piece[row] = true;
      else delete piece[row];
      const next = { ...prev, [name]: piece };
      saveChecks(constructionId, next);
      return next;
    });
  }

  function opFor(name: string, row: number, delta: number | null, center = false): Op {
    const explicit = ops[name]?.[row];
    if (explicit) return explicit;
    if (center) return "center";
    if (partialShoulder && row >= shoulderStart) return "part";
    return defaultOp(delta, center);
  }

  function changePartial(value: boolean) {
    setPartialShoulder(value);
    savePartial(constructionId, value);
  }

  async function importAyab(file: File) {
    setAyabError(null);
    if (!/\.png$/i.test(file.name) && file.type !== "image/png") {
      setAyabError("Нужен PNG — AYAB читает рисунок в PNG.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAyabError("Файл больше 2 МБ — для рисунка AYAB это слишком много.");
      return;
    }
    if (!sel) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const image = await loadImage(dataUrl);
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width < 1 || height < 1) {
        setAyabError("Пустой PNG.");
        return;
      }
      if (width > 200) {
        setAyabError(`Ширина ${width} px — AYAB принимает не больше 200 игл.`);
        return;
      }
      const next: AyabMap = {
        ...ayab,
        [sel.name]: { dataUrl, width, height, name: file.name },
      };
      if (!saveAyab(constructionId, next)) {
        setAyabError("Рисунок не помещается в локальное хранилище — уменьшите PNG.");
        return;
      }
      setAyab(next);
      setShowAyab(true);
    } catch {
      setAyabError("Не удалось прочитать PNG.");
    }
  }

  function removeAyab() {
    if (!sel) return;
    const next = { ...ayab };
    delete next[sel.name];
    saveAyab(constructionId, next);
    setAyab(next);
    setAyabError(null);
  }

  async function downloadAyab() {
    if (!sel || !pattern) return;
    setAyabError(null);
    if (sel.maxStitches > 200) {
      setAyabError(`Деталь ${sel.maxStitches} петель — шире 200 игл, AYAB не примет PNG.`);
      return;
    }

    try {
      const image = await loadImage(pattern.dataUrl);
      const width = sel.maxStitches;
      const height = sel.rows;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setAyabError("Браузер не дал canvas.");
        return;
      }

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      const offsetX = Math.floor((width - pattern.width) / 2);
      for (let y = 0; y < height; y += pattern.height) {
        for (let x = offsetX; x < width; x += pattern.width) {
          ctx.drawImage(image, x, y, pattern.width, pattern.height);
        }
      }

      let blob: Blob | null = null;
      try {
        const pixels = ctx.getImageData(0, 0, width, height).data;
        blob = await encodeMonoPng(width, height, pixels);
      } catch {
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      }
      if (!blob) {
        setAyabError("Не удалось сохранить PNG.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AYAB_${filePart(title || "detal")}_${filePart(sel.name)}_${width}x${height}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setAyabError("Не удалось подготовить PNG.");
    }
  }

  function setOp(name: string, row: number, op: Op) {
    setOps((prev) => {
      const piece = { ...(prev[name] ?? {}) };
      piece[row] = op;
      const next = { ...prev, [name]: piece };
      saveOps(constructionId, next);
      return next;
    });
  }

  function resetChecks() {
    if (!sel) return;
    setChecks((prev) => {
      const next = { ...prev };
      delete next[sel.name];
      saveChecks(constructionId, next);
      return next;
    });
  }

  function printSelected() {
    setPrintScope("one");
    window.setTimeout(() => window.print(), 150);
  }

  function printAll() {
    setPrintScope("all");
    window.setTimeout(() => window.print(), 250);
  }

  return (
    <div className={full ? "kn kn-full" : "kn"}>
      <div className="kn-inner">
        <header className="kn-head">
          <div>
            <div className="kn-eyebrow">Вязание · KH910 / KR850 · AYAB</div>
            <h2 className="kn-title">Петли и ряды</h2>
            <div className="kn-sub">
              {title || "Текущее построение"} · деталей: {pieces.length}
              {analyses.length > 0 ? ` · влезает: ${fitCount} из ${analyses.length}` : ""}
            </div>
          </div>
          <div className="kn-actions">
            <button type="button" className="kn-btn" onClick={() => setFull((v) => !v)}>
              {full ? "Свернуть" : "На весь экран"}
            </button>
            <button
              type="button"
              className="kn-btn kn-btn-primary"
              onClick={printSelected}
              disabled={!sel}
              title="Печать выбранной детали на A4"
            >
              Печать
            </button>
            <button
              type="button"
              className="kn-btn"
              onClick={printAll}
              disabled={analyses.length === 0}
              title="Печать всех деталей: каждая с новой страницы"
            >
              Печать всех
            </button>
          </div>
        </header>

        <section className="kn-gauge" aria-label="Плотность вязания">
          <label className="kn-field">
            <span>Петли / 10 см</span>
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={gauge.stsPer10 || ""}
              onChange={(e) => setGauge((g) => ({ ...g, stsPer10: num(e.target.value) }))}
            />
          </label>
          <label className="kn-field">
            <span>Ряды / 10 см</span>
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={gauge.rowsPer10 || ""}
              onChange={(e) => setGauge((g) => ({ ...g, rowsPer10: num(e.target.value) }))}
            />
          </label>
          <label className="kn-field">
            <span>Иглы в работе</span>
            <input
              type="number"
              min="1"
              max="200"
              step="1"
              inputMode="numeric"
              value={gauge.needles || ""}
              onChange={(e) => setGauge((g) => ({ ...g, needles: Math.round(num(e.target.value)) }))}
            />
          </label>
        </section>
        <p className="kn-hint">
          Плотность — по образцу, связанному на рабочей плотности. Игольница KH910: 200 игл, 4,5 мм
          (≈90 см). Контуры берутся без припусков на швы.
        </p>

        {pieces.length === 0 && (
          <div className="kn-empty">
            <b>В построении нет деталей.</b>
            <p>
              Добавьте в скрипт деталь через <code>writePiece(...)</code> — вкладка возьмёт её контур
              автоматически.
            </p>
          </div>
        )}

        {pieces.length > 0 && invalidGauge && (
          <div className="kn-warn">Укажите плотность больше нуля — без неё петли и ряды не посчитать.</div>
        )}

        {analyses.length > 0 && (
          <>
            <div className="kn-pieces" role="tablist" aria-label="Детали">
              {analyses.map((a, i) => (
                <button
                  key={`${a.name}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === selected}
                  className={`kn-piece${i === selected ? " is-active" : ""}`}
                  onClick={() => setSelected(i)}
                  title={a.name}
                >
                  <span className="kn-piece-name">{a.name}</span>
                  <span className="kn-piece-meta">
                    {fmt(a.maxStitches)} п. · {fmt(a.rows)} р.
                  </span>
                  <span className={`kn-badge ${a.fits ? "ok" : "bad"}`}>
                    {a.fits ? "влезает" : `+${fmt(a.over)} игл`}
                  </span>
                </button>
              ))}
            </div>

            {sel && sel.error && <div className="kn-warn">{sel.error}</div>}

            {sel && !sel.error && (
              <section className="kn-detail">
                <div className="kn-stats">
                  <div className="kn-stat">
                    <span>Набрать</span>
                    <b>{fmt(sel.firstStitches)}</b>
                    <i>петель в первом ряду</i>
                  </div>
                  <div className="kn-stat">
                    <span>Провязать</span>
                    <b>{fmt(sel.rows)}</b>
                    <i>рядов</i>
                  </div>
                  <div className="kn-stat">
                    <span>Макс. ширина</span>
                    <b>{fmt(sel.maxStitches)}</b>
                    <i>петель · {cm(sel.widthCm)}</i>
                  </div>
                  <div className={`kn-stat${sel.fits ? "" : " bad"}`}>
                    <span>Игольница</span>
                    <b>
                      {fmt(sel.maxSpanStitches)} / {fmt(gauge.needles)}
                    </b>
                    <i>{sel.fits ? "влезает" : `не хватает ${fmt(sel.over)} игл`}</i>
                  </div>
                </div>

                <label className="kn-fold">
                  <input
                    type="checkbox"
                    checked={sel.fold}
                    onChange={(e) => setFold(sel.name, e.target.checked)}
                  />
                  <span>
                    <b>Деталь на половину (по сгибу)</b> — считать вторую половину зеркально.
                    {sel.fold ? ` Полная ширина: ${cm(sel.widthCm)}.` : ` Сейчас ширина по контуру: ${cm(sel.widthCm)}.`}
                  </span>
                </label>

                <label className="kn-fold">
                  <input
                    type="checkbox"
                    checked={partialShoulder}
                    onChange={(e) => changePartial(e.target.checked)}
                  />
                  <span>
                    <b>Плечо — частичным вязанием</b> — для рядов после горловины подставлять
                    «частичное» вместо убавок и закрытия.
                  </span>
                </label>

                <div className="kn-panel">
                  <div className="kn-panel-head">
                    <b>Схема детали</b>
                    <span>
                      {cm(sel.widthCm)} × {cm(sel.heightCm)}
                    </span>
                  </div>
                  <PieceChart analysis={sel} gauge={gauge} ayab={pattern} showAyab={showAyab} />
                  <div className="kn-legend">
                    <span>1 клетка = 10 петель × 10 рядов</span>
                    {sel.fold && <span>пунктир — вторая половина по сгибу</span>}
                  </div>
                </div>

                <div className="kn-panel">
                  <div className="kn-panel-head">
                    <b>Рисунок AYAB</b>
                    <span>{pattern ? `${pattern.width} × ${pattern.height} px` : "PNG, до 200 игл"}</span>
                  </div>
                  {ayabError && <div className="kn-warn kn-ayab-error">{ayabError}</div>}
                  {pattern ? (
                    <div className="kn-ayab">
                      <img
                        className="kn-ayab-thumb"
                        src={pattern.dataUrl}
                        alt={`Рисунок AYAB: ${pattern.name}`}
                      />
                      <div className="kn-ayab-info">
                        <p className="kn-ayab-name" title={pattern.name}>
                          {pattern.name}
                        </p>
                        <p className="kn-ayab-meta">
                          1 px = 1 петля / 1 ряд · ширина {pattern.width} ≤ 200
                        </p>
                        <div className="kn-ayab-actions">
                          <button
                            type="button"
                            className="kn-btn"
                            onClick={() => setShowAyab((v) => !v)}
                          >
                            {showAyab ? "Скрыть на схеме" : "Показать на схеме"}
                          </button>
                          <button type="button" className="kn-btn" onClick={() => void downloadAyab()}>
                            Скачать PNG
                          </button>
                          <button type="button" className="kn-btn" onClick={removeAyab}>
                            Убрать
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="kn-ayab-empty">
                      <p>
                        Загрузите PNG из AYAB Studio: ширина до 200 px, 1 px = 1 петля, 1 ряд = 1 ряд.
                      </p>
                      <button
                        type="button"
                        className="kn-btn kn-btn-primary"
                        onClick={() => ayabInput.current?.click()}
                      >
                        Загрузить PNG
                      </button>
                    </div>
                  )}
                  <input
                    ref={ayabInput}
                    type="file"
                    accept="image/png,.png"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importAyab(file);
                      e.target.value = "";
                    }}
                  />
                  <p className="kn-note">
                    Рисунок повторяется по ширине детали и центрируется. «Скачать PNG» собирает 1-битный
                    ч/б файл {fmt(sel.maxStitches)} × {fmt(sel.rows)} px под эту деталь. Ориентацию
                    верх/низ проверьте в AYAB Studio.
                  </p>
                </div>

                <div className="kn-panel">
                  <div className="kn-panel-head">
                    <b>Технология по рядам</b>
                    <span>{rowList.length} строк</span>
                  </div>
                  <div className="kn-tech-tools">
                    <div className="kn-seg" role="group" aria-label="Что показывать">
                      <button
                        type="button"
                        className={!allRows ? "is-active" : ""}
                        onClick={() => setAllRows(false)}
                      >
                        Изменения
                      </button>
                      <button
                        type="button"
                        className={allRows ? "is-active" : ""}
                        onClick={() => setAllRows(true)}
                      >
                        Все ряды
                      </button>
                    </div>
                    <span className="kn-progress">
                      ✓ {checkedCount} / {rowList.length}
                    </span>
                    {checkedCount > 0 && (
                      <button type="button" className="kn-link" onClick={resetChecks}>
                        сбросить
                      </button>
                    )}
                  </div>
                  <div className="kn-table-wrap">
                    <table className="kn-table">
                      <thead>
                        <tr>
                          <th className="kn-check-col">✓</th>
                          <th>Ряд</th>
                          <th>Петель</th>
                          <th>Δ</th>
                          <th>Операция</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowList.map((r) => {
                          const checked = !!checks[sel.name]?.[r.row];
                          return (
                            <tr key={r.row} className={checked ? "is-checked" : ""}>
                              <td className="kn-check-col">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleCheck(sel.name, r.row, e.target.checked)}
                                  aria-label={`Отметить ряд ${r.row}`}
                                />
                              </td>
                              <td>{r.row}</td>
                              <td>{fmt(r.stitches)}</td>
                              <td
                                className={
                                  r.delta === null || r.delta === 0
                                    ? ""
                                    : r.delta > 0
                                      ? "kn-delta up"
                                      : "kn-delta down"
                                }
                              >
                                {r.delta === null || r.delta === 0
                                  ? "—"
                                  : r.delta > 0
                                    ? `+${r.delta}`
                                    : r.delta}
                              </td>
                              <td className="kn-op-cell">
                                {r.delta !== null && r.delta !== 0 ? (
                                  <select
                                    className="kn-op-select"
                                    value={r.op}
                                    onChange={(e) => setOp(sel.name, r.row, e.target.value as Op)}
                                    aria-label={`Операция для ряда ${r.row}`}
                                  >
                                    <option value="dec">убавить</option>
                                    <option value="bind">закрыть</option>
                                    <option value="inc">прибавить</option>
                                    <option value="center">центр</option>
                                    <option value="part">частичное</option>
                                    <option value="none">—</option>
                                  </select>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="kn-note">
                    {allRows
                      ? "Все ряды подряд — отмечайте галочками то, что уже связано."
                      : "Только ряды, где меняется число петель."}{" "}
                    Δ — на всю ширину; если работаете с двух сторон, делите на 2 (центр горловины не
                    делите). Большие Δ — закрыть группу петель (горловина, плечо, подмышка).
                    {sel.fold ? " Деталь по сгибу: вторая половина зеркальна." : ""}{" "}
                    В колонке «Операция» — предложение: «убавить» по одной, «закрыть» группой,
                    «центр» — центральные петли горловины, «прибавить», «частичное» — выдвижение игл.
                    Галочка «Плечо — частичным вязанием» ставит «частичное» для рядов после горловины.
                    Можно поправить вручную. Галочки сохраняются в браузере. «Печать» — выбранная
                    деталь, «Печать всех» — весь комплект.
                  </p>
                </div>
              </section>
            )}
          </>
        )}
        {typeof document !== "undefined" && analyses.some((a) => !a.error) &&
          createPortal(
            <PrintSheets
              title={title}
              analyses={analyses.filter((a) => !a.error)}
              selected={sel && !sel.error ? sel : undefined}
              scope={printScope}
              gauge={gauge}
              allRows={allRows}
              checks={checks}
              ops={ops}
              partialShoulder={partialShoulder}
            />,
            document.body,
          )}
      </div>
    </div>
  );
}

/** Печатные листы A4: выбранная деталь или весь комплект. */
function PrintSheets({
  title,
  analyses,
  selected,
  scope,
  gauge,
  allRows,
  checks,
  ops,
  partialShoulder,
}: {
  title: string;
  analyses: PieceAnalysis[];
  selected?: PieceAnalysis;
  scope: "one" | "all";
  gauge: Gauge;
  allRows: boolean;
  checks: Checks;
  ops: Ops;
  partialShoulder: boolean;
}) {
  const list = scope === "all" ? analyses : selected ? [selected] : [];
  if (list.length === 0) return null;

  return (
    <div className="kn-print-only">
      {list.map((analysis) => (
        <PrintPiece
          key={`${analysis.name}-${analysis.rows}-${analysis.maxStitches}`}
          title={title}
          analysis={analysis}
          gauge={gauge}
          allRows={allRows}
          checks={checks[analysis.name] ?? {}}
          ops={ops[analysis.name] ?? {}}
          partialShoulder={partialShoulder}
        />
      ))}
    </div>
  );
}

const PRINT_COLUMNS = 3;
const PRINT_COLUMN_ROWS = 70;
const PRINT_PAGE_ROWS = PRINT_COLUMNS * PRINT_COLUMN_ROWS;

function PrintPiece({
  title,
  analysis,
  gauge,
  allRows,
  checks,
  ops,
  partialShoulder,
}: {
  title: string;
  analysis: PieceAnalysis;
  gauge: Gauge;
  allRows: boolean;
  checks: Record<string, boolean>;
  ops: Record<string, Op>;
  partialShoulder: boolean;
}) {
  const shoulderStart =
    analysis.changes.find((c) => c.center)?.row ?? Math.floor(analysis.rows * 0.85);
  const opForRow = (row: number, delta: number | null, center: boolean): Op => {
    const explicit = ops[row];
    if (explicit) return explicit;
    if (center) return "center";
    if (partialShoulder && delta !== null && delta !== 0 && row >= shoulderStart) return "part";
    return defaultOp(delta, center);
  };

  const rows: TechRow[] = allRows
    ? (() => {
        const changeByRow = new Map(analysis.changes.map((c) => [c.row, c]));
        return analysis.rowWidths.map((r, i) => {
          const delta = i === 0 ? null : r.stitches - analysis.rowWidths[i - 1].stitches;
          const center = changeByRow.get(r.row)?.center ?? false;
          return {
            row: r.row,
            stitches: r.stitches,
            widthCm: r.widthCm,
            delta,
            op: opForRow(r.row, delta, center),
            center,
          };
        });
      })()
    : analysis.changes.map((c) => ({
        row: c.row,
        stitches: c.stitches,
        widthCm: analysis.rowWidths[c.row - 1]?.widthCm ?? 0,
        delta: c.delta,
        op: opForRow(c.row, c.delta, c.center),
        center: c.center,
      }));

  if (rows.length === 0) return null;

  const pages: TechRow[][] = [];
  for (let i = 0; i < rows.length; i += PRINT_PAGE_ROWS) {
    pages.push(rows.slice(i, i + PRINT_PAGE_ROWS));
  }
  const marked = rows.filter((r) => checks[r.row]).length;

  return (
    <>
      {pages.map((page, p) => {
        const perColumn = Math.ceil(page.length / PRINT_COLUMNS);
        const columns = Array.from({ length: PRINT_COLUMNS }, (_, index) =>
          page.slice(index * perColumn, (index + 1) * perColumn),
        ).filter((column) => column.length > 0);

        return (
          <div className="kn-print-page" key={`${analysis.name}-${p}`}>
            <div className="kn-print-head">
              <h1>
                {title} · {analysis.name}
                {pages.length > 1 ? ` — лист ${p + 1} из ${pages.length}` : ""}
              </h1>
              <p>
                Плотность {fmt(gauge.stsPer10)} п. × {fmt(gauge.rowsPer10)} р. на 10 см · игл{" "}
                {fmt(gauge.needles)} · {fmt(analysis.maxStitches)} п. макс. · {fmt(analysis.rows)} р. ·{" "}
                {allRows ? "все ряды" : "только изменения"} · отмечено {marked} из {rows.length}
              </p>
            </div>
            <div className="kn-print-cols">
              {columns.map((part, index) => (
                <table className="kn-print-table" key={index}>
                  <thead>
                    <tr>
                      <th className="kn-print-check-col">✓</th>
                      <th>Ряд</th>
                      <th>Петель</th>
                      <th>Операция</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {part.map((r) => (
                      <tr key={r.row}>
                        <td className="kn-print-check-col">
                          <span className={`kn-print-box${checks[r.row] ? " is-on" : ""}`}>
                            {checks[r.row] ? "✓" : ""}
                          </span>
                        </td>
                        <td>{r.row}</td>
                        <td>{r.stitches}</td>
                        <td>{OP_LABEL[r.op]}</td>
                        <td>{deltaText(r.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
            {p === pages.length - 1 && (
              <>
                <p className="kn-print-note">
                  Δ — изменение числа петель на всю ширину; при работе с двух сторон делите на 2
                  (центр горловины не делите). Операция: убавить — по 1 петле с края, закрыть — группой
                  (горловина, плечо, подмышка), центр — закрыть центральные петли, прибавить — добавить,
                  частичное — выдвинуть иглы.
                  {analysis.fold ? " Деталь дана на половину, вторая половина зеркальна." : ""}
                </p>
                <p className="kn-print-sign">Дата, подпись</p>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function deltaText(d: number | null): string {
  if (d === null || d === 0) return "—";
  return d > 0 ? `+${d}` : String(d);
}

/** Схема в клетках «петля × ряд»: контур детали, её зеркало и рисунок AYAB. */
function PieceChart({
  analysis,
  gauge,
  ayab,
  showAyab,
}: {
  analysis: PieceAnalysis;
  gauge: Gauge;
  ayab?: AyabPattern;
  showAyab: boolean;
}) {
  const sx = gauge.stsPer10 / 10;
  const sy = gauge.rowsPer10 / 10;
  const baseW = (analysis.bounds.maxX - analysis.bounds.minX) * sx;
  const totalW = analysis.fold ? baseW * 2 : baseW;
  const H = analysis.rows;
  const pad = Math.max(3, Math.round(Math.max(totalW, H) * 0.02));
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `knClip${uid}`;
  const patternId = `knPat${uid}`;
  const showPattern = Boolean(ayab && showAyab);
  const patternOffset = ayab ? (totalW - ayab.width) / 2 : 0;

  const pathFor = (mirror: boolean) =>
    analysis.points
      .map((p, i) => {
        let x: number;
        if (analysis.fold) {
          const rel = (p.x - analysis.foldX) * sx; // расстояние от линии сгиба
          x = (mirror ? -rel : rel) + baseW;
        } else {
          x = (p.x - analysis.bounds.minX) * sx;
        }
        const y = (p.y - analysis.bounds.minY) * sy;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let x = 0; x <= totalW + 0.001; x += 10) vertical.push(x);
  for (let y = 0; y <= H + 0.001; y += 10) horizontal.push(y);

  return (
    <svg
      className="kn-chart"
      viewBox={`${-pad} ${-pad} ${totalW + pad * 2} ${H + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Схема детали ${analysis.name}: ${analysis.maxStitches} петель, ${analysis.rows} рядов${
        showPattern ? ", с рисунком AYAB" : ""
      }`}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={pathFor(false)} />
          {analysis.fold && <path d={pathFor(true)} />}
        </clipPath>
        {ayab && (
          <pattern
            id={patternId}
            width={ayab.width}
            height={ayab.height}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${patternOffset} 0)`}
          >
            <image
              href={ayab.dataUrl}
              width={ayab.width}
              height={ayab.height}
              preserveAspectRatio="none"
            />
          </pattern>
        )}
      </defs>
      <rect x="0" y="0" width={totalW} height={H} className="kn-chart-bg" />
      {vertical.map((x) => (
        <line
          key={`v${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={H}
          className={x % 50 === 0 ? "kn-grid-major" : "kn-grid"}
        />
      ))}
      {horizontal.map((y) => (
        <line
          key={`h${y}`}
          x1={0}
          y1={y}
          x2={totalW}
          y2={y}
          className={y % 50 === 0 ? "kn-grid-major" : "kn-grid"}
        />
      ))}
      {showPattern && ayab && (
        <rect
          x={0}
          y={0}
          width={totalW}
          height={H}
          fill={`url(#${patternId})`}
          clipPath={`url(#${clipId})`}
          opacity={0.85}
        />
      )}
      <path d={pathFor(false)} className="kn-shape" fill={showPattern ? "none" : undefined} />
      {analysis.fold && (
        <path
          d={pathFor(true)}
          className="kn-shape kn-shape-mirror"
          fill={showPattern ? "none" : undefined}
        />
      )}
    </svg>
  );
}
