import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ChevronRight,
  Clock,
  FileText,
  FolderPlus,
  HardDrive,
  History,
  LogOut,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Square,
  Terminal,
  Wrench
} from "lucide-react";
import type { AuthUser, CreateServerRequest, EditableFile, InstallJob, ManagedServer, ModpackSearchResult, ModpackVersion, ServiceTestResult } from "../shared/types";
import type { ExternalSchedule, ImportPreview, ServerAction } from "../shared/types";
import "./styles.css";

type View = "servers" | "server" | "settings" | "files" | "backups" | "create" | "jobs" | "appSettings";

const api = {
  async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api${url}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(data.error ?? "Request failed");
    }
    const type = response.headers.get("content-type") ?? "";
    return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
  }
};

function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [route, setRoute] = useState(location.pathname);

  useEffect(() => {
    api.request<AuthUser | null>("/auth/me").then(setUser).catch(() => setUser(null));
    const listener = () => setRoute(location.pathname);
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);

  const nav = useMemo(() => parseRoute(route), [route]);

  if (user === undefined) return <div className="boot">Loading Minecraft Server Configurator</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <Shell user={user} active={nav.view} onLogout={() => setUser(null)}>
      {nav.view === "servers" && <Servers />}
      {nav.view === "server" && <ServerDetail id={nav.id!} tab="overview" />}
      {nav.view === "settings" && <ServerDetail id={nav.id!} tab="settings" />}
      {nav.view === "files" && <ServerDetail id={nav.id!} tab="files" />}
      {nav.view === "backups" && <ServerDetail id={nav.id!} tab="backups" />}
      {nav.view === "create" && <CreateServer />}
      {nav.view === "jobs" && <Jobs />}
      {nav.view === "appSettings" && <AppSettings />}
    </Shell>
  );
}

function parseRoute(pathname: string): { view: View; id?: string } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "create") return { view: "create" };
  if (parts[0] === "jobs") return { view: "jobs" };
  if (parts[0] === "settings") return { view: "appSettings" };
  if (parts[0] === "servers" && parts[1]) {
    if (parts[2] === "settings") return { view: "settings", id: parts[1] };
    if (parts[2] === "files") return { view: "files", id: parts[1] };
    if (parts[2] === "backups") return { view: "backups", id: parts[1] };
    return { view: "server", id: parts[1] };
  }
  return { view: "servers" };
}

function go(path: string) {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      onLogin(await api.request<AuthUser>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }));
      go("/servers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="login">
      <form className="loginPanel" onSubmit={submit}>
        <HardDrive size={34} />
        <h1>Minecraft Server Configurator</h1>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary">Sign in</button>
      </form>
    </main>
  );
}

function Shell({ user, active, onLogout, children }: { user: AuthUser; active: View; onLogout: () => void; children: React.ReactNode }) {
  async function logout() {
    await api.request("/auth/logout", { method: "POST" });
    onLogout();
    go("/login");
  }

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <HardDrive />
          <strong>MCSC</strong>
        </div>
        <nav>
          <NavButton active={["servers", "server", "settings", "files", "backups"].includes(active)} icon={<Terminal />} label="Servers" path="/servers" />
          <NavButton active={active === "create"} icon={<FolderPlus />} label="Create" path="/create" />
          <NavButton active={active === "jobs"} icon={<History />} label="Jobs" path="/jobs" />
          <NavButton active={active === "appSettings"} icon={<Settings />} label="Settings" path="/settings" />
        </nav>
        <button className="ghost user" onClick={logout} title={`Signed in as ${user.username}`}>
          <LogOut size={18} />
          {user.username}
        </button>
      </aside>
      <main>{children}</main>
    </div>
  );
}

function NavButton({ active, icon, label, path }: { active: boolean; icon: React.ReactNode; label: string; path: string }) {
  return (
    <button className={active ? "active" : ""} onClick={() => go(path)}>
      {icon}
      {label}
    </button>
  );
}

function Servers() {
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setServers(await api.request<ManagedServer[]>("/servers"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function importServers() {
    setPreview(await api.request<ImportPreview>("/servers/import/preview"));
  }

  return (
    <section>
      <Header title="Servers" subtitle="Systemd-backed Minecraft instances" actions={<><button onClick={importServers}><RefreshCw size={16} />Import</button><button className="primary" onClick={() => go("/create")}><FolderPlus size={16} />New server</button></>} />
      {error && <p className="error">{error}</p>}
      {preview && <ImportPreviewPanel preview={preview} onClose={() => setPreview(null)} onImported={(items) => { setServers(items); setPreview(null); }} />}
      {loading ? <p className="muted">Loading servers...</p> : null}
      <div className="serverGrid">
        {servers.map((server) => <ServerCard key={server.id} server={server} onReload={load} />)}
        {!loading && servers.length === 0 && <EmptyState title="No servers registered" action="Import existing directories or create a new server." />}
      </div>
    </section>
  );
}

function ImportPreviewPanel({ preview, onClose, onImported }: { preview: ImportPreview; onClose: () => void; onImported: (servers: ManagedServer[]) => void }) {
  const [selected, setSelected] = useState(() => new Set(preview.items.filter((item) => !item.alreadyImported && item.confidence !== "unmatched").map((item) => item.id)));
  const [unitNames, setUnitNames] = useState(() => Object.fromEntries(preview.items.map((item) => [item.id, item.unitName])));
  const [message, setMessage] = useState("");

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function confirmImport() {
    const result = await api.request<{ imported: number; servers: ManagedServer[] }>("/servers/import", {
      method: "POST",
      body: JSON.stringify({ selections: Array.from(selected).map((id) => ({ id, unitName: unitNames[id] })) })
    });
    setMessage(`Imported ${result.imported} server${result.imported === 1 ? "" : "s"}.`);
    onImported(result.servers);
  }

  return (
    <div className="panel importPanel">
      <div className="toolbar">
        <strong>Import preview</strong>
        <span className="muted">{preview.serverRoot}</span>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="previewList">
        {preview.items.map((item) => (
          <label className="previewItem" key={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} disabled={item.alreadyImported} onChange={() => toggle(item.id)} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.directory}</small>
              <small>{item.unitName} - {item.confidence} via {item.unitMatchSource}</small>
              <input
                value={unitNames[item.id] ?? ""}
                disabled={item.alreadyImported}
                onChange={(event) => setUnitNames({ ...unitNames, [item.id]: event.target.value })}
                aria-label={`Systemd service for ${item.name}`}
              />
              <small>{item.scripts.filter((script) => script.safe).length} safe scripts, {item.externalSchedules.length} external schedules</small>
              {item.warnings.length > 0 && <small className="warnText">{item.warnings.join(" ")}</small>}
            </span>
          </label>
        ))}
      </div>
      {preview.unmatchedServices.length > 0 && <p className="warn">Unmatched services found: {preview.unmatchedServices.map((service) => service.unitName).join(", ")}</p>}
      <div className="formActions"><button className="primary" onClick={confirmImport}>Import selected</button>{message && <span className="ok">{message}</span>}</div>
    </div>
  );
}

function ServerCard({ server, onReload }: { server: ManagedServer; onReload: () => void }) {
  async function action(actionName: "start" | "stop" | "restart") {
    await api.request(`/servers/${server.id}/${actionName}`, { method: "POST" });
    await onReload();
  }

  return (
    <article className="serverCard">
      <button className="cardLink" onClick={() => go(`/servers/${server.id}`)}>
        <span>
          <strong>{server.name}</strong>
          <small>{server.unitName}</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <div className="meta">
        <Status value={server.status} />
        <span>{server.port}</span>
        <span>{server.memoryMb} MB</span>
      </div>
      <div className="actions">
        <button title="Start" onClick={() => action("start")}><Play size={16} /></button>
        <button title="Stop" onClick={() => action("stop")}><Square size={16} /></button>
        <button title="Restart" onClick={() => action("restart")}><RefreshCw size={16} /></button>
      </div>
    </article>
  );
}

function ServerDetail({ id, tab }: { id: string; tab: "overview" | "settings" | "files" | "backups" }) {
  const [server, setServer] = useState<ManagedServer | null>(null);
  const [logs, setLogs] = useState("");

  async function load() {
    const servers = await api.request<ManagedServer[]>("/servers");
    setServer(servers.find((item) => item.id === id) ?? null);
  }

  useEffect(() => {
    void load();
    if (tab === "overview") api.request<string>(`/servers/${id}/logs`).then(setLogs).catch((error) => setLogs(error.message));
  }, [id, tab]);

  if (!server) return <p className="muted">Loading server...</p>;

  return (
    <section>
      <Header title={server.name} subtitle={server.directory} actions={<Status value={server.status} />} />
      <div className="tabs">
        <button className={tab === "overview" ? "selected" : ""} onClick={() => go(`/servers/${id}`)}>Overview</button>
        <button className={tab === "settings" ? "selected" : ""} onClick={() => go(`/servers/${id}/settings`)}>Settings</button>
        <button className={tab === "files" ? "selected" : ""} onClick={() => go(`/servers/${id}/files`)}>Files</button>
        <button className={tab === "backups" ? "selected" : ""} onClick={() => go(`/servers/${id}/backups`)}>Backups</button>
      </div>
      {tab === "overview" && <Overview server={server} logs={logs} />}
      {tab === "settings" && <ServerSettings server={server} onSaved={load} />}
      {tab === "files" && <FileEditor server={server} />}
      {tab === "backups" && <Backups server={server} />}
    </section>
  );
}

function Overview({ server, logs }: { server: ManagedServer; logs: string }) {
  return (
    <div className="split">
      <div className="panel">
        <h2>Runtime</h2>
        <dl>
          <dt>Unit</dt><dd>{server.unitName}</dd>
          <dt>Port</dt><dd>{server.port}</dd>
          <dt>Memory</dt><dd>{server.memoryMb} MB</dd>
          <dt>Backup</dt><dd>{server.backupCron} / {server.backupMode}</dd>
        </dl>
        <ServerActions server={server} />
      </div>
      <div className="panel logs">
        <h2>Recent logs</h2>
        <pre>{logs}</pre>
      </div>
    </div>
  );
}

function ServerActions({ server }: { server: ManagedServer }) {
  const [actions, setActions] = useState<ServerAction[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.request<ServerAction[]>(`/servers/${server.id}/actions`).then(setActions).catch(() => setActions([]));
  }, [server.id]);

  async function run(action: ServerAction) {
    setMessage(`Running ${action.name}...`);
    const result = await api.request<{ stdout: string; stderr: string }>(`/servers/${server.id}/actions/${action.id}/run`, { method: "POST" });
    setMessage(result.stdout || `${action.name} completed.`);
  }

  if (actions.length === 0) return <p className="muted actionNote">No discovered server scripts registered.</p>;

  return (
    <div className="actionPanel">
      <h2>Script actions</h2>
      <div className="actions">{actions.map((action) => <button key={action.id} onClick={() => run(action)}><Wrench size={16} />{action.name}</button>)}</div>
      {message && <pre className="actionOutput">{message}</pre>}
    </div>
  );
}

function ServerSettings({ server, onSaved }: { server: ManagedServer; onSaved: () => void }) {
  const [form, setForm] = useState(server);
  const [message, setMessage] = useState("");
  const [serviceTest, setServiceTest] = useState<ServiceTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await api.request(`/servers/${server.id}/settings`, { method: "PUT", body: JSON.stringify(form) });
    setMessage("Settings saved.");
    onSaved();
  }

  async function testCurrentService() {
    setTesting(true);
    setServiceTest(null);
    try {
      setServiceTest(await api.request<ServiceTestResult>(`/servers/${server.id}/service/test`, {
        method: "POST",
        body: JSON.stringify({ unitName: form.unitName })
      }));
    } finally {
      setTesting(false);
    }
  }

  return (
    <form className="panel formGrid" onSubmit={save}>
      <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="serviceField">
        Systemd service
        <span>
          <input value={form.unitName} onChange={(e) => setForm({ ...form, unitName: e.target.value })} />
          <button type="button" onClick={testCurrentService} disabled={testing}>{testing ? "Testing..." : "Test"}</button>
        </span>
      </label>
      <label>Port<input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
      <label>Memory MB<input type="number" value={form.memoryMb} onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })} /></label>
      <label>Java args<input value={form.javaArgs} onChange={(e) => setForm({ ...form, javaArgs: e.target.value })} /></label>
      <label>Backup cron<input value={form.backupCron} onChange={(e) => setForm({ ...form, backupCron: e.target.value })} /></label>
      <label>Retention<input type="number" value={form.backupRetention} onChange={(e) => setForm({ ...form, backupRetention: Number(e.target.value) })} /></label>
      <label className="check"><input type="checkbox" checked={form.rconEnabled} onChange={(e) => setForm({ ...form, rconEnabled: e.target.checked })} />RCON enabled</label>
      <label>Backup mode<select value={form.backupMode} onChange={(e) => setForm({ ...form, backupMode: e.target.value as ManagedServer["backupMode"] })}><option value="online">Online</option><option value="stop_then_backup">Stop then backup</option></select></label>
      {serviceTest && <p className={serviceTest.existsLikely ? "ok serviceResult" : "warn serviceResult"}>{serviceTest.message}</p>}
      <div className="formActions"><button className="primary"><Save size={16} />Save</button>{message && <span className="ok">{message}</span>}</div>
    </form>
  );
}

function FileEditor({ server }: { server: ManagedServer }) {
  const [files, setFiles] = useState<EditableFile[]>([]);
  const [active, setActive] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.request<EditableFile[]>(`/servers/${server.id}/files`).then((items) => {
      setFiles(items);
      setActive(items[0]?.key ?? "");
    });
  }, [server.id]);

  useEffect(() => {
    if (active) api.request<EditableFile & { content: string }>(`/servers/${server.id}/files/${active}`).then((file) => setContent(file.content));
  }, [active, server.id]);

  async function save() {
    await api.request(`/servers/${server.id}/files/${active}`, { method: "PUT", body: JSON.stringify({ content }) });
    setMessage("File saved.");
  }

  return (
    <div className="split">
      <div className="panel fileList">{files.map((file) => <button className={file.key === active ? "selected" : ""} key={file.key} onClick={() => setActive(file.key)}><FileText size={16} />{file.label}</button>)}</div>
      <div className="panel editor">
        <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
        <div className="formActions"><button className="primary" onClick={save}><Save size={16} />Save file</button>{message && <span className="ok">{message}</span>}</div>
      </div>
    </div>
  );
}

function Backups({ server }: { server: ManagedServer }) {
  const [items, setItems] = useState<Record<string, string>[]>([]);
  const [externalSchedules, setExternalSchedules] = useState<ExternalSchedule[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    setItems(await api.request<Record<string, string>[]>(`/servers/${server.id}/backups`));
    setExternalSchedules(await api.request<ExternalSchedule[]>(`/servers/${server.id}/external-schedules`));
  }

  useEffect(() => {
    void load();
  }, [server.id]);

  async function run() {
    const result = await api.request<Record<string, string>>(`/servers/${server.id}/backups/run`, { method: "POST" });
    setMessage(result.message ?? "Backup queued.");
    await load();
  }

  return (
    <div className="panel">
      <div className="toolbar"><button className="primary" onClick={run}><Archive size={16} />Run backup</button>{message && <span>{message}</span>}</div>
      {!server.rconEnabled && server.backupMode === "online" && <p className="warn">Online backups need RCON enabled. Switch this server to stop-then-backup or enable RCON before relying on scheduled backups.</p>}
      <div className="scheduleSplit">
        <div>
          <h2>App-managed schedule</h2>
          <p><strong>{server.backupCron}</strong> / {server.backupMode} / keep {server.backupRetention}</p>
        </div>
        <div>
          <h2>External crontab schedules</h2>
          {externalSchedules.length === 0 ? <p className="muted">No matching crontab entries imported.</p> : (
            <table><thead><tr><th>When</th><th>Kind</th><th>Command</th></tr></thead><tbody>{externalSchedules.map((item) => <tr key={item.id}><td>{item.expression}</td><td>{item.kind}</td><td>{item.command}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
      <table><thead><tr><th>Created</th><th>Status</th><th>Mode</th><th>Message</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.created_at}</td><td>{item.status}</td><td>{item.mode}</td><td>{item.message}</td></tr>)}</tbody></table>
    </div>
  );
}

function CreateServer() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModpackSearchResult[]>([]);
  const [selected, setSelected] = useState<ModpackSearchResult | null>(null);
  const [versions, setVersions] = useState<ModpackVersion[]>([]);
  const [versionId, setVersionId] = useState("");
  const [form, setForm] = useState({ name: "", port: 25565, memoryMb: 4096, javaArgs: "-Xms1G", acceptEula: false });
  const [job, setJob] = useState("");

  async function search() {
    setResults(await api.request<ModpackSearchResult[]>(`/modpacks/search?q=${encodeURIComponent(query)}`));
  }

  async function pick(item: ModpackSearchResult) {
    setSelected(item);
    const loaded = await api.request<ModpackVersion[]>(`/modpacks/${item.provider}/${item.id}/versions`);
    setVersions(loaded);
    setVersionId(loaded[0]?.id ?? "");
    setForm((value) => ({ ...value, name: value.name || item.name }));
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const body: CreateServerRequest = { ...form, provider: selected.provider, modpackId: selected.id, modpackName: selected.name, versionId };
    const result = await api.request<{ id: string }>("/servers/create", { method: "POST", body: JSON.stringify(body) });
    setJob(result.id);
    go("/jobs");
  }

  return (
    <section>
      <Header title="Create server" subtitle="Guided modpack install and systemd registration" />
      <div className="split">
        <div className="panel">
          <div className="search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Modrinth or CurseForge" /><button onClick={search}><Search size={16} />Search</button></div>
          <div className="results">{results.map((item) => <button key={`${item.provider}-${item.id}`} onClick={() => pick(item)} className={selected?.id === item.id ? "selected result" : "result"}><strong>{item.name}</strong><small>{item.provider} - {item.summary}</small></button>)}</div>
        </div>
        <form className="panel formGrid" onSubmit={create}>
          <label>Version<select value={versionId} onChange={(e) => setVersionId(e.target.value)}>{versions.map((version) => <option value={version.id} key={version.id}>{version.name}{version.hasServerDownload ? "" : " (manual files)"}</option>)}</select></label>
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Port<input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
          <label>Memory MB<input type="number" value={form.memoryMb} onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })} /></label>
          <label>Java args<input value={form.javaArgs} onChange={(e) => setForm({ ...form, javaArgs: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.acceptEula} onChange={(e) => setForm({ ...form, acceptEula: e.target.checked })} />I accept the Minecraft EULA for this server</label>
          <div className="formActions"><button className="primary" disabled={!selected || !versionId}><FolderPlus size={16} />Create</button>{job && <span>{job}</span>}</div>
        </form>
      </div>
    </section>
  );
}

function Jobs() {
  const [id, setId] = useState("");
  const [job, setJob] = useState<InstallJob | null>(null);
  async function load() {
    if (id) setJob(await api.request<InstallJob>(`/jobs/${id}`));
  }
  return (
    <section>
      <Header title="Jobs" subtitle="Install and maintenance progress" />
      <div className="panel">
        <div className="search"><input value={id} onChange={(e) => setId(e.target.value)} placeholder="Job id" /><button onClick={load}><RefreshCw size={16} />Load</button></div>
        {job && <div className="job"><strong>{job.step}</strong><progress value={job.progress} max={100} /><span>{job.status}</span><p>{job.message}</p></div>}
      </div>
    </section>
  );
}

function AppSettings() {
  const [settings, setSettings] = useState<Record<string, string | boolean> | null>(null);
  const [audit, setAudit] = useState<Record<string, string>[]>([]);
  useEffect(() => {
    api.request<Record<string, string | boolean>>("/settings").then(setSettings);
    api.request<Record<string, string>[]>("/audit").then(setAudit);
  }, []);
  return (
    <section>
      <Header title="Settings" subtitle="Configurator runtime and audit log" />
      <div className="split">
        <div className="panel"><h2>Runtime</h2><pre>{JSON.stringify(settings, null, 2)}</pre></div>
        <div className="panel"><h2>Audit</h2><table><tbody>{audit.map((item) => <tr key={item.id}><td>{item.created_at}</td><td>{item.actor}</td><td>{item.action}</td><td>{item.target}</td></tr>)}</tbody></table></div>
      </div>
    </section>
  );
}

function Header({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <header className="pageHeader"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="headerActions">{actions}</div></header>;
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}><Clock size={14} />{value}</span>;
}

function EmptyState({ title, action }: { title: string; action: string }) {
  return <div className="empty"><Wrench size={28} /><strong>{title}</strong><span>{action}</span></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
