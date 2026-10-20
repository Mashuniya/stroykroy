import { useEffect, useState } from "react";
import { leko } from "@stroykroy/pattern-engine";
import { createConstruction, guessKind, KIND_TITLES, type SavedConstruction } from "./constructions.js";

/**
 * Загрузка алгоритмов из базы на GitHub (закрытый репозиторий): корень репозитория, файлы .alg.
 * Нужен ключ доступа «только чтение» (fine-grained token, Contents: Read-only); хранится только в этом браузере/приложении.
 * Свои настройки построений (категория, цена, фото, связи, допустимые элементы…) при обновлении не трогаются —
 * заменяются только текст построения и исходный .ALG.
 */
const REPO = "Mashuniya/first";
const BRANCH = "main";
const TOKEN_KEY = "stroykroy:github-token";

interface RepoFile { path: string; sha: string; base: string }
interface Plan { added: RepoFile[]; changed: { file: RepoFile; id: string }[]; same: number }

function getToken(): string { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } }
function setToken(t: string) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* нет */ } }

async function gh(url: string, token: string, raw = false): Promise<Response> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (r.status === 401) throw new Error("GitHub не принял ключ (неверный или истёк срок).");
  if (r.status === 404) throw new Error("Репозиторий не найден: у ключа нет доступа к " + REPO + ".");
  if (r.status === 403) throw new Error("GitHub отказал (403): проверьте права ключа или лимит запросов.");
  if (!r.ok) throw new Error("GitHub ответил " + r.status);
  return r;
}

async function listFiles(token: string): Promise<RepoFile[]> {
  const r = await gh(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`, token);
  const j = await r.json() as { tree: { path: string; type: string; sha: string }[]; truncated?: boolean };
  return j.tree
    .filter((t) => t.type === "blob" && !t.path.includes("/") && /\.alg$/i.test(t.path))
    .map((t) => ({ path: t.path, sha: t.sha, base: t.path.replace(/\.alg$/i, "") }));
}

const norm = (s: string) => s.trim().toUpperCase();
function matches(c: SavedConstruction, f: RepoFile): boolean {
  if (c.repoFile) return c.repoFile === f.path;
  const n = norm(c.name), b = norm(f.base);
  return n === b || n.endsWith(" " + b); // «Манжета MCF002» тоже подходит
}

function makePlan(list: SavedConstruction[], files: RepoFile[], force: boolean): Plan {
  const p: Plan = { added: [], changed: [], same: 0 };
  for (const f of files) {
    const c = list.find((x) => matches(x, f));
    if (!c) p.added.push(f);
    else if (force || c.repoSha !== f.sha) p.changed.push({ file: f, id: c.id });
    else p.same++;
  }
  return p;
}

async function apply(token: string, list: SavedConstruction[], plan: Plan, progress: (t: string) => void): Promise<{ next: SavedConstruction[]; errors: string[]; done: number }> {
  let next = list.slice();
  const errors: string[] = [];
  let done = 0;
  const jobs = [...plan.changed.map((x) => ({ f: x.file, id: x.id as string | null })), ...plan.added.map((f) => ({ f, id: null as string | null }))];
  for (let i = 0; i < jobs.length; i++) {
    const { f, id } = jobs[i];
    progress(`${i + 1} из ${jobs.length}: ${f.path}`);
    try {
      const r = await gh(`https://api.github.com/repos/${REPO}/git/blobs/${f.sha}`, token, true);
      const text = leko.decodeAlg(new Uint8Array(await r.arrayBuffer()));
      const res = leko.algToScript(text, { title: f.path, inputsAsConstants: true });
      if (id) {
        next = next.map((c) => (c.id === id ? { ...c, script: res.script, source: text, repoFile: f.path, repoSha: f.sha } : c));
      } else {
        const kind = guessKind(f.path);
        const c = createConstruction(kind === "base" ? f.base : `${KIND_TITLES[kind]} ${f.base}`, res.script);
        c.source = text; c.repoFile = f.path; c.repoSha = f.sha;
        if (kind !== "base") c.kind = kind;
        next.push(c);
      }
      done++;
    } catch (e) {
      errors.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { next, errors, done };
}

export default function GitSync(p: { list: SavedConstruction[]; onChange: (next: SavedConstruction[]) => void }) {
  const [token, setTok] = useState(getToken());
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function check(f = force) {
    setBusy("Проверяю базу…"); setMsg(""); setErrors([]);
    try {
      const fl = await listFiles(token);
      setFiles(fl);
      setPlan(makePlan(p.list, fl, f));
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setPlan(null); }
    setBusy("");
  }
  // при открытии каталога тихо проверяем, есть ли в базе новое
  useEffect(() => { if (token) void check(); /* eslint-disable-next-line */ }, [token]);

  async function run() {
    if (!plan) return;
    setBusy("Загружаю…"); setErrors([]);
    const r = await apply(token, p.list, plan, (t) => setBusy("Загружаю " + t));
    p.onChange(r.next);
    setErrors(r.errors);
    setMsg(`Готово: обработано ${r.done}${r.errors.length ? `, с ошибками ${r.errors.length}` : ""}. Не забудьте выгрузить каталог на сайт.`);
    setPlan(makePlan(r.next, files, false));
    setBusy("");
  }

  const box = { marginTop: 12, padding: 10, border: "1px solid #dfe8e2", borderRadius: 6, fontSize: 12.5 } as const;
  if (!token) {
    return (
      <div style={box} data-gitsync>
        <b>База алгоритмов (GitHub)</b>
        <div style={{ color: "#5a6b62", margin: "4px 0" }}>Вставьте ключ доступа только на чтение для {REPO}. Он сохранится только на этом компьютере.</div>
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="github_pat_…" style={{ width: "70%" }} />{" "}
        <button disabled={!draft.trim()} onClick={() => { setToken(draft.trim()); setTok(draft.trim()); setDraft(""); }}>Сохранить</button>
      </div>
    );
  }
  const n = plan ? plan.added.length + plan.changed.length : 0;
  return (
    <div style={box} data-gitsync>
      <b>База алгоритмов (GitHub)</b>{" "}
      <button onClick={() => void check()} disabled={!!busy}>Проверить</button>{" "}
      <button data-git-update onClick={() => void run()} disabled={!!busy || !plan || n === 0}>Обновить из базы{plan && n ? ` (${n})` : ""}</button>{" "}
      <button onClick={() => { setToken(""); setTok(""); setPlan(null); }} style={{ fontSize: 11 }}>сменить ключ</button>
      <label style={{ display: "block", marginTop: 4 }}>
        <input type="checkbox" checked={force} onChange={(e) => { setForce(e.target.checked); if (files.length) setPlan(makePlan(p.list, files, e.target.checked)); }} /> перевести заново все файлы (после улучшения переводчика)
      </label>
      {busy && <div>{busy}</div>}
      {plan && !busy && (
        <div style={{ marginTop: 4 }}>
          Новых: {plan.added.length}, изменённых: {plan.changed.length}, без изменений: {plan.same}.
          {plan.added.length > 0 && <div style={{ color: "#5a6b62" }}>Новые: {plan.added.slice(0, 12).map((f) => f.base).join(", ")}{plan.added.length > 12 ? "…" : ""}</div>}
          {plan.changed.length > 0 && <div style={{ color: "#5a6b62" }}>Изменены: {plan.changed.slice(0, 12).map((c) => c.file.base).join(", ")}{plan.changed.length > 12 ? "…" : ""}</div>}
        </div>
      )}
      {msg && <div style={{ marginTop: 4 }}>{msg}</div>}
      {errors.length > 0 && <div style={{ marginTop: 4, color: "#a33" }}>{errors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}</div>}
    </div>
  );
}
