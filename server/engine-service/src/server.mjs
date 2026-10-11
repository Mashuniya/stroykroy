// HTTP-сервис конфигуратора. Слушает только 127.0.0.1; снаружи его открывает nginx по адресу /sk-api/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { previewSvg } from "./core.mjs";

const PORT = Number(process.env.PORT ?? 3100);
const MODELS_DIR = process.env.STROYKROY_MODELS_DIR ?? "/var/lib/stroykroy/models";
const MAX_BODY = 20_000;
const RATE = { windowMs: 60_000, max: 60 };

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

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, raster: !!resvg });
  if (req.method !== "POST" || url.pathname !== "/api/preview") return send(res, 404, { error: "not found" });
  const ip = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "");
  if (limited(ip)) return send(res, 429, { error: "Слишком часто. Подождите минуту." });
  let size = 0;
  const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
  req.on("end", () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(res, 400, { error: "bad json" }); }
    const model = typeof body.model === "string" ? loadModel(body.model) : null;
    if (!model) return send(res, 404, { error: "Модель не найдена" });
    try {
      const t0 = Date.now();
      const r = previewSvg(model, body.selection && typeof body.selection === "object" ? body.selection : {});
      const out = { title: r.describe.title, form: r.describe, error: r.error };
      if (r.svg) Object.assign(out, toImage(r.svg, 1000));
      out.ms = Date.now() - t0;
      send(res, 200, out);
    } catch (e) {
      console.error("preview:", e);
      send(res, 500, { error: "Не удалось построить чертёж" });
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`stroykroy engine-service on 127.0.0.1:${PORT}, models: ${MODELS_DIR}, raster: ${!!resvg}`));
