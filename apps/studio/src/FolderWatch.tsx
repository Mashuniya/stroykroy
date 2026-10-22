import { useCallback, useEffect, useRef, useState } from "react";
import { leko } from "@stroykroy/pattern-engine";

/**
 * «Папка VS Code»: алгоритмы пишутся в VS Code (.rb), при Ctrl+S рядом появляется свежий .alg — мастерская следит за папкой
 * и сама подхватывает изменившийся файл: перестраивает чертёж. Следит сервер мастерской (npm run studio:dev), поэтому
 * в собранной версии без этого сервера блок не показывается.
 */
interface FileInfo { name: string; mtime: number }
interface State { dir: string; exists: boolean; files: FileInfo[] }
interface LogLine { t: string; text: string; bad?: boolean }

const AUTO_KEY = "stroykroy:watch-auto";
const clock = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function FolderWatch(p: { onFile: (name: string, text: string, switchTo: boolean) => string }) {
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

  const load = useCallback(async (name: string, switchTo: boolean) => {
    try {
      const r = await fetch("/__watch/file?name=" + encodeURIComponent(name));
      if (!r.ok) throw new Error("файл не прочитался");
      const text = leko.decodeAlg(new Uint8Array(await r.arrayBuffer()));
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
          <div style={{ color: "#5a6b62", marginTop: 2 }}>Папка, где VS Code кладёт .alg при Ctrl+S.</div>
        </div>
      )}
      {watching && (
        <>
          <label style={{ display: "block", marginTop: 4 }}>
            <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0"); } catch { /* нет */ } }} /> сразу показывать изменённый файл (текст построения в мастерской заменяется)
          </label>
          {state!.files.length > 0 && (
            <div style={{ marginTop: 4, color: "#5a6b62" }}>
              Открыть: {state!.files.slice(0, 8).map((f) => (
                <button key={f.name} style={{ fontSize: 11, marginRight: 4 }} onClick={() => void load(f.name, true)}>{f.name.replace(/\.alg$/i, "")}</button>
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
