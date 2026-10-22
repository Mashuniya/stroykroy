import { exec } from "node:child_process";
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
  // Следим за .rb и .alg в папке и во вложенных (parts/…), имена — с косой чертой: "parts/ворот.rb"
  const scan = (): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!dir) return out;
    const walk = (rel: string, depth: number) => {
      let names: fs.Dirent[] = [];
      try { names = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
      for (const d of names) {
        const r = rel ? rel + "/" + d.name : d.name;
        if (d.isDirectory()) { if (depth < 3 && !/^(\.|node_modules$)/.test(d.name)) walk(r, depth + 1); continue; }
        if (!/\.(rb|alg)$/i.test(d.name)) continue;
        try { out[r] = fs.statSync(path.join(dir, r)).mtimeMs; } catch { /* файл исчез */ }
      }
    };
    walk("", 0);
    return out;
  };
  const clients = new Set<import("node:http").ServerResponse>();
  let known = scan();
  let pending: unknown = null;
  let lastOpen = 0;
  let focusMode = true;
  const send = (obj: unknown) => { for (const r of clients) r.write(`data: ${JSON.stringify(obj)}\n\n`); };
  return {
    name: "stroykroy-watch-folder",
    configureServer(server) {
      const timer = setInterval(() => {
        const now = scan();
        for (const [n, t] of Object.entries(now)) {
          if (known[n] === t) continue;
          const msg = { type: "changed", name: n, mtime: t, isNew: known[n] === undefined };
          pending = msg;
          if (clients.size > 0) send(msg);
          // выводим чертёж вперёд: открываем страницу заново (новая вкладка встаёт поверх VS Code, старая сама закрывается)
          if (clients.size === 0 || focusMode) {
            const url = `http://localhost:${server.config.server.port ?? 1420}/?fromsave=1`;
            const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
            if (Date.now() - lastOpen > 3000) { lastOpen = Date.now(); exec(cmd, () => { /* не открылось — не страшно */ }); }
          }
        }
        }
        known = now;
      }, 600);
      server.httpServer?.on("close", () => clearInterval(timer));
      server.middlewares.use("/__watch", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const json = (code: number, obj: unknown) => { res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); };
        if (url.pathname === "/state") {
          const files = Object.entries(scan()).map(([name, mtime]) => ({ name, mtime })).sort((a, b) => b.mtime - a.mtime);
          let exists = false; try { exists = !!dir && fs.statSync(dir).isDirectory(); } catch { /* нет */ }
          return json(200, { dir, exists, files, focusMode });
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
          const full = path.resolve(dir, name);
          if (!dir || !/\.(rb|alg)$/i.test(name) || (full !== path.resolve(dir) && !full.startsWith(path.resolve(dir) + path.sep))) return json(400, { error: "Недопустимое имя файла." });
          try { res.setHeader("Content-Type", "application/octet-stream"); res.end(fs.readFileSync(full)); } catch { json(404, { error: "Файл не найден." }); }
          return;
        }
        if (url.pathname === "/focus") { focusMode = url.searchParams.get("on") !== "0"; return json(200, { focusMode }); }
        if (url.pathname === "/events") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
          res.write("retry: 1000\n\n");
          clients.add(res);
          if (pending) { res.write(`data: ${JSON.stringify(pending)}\n\n`); pending = null; }
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
