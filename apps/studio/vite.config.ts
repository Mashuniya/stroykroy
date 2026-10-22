import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * «Папка VS Code»: мастерская следит за папкой, где вы пишете алгоритмы (.rb → .alg при Ctrl+S), и сама подхватывает
 * изменившиеся .alg. Работает только в режиме разработки (npm run studio:dev) — там у мастерской есть доступ к диску.
 * Выбранная папка запоминается в файле .studio-watch.json рядом с этим конфигом.
 */
function watchFolder(): Plugin {
  const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".studio-watch.json");
  let dir = "";
  try { dir = JSON.parse(fs.readFileSync(cfgPath, "utf8")).dir ?? ""; } catch { /* ещё не выбрана */ }
  const scan = (): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!dir) return out;
    try {
      for (const n of fs.readdirSync(dir)) {
        if (!/\.alg$/i.test(n)) continue;
        try { out[n] = fs.statSync(path.join(dir, n)).mtimeMs; } catch { /* файл исчез */ }
      }
    } catch { /* папки нет */ }
    return out;
  };
  const clients = new Set<import("node:http").ServerResponse>();
  let known = scan();
  const send = (obj: unknown) => { for (const r of clients) r.write(`data: ${JSON.stringify(obj)}\n\n`); };
  return {
    name: "stroykroy-watch-folder",
    configureServer(server) {
      const timer = setInterval(() => {
        const now = scan();
        for (const [n, t] of Object.entries(now)) if (known[n] !== t) send({ type: "changed", name: n, mtime: t, isNew: known[n] === undefined });
        known = now;
      }, 600);
      server.httpServer?.on("close", () => clearInterval(timer));
      server.middlewares.use("/__watch", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const json = (code: number, obj: unknown) => { res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); };
        if (url.pathname === "/state") {
          const files = Object.entries(scan()).map(([name, mtime]) => ({ name, mtime })).sort((a, b) => b.mtime - a.mtime);
          let exists = false; try { exists = !!dir && fs.statSync(dir).isDirectory(); } catch { /* нет */ }
          return json(200, { dir, exists, files });
        }
        if (url.pathname === "/dir" && req.method === "POST") {
          let body = "";
          req.on("data", (c) => { body += c; });
          req.on("end", () => {
            try {
              const d = String(JSON.parse(body).dir ?? "").trim().replace(/^"|"$/g, "");
              if (d && !fs.statSync(d).isDirectory()) return json(400, { error: "Это не папка." });
              dir = d; known = scan();
              fs.writeFileSync(cfgPath, JSON.stringify({ dir }));
              json(200, { ok: true });
            } catch { json(400, { error: "Такой папки нет — проверьте путь." }); }
          });
          return;
        }
        if (url.pathname === "/file") {
          const name = url.searchParams.get("name") ?? "";
          if (!dir || path.basename(name) !== name || !/\.alg$/i.test(name)) return json(400, { error: "Недопустимое имя файла." });
          try { res.setHeader("Content-Type", "application/octet-stream"); res.end(fs.readFileSync(path.join(dir, name))); } catch { json(404, { error: "Файл не найден." }); }
          return;
        }
        if (url.pathname === "/events") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
          res.write("retry: 1000\n\n");
          clients.add(res);
          req.on("close", () => clients.delete(res));
          return;
        }
        json(404, { error: "нет такого адреса" });
      });
    },
  };
}

// Tauri ожидает фиксированный порт и строгий clientPort — стандартная конфигурация.
export default defineConfig({
  plugins: [react(), watchFolder()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
