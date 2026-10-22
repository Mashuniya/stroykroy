import { useCallback, useEffect, useRef, useState } from "react";
import { leko } from "@stroykroy/pattern-engine";

/**
 * «Папка VS Code»: алгоритмы пишутся в VS Code (.rb). Мастерская следит за папкой и сама читает изменившийся .rb
 * (вместе с require "parts/…") — прямо на Ruby, без промежуточного .alg и без Leko. Старые .alg подхватываются, пока рядом нет одноимённого .rb. Следит сервер мастерской (npm run studio:dev), поэтому
 * в собранной версии без этого сервера блок не показывается.
 */
interface FileInfo { name: string; mtime: number }
interface State { dir: string; exists: boolean; files: FileInfo[]; focusMode?: boolean }
interface LogLine { t: string; text: string; bad?: boolean }

const AUTO_KEY = "stroykroy:watch-auto";
const clock = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function FolderWatch(p: { onFile: (name: string, text: string, switchTo: boolean, res?: leko.AlgImportResult) => string }) {
  const [state, setState] = useState<State | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [auto, setAuto] = useState<boolean>(() => { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } });
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const onFileRef = useRef(p.onFile);
  onFileRef.current = p.onFile;

  const addLog = (text: string, bad = false) => setLog((l) => [{ t: clock(), text, bad }, ...l].slice(0, 6));

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/__watch/state");
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) { setAvailable(false); return; }
      const s = (await r.json()) as State;
      setState(s); setAvailable(true);
    } catch { setAvailable(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Вывод чертежа вперёд: сервер по Ctrl+S открывает страницу заново, новая вкладка просит старые закрыться.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const id = Math.random().toString(36).slice(2);
    const ch = new BroadcastChannel("stroykroy-tab");
    ch.onmessage = (ev) => {
      if (ev.data?.type === "new-tab" && ev.data.id !== id) { try { window.close(); } catch { /* вкладку закрыть нельзя — останется */ } }
    };
    const u = new URL(window.location.href);
    if (u.searchParams.has("fromsave")) {
      ch.postMessage({ type: "new-tab", id });
      u.searchParams.delete("fromsave");
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
    return () => ch.close();
  }, []);
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastMain = useRef<string | null>(null);

  const readText = async (name: string): Promise<string> => {
    const r = await fetch("/__watch/file?name=" + encodeURIComponent(name));
    if (!r.ok) throw new Error(`файл «${name}» не прочитался`);
    return leko.decodeAlg(new Uint8Array(await r.arrayBuffer()));
  };

  const load = useCallback(async (name: string, switchTo: boolean) => {
    try {
      if (/\.rb$/i.test(name)) {
        // файл из вложенной папки (parts/…) — это часть; перестраиваем последний открытый основной файл
        const main = name.includes("/") ? lastMain.current : name;
        if (!main) { addLog(`${name} — часть изменена; откройте основной файл`); return; }
        lastMain.current = main;
        const src = await leko.loadRb(main, readText);
        const res = leko.rbToScript(src.text, { title: main, inputsAsConstants: true });
        const msg = onFileRef.current(main, src.text, switchTo, res);
        addLog(`${main}${main !== name ? " (изменён " + name + ")" : ""} — ${msg}` + (src.missing.length ? ` · не найдены: ${src.missing.join(", ")}` : ""));
        return;
      }
      // старый .alg: пропускаем, если рядом есть одноимённый .rb — он главнее
      const base = name.replace(/\.alg$/i, "").toLowerCase();
      if ((stateRef.current?.files ?? []).some((f) => f.name.toLowerCase() === base + ".rb")) return;
      const text = await readText(name);
      const msg = onFileRef.current(name, text, switchTo);
      addLog(`${name} — ${msg}`);
    } catch (e) {
      addLog(`${name} — не удалось: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }, []);

  useEffect(() => {
    if (!available || !state?.dir) return;
    const es = new EventSource("/__watch/events");
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data) as { type: string; name: string };
        if (m.type === "changed" && autoRef.current) void load(m.name, true);
        void refresh();
      } catch { /* мусор в потоке — пропускаем */ }
    };
    return () => es.close();
  }, [available, state?.dir, load, refresh]);

  async function setDir() {
    const r = await fetch("/__watch/dir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: draft }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { addLog((j as { error?: string }).error ?? "Не удалось выбрать папку.", true); return; }
    setOpen(false); addLog("Слежу за папкой: " + draft);
    await refresh();
  }

  if (!available) return null;
  const box = { margin: "8px 0", padding: "6px 8px", border: "1px solid #dfe8e2", borderRadius: 6, fontSize: 12.5 } as const;
  const watching = !!state?.dir && state.exists;
  return (
    <div style={box} data-folderwatch>
      <b>Папка VS Code</b>{" "}
      {watching
        ? <span style={{ color: "#2a7a4b" }}>● слежу: {state!.dir}</span>
        : <span style={{ color: "#a33" }}>{state?.dir ? "папка не найдена: " + state.dir : "папка не выбрана"}</span>}{" "}
      <button style={{ fontSize: 11 }} onClick={() => { setDraft(state?.dir ?? ""); setOpen(!open); }}>{watching ? "сменить" : "выбрать"}</button>
      {open && (
        <div style={{ marginTop: 4 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="например, E:\sapr\first" style={{ width: "72%" }} onKeyDown={(e) => { if (e.key === "Enter") void setDir(); }} />{" "}
          <button disabled={!draft.trim()} onClick={() => void setDir()}>Следить</button>
          <div style={{ color: "#5a6b62", marginTop: 2 }}>Папка с вашими .rb (подпапка parts тоже учитывается). Сохранили в VS Code — чертёж обновился.</div>
        </div>
      )}
      {watching && (
        <>
          <label style={{ display: "block", marginTop: 4 }}>
            <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0"); } catch { /* нет */ } }} /> сразу показывать изменённый файл (текст построения в мастерской заменяется)
          </label>
          <label style={{ display: "block", marginTop: 2 }}>
            <input type="checkbox" checked={state!.focusMode !== false} onChange={async (e) => { await fetch("/__watch/focus?on=" + (e.target.checked ? "1" : "0")); void refresh(); }} /> выводить чертёж вперёд при сохранении в VS Code
          </label>
          {state!.files.length > 0 && (
            <div style={{ marginTop: 4, color: "#5a6b62" }}>
              Открыть: {state!.files.filter((f) => !f.name.includes("/") && !(/\.alg$/i.test(f.name) && state!.files.some((g) => g.name.toLowerCase() === f.name.toLowerCase().replace(/\.alg$/, ".rb")))).slice(0, 8).map((f) => (
                <button key={f.name} style={{ fontSize: 11, marginRight: 4 }} onClick={() => void load(f.name, true)}>{f.name.replace(/\.(alg|rb)$/i, "")}</button>
              ))}
            </div>
          )}
        </>
      )}
      {log.length > 0 && (
        <div style={{ marginTop: 4 }}>{log.map((l, i) => <div key={i} style={{ color: l.bad ? "#a33" : "#2d3a33" }}>{l.t} {l.text}</div>)}</div>
      )}
    </div>
  );
}
