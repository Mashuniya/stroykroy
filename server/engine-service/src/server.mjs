// HTTP-сервис конфигуратора. Слушает только 127.0.0.1; снаружи его открывает nginx по адресу /sk-api/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { previewSvg, checkSelection, buildFiles } from "./core.mjs";

const PORT = Number(process.env.PORT ?? 3100);
const MODELS_DIR = process.env.STROYKROY_MODELS_DIR ?? "/var/lib/stroykroy/models";
const MAX_BODY = 20_000;
const RATE = { windowMs: 60_000, max: 60 };
// Куда сообщать об ошибках построения: сайт (Drupal) рассылает письмо. Адрес — локальный, поэтому на сайте принимаются только запросы с этого же сервера.
const REPORT_HOST = process.env.SK_REPORT_HOST ?? "127.0.0.1";
const REPORT_SNI = process.env.SK_REPORT_SNI ?? "stroykroy.com";
const REPORT_PORT = Number(process.env.SK_REPORT_PORT ?? 443);
const REPORT_PATH = process.env.SK_REPORT_PATH ?? "/stroykroy/error-report";
const REPORT_EVERY_MS = 10 * 60_000; // одну и ту же ошибку в одной модели присылаем не чаще раза в 10 минут
const reported = new Map();
const ERROR_LOG = process.env.SK_ERROR_LOG ?? "/var/lib/stroykroy/errors.log";

let resvg = null;
try { resvg = (await import("@resvg/resvg-js")).Resvg; } catch { /* нет растеризатора — отдаём SVG */ }

const cache = new Map(); // id → { mtime, model }
function loadModel(id) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id) || id.includes("..")) return null;
  const file = path.join(MODELS_DIR, id + ".json");
  try {
    const st = fs.statSync(file);
    const c = cache.get(id);
    if (c && c.mtime === st.mtimeMs) return c.model;
    const model = JSON.parse(fs.readFileSync(file, "utf8"));
    cache.set(id, { mtime: st.mtimeMs, model });
    return model;
  } catch { return null; }
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE.windowMs)) hits.delete(k);
  return arr.length > RATE.max;
}

function toImage(svg, width) {
  if (resvg) {
    try {
      const png = new resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
      return { kind: "png", image: "data:image/png;base64," + Buffer.from(png).toString("base64") };
    } catch (e) { console.error("resvg:", e.message); }
  }
  return { kind: "svg", image: svg };
}

function reportError(modelId, model, message, debug, req) {
  const fp = modelId + "|" + message.slice(0, 200);
  const now = Date.now();
  const prev = reported.get(fp);
  if (prev && now - prev.at < REPORT_EVERY_MS) { prev.suppressed++; return; }
  const suppressed = prev ? prev.suppressed : 0;
  reported.set(fp, { at: now, suppressed: 0 });
  if (reported.size > 500) for (const [k, v] of reported) if (now - v.at > REPORT_EVERY_MS) reported.delete(k);
  // Копия в файл: письмо может не дойти (почта, сеть), а запись об ошибке должна остаться
  try { fs.appendFileSync(ERROR_LOG, new Date().toISOString() + " " + modelId + " " + message.slice(0, 500).replace(/\s+/g, " ") + "\n"); } catch { /* нет прав на папку — не страшно */ }
  const payload = JSON.stringify({
    time: new Date().toISOString(), model: modelId, modelName: model?.name ?? "", error: message, suppressedSince: suppressed,
    ip: String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? ""), userAgent: String(req.headers["user-agent"] ?? ""),
    referer: String(req.headers["referer"] ?? ""), debug,
  }).slice(0, 60_000);
  const r = https.request({
    host: REPORT_HOST, port: REPORT_PORT, path: REPORT_PATH, method: "POST", servername: REPORT_SNI, timeout: 8000,
    headers: { Host: REPORT_SNI, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) },
  }, (resp) => {
    let b = ""; resp.on("data", (c) => { if (b.length < 300) b += c; });
    resp.on("end", () => { if (resp.statusCode !== 200 || !/"ok":\s*true/.test(b)) console.error("report: сайт ответил", resp.statusCode, b.slice(0, 200)); });
  });
  r.on("error", (e) => console.error("report:", e.message));
  r.on("timeout", () => r.destroy());
  r.end(payload);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, raster: !!resvg });
  const isValidate = req.method === "POST" && url.pathname === "/api/validate";
  const isFiles = req.method === "POST" && url.pathname === "/api/files";
  const internal = isValidate || isFiles;
  // /api/validate и /api/files — только для сайта с этого же сервера: через nginx приходит заголовок X-Real-IP, такие запросы не пускаем
  if (internal && req.headers["x-real-ip"] !== undefined) return send(res, 403, { error: "forbidden" });
  if (req.method !== "POST" || (url.pathname !== "/api/preview" && !internal)) return send(res, 404, { error: "not found" });
  const ip = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "");
  if (!internal && limited(ip)) return send(res, 429, { error: "Слишком часто. Подождите минуту." });
  let size = 0;
  const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
  req.on("end", () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(res, 400, { error: "bad json" }); }
    const model = typeof body.model === "string" ? loadModel(body.model) : null;
    if (!model) return send(res, 404, { error: "Модель не найдена" });
    if (isFiles) {
      try {
        const out = buildFiles(model, body.selection && typeof body.selection === "object" ? body.selection : {}, {
          title: String(body.title ?? "").slice(0, 120), stamp: String(body.stamp ?? "").slice(0, 80),
        });
        if (out.error) reportError(body.model, model, "Файлы после оплаты: " + out.error, out.debug, req);
        return send(res, 200, out.error ? { ok: false, error: "build_failed" } : { ok: true, files: out.files });
      } catch (e) {
        console.error("files:", e);
        reportError(String(body.model), model, "Исключение сервиса (файлы): " + (e && e.stack ? e.stack : String(e)).slice(0, 3000), { selectionReceived: body.selection }, req);
        return send(res, 200, { ok: false, error: "build_failed" });
      }
    }
    if (isValidate) {
      try {
        const c = checkSelection(model, body.selection && typeof body.selection === "object" ? body.selection : {});
        if (c.error) reportError(body.model, model, c.error, c.debug, req);
        return send(res, 200, c.error ? { ok: false, error: "build_failed" } : { ok: true, selection: c.selection, summary: c.summary, title: model.shop?.title || model.name });
      } catch (e) {
        console.error("validate:", e);
        reportError(String(body.model), model, "Исключение сервиса: " + (e && e.stack ? e.stack : String(e)).slice(0, 3000), { selectionReceived: body.selection }, req);
        return send(res, 200, { ok: false, error: "build_failed" });
      }
    }
    try {
      const t0 = Date.now();
      const r = previewSvg(model, body.selection && typeof body.selection === "object" ? body.selection : {});
      // Покупателю — спокойное сообщение без подробностей (в тексте ошибки бывают имена из построения); подробности уходят на почту владельцу
      const out = { title: r.describe.title, form: r.describe, error: r.error ? "build_failed" : null };
      if (r.error) reportError(body.model, model, r.error, r.debug, req);
      if (r.svg) Object.assign(out, toImage(r.svg, 1000));
      out.ms = Date.now() - t0;
      send(res, 200, out);
    } catch (e) {
      console.error("preview:", e);
      reportError(String(body.model), model, "Исключение сервиса: " + (e && e.stack ? e.stack : String(e)).slice(0, 3000), { selectionReceived: body.selection }, req);
      send(res, 500, { error: "build_failed" });
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`stroykroy engine-service on 127.0.0.1:${PORT}, models: ${MODELS_DIR}, raster: ${!!resvg}`));
