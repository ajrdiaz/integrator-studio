import React from "react";
import { api, type JobSummary } from "./api";
import { JobPage } from "./JobPage";

const EXAMPLES = [
  "promo: sin costos ocultos, 30 s",
  "promo: facturación electrónica SUNAT sin complicaciones, 30 s, vertical",
  "tutorial: emitir una factura electrónica",
];

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  queued: "En cola",
  running: "Procesando",
  done: "Listo",
  error: "Error",
};

function useHashId(): [string | null, (id: string | null) => void] {
  const read = () => decodeURIComponent(location.hash.replace(/^#\/?/, "")) || null;
  const [id, setId] = React.useState(read);
  React.useEffect(() => {
    const on = () => setId(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [id, (v) => (location.hash = v ? `/${v}` : "")];
}

export const App: React.FC = () => {
  const [jobs, setJobs] = React.useState<JobSummary[]>([]);
  const [selected, setSelected] = useHashId();
  const [request, setRequest] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => api.list().then(setJobs).catch(() => undefined), []);
  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.create(request);
      setRequest("");
      await refresh();
      setSelected(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.svg" alt="Integrator" />
          <span>Video Studio</span>
        </div>
        <form className="new-request" onSubmit={submit}>
          <label htmlFor="req">Nuevo video</label>
          <textarea
            id="req"
            rows={3}
            placeholder='p. ej. "promo: sin costos ocultos, 30 s, vertical"'
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} className="chip" onClick={() => setRequest(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <button className="primary" disabled={busy || !request.trim()}>
            {busy ? "Creando…" : "Escribir guion"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        <nav className="job-list">
          <h3>Videos</h3>
          {jobs.length === 0 ? <p className="muted">Aún no hay videos.</p> : null}
          {jobs.map((j) => (
            <button key={j.id} className={`job-item ${selected === j.id ? "active" : ""}`} onClick={() => setSelected(j.id)}>
              <span className="job-title">{j.title ?? j.request.raw}</span>
              {j.title ? <span className="job-req">{j.request.raw}</span> : null}
              <span className="job-meta">
                <span className={`kind ${j.request.kind}`}>{j.request.kind}</span>
                {new Date(j.createdAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}
                {STATUS_LABEL[j.runtime] ? <span className={`status ${j.runtime}`}>{STATUS_LABEL[j.runtime]}</span> : null}
              </span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {selected ? (
          <JobPage key={selected} id={selected} onChanged={refresh} />
        ) : (
          <div className="empty">
            <h1>Crea un video de Integrator</h1>
            <p>
              Escribe un pedido a la izquierda. Claude escribe el guion, lo revisas y editas aquí, y luego se produce el
              video con voz, subtítulos y en los formatos que elijas.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
