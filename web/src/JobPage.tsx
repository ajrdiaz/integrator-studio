import React from "react";
import { FORMATS, Storyboard as StoryboardSchema, checkStoryboard, type Format, type Storyboard } from "../../src/schemas/storyboard";
import { api, type JobView, type RunBody, type RunEvent } from "./api";
import { Preview, previewTimeline } from "./Preview";

const STAGE_LABEL: Record<string, string> = {
  storyboard: "Guion",
  explore: "Exploración",
  record: "Grabación",
  tts: "Voz",
  compose: "Composición",
  render: "Render",
};

const VOICES = [
  { id: "", label: "Automática (ElevenLabs si hay clave, si no Kokoro)" },
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "kokoro", label: "Kokoro (local)" },
  { id: "silent", label: "Silencio (prueba)" },
  { id: "none", label: "Sin voz ni subtítulos" },
];

type Tab = "scenes" | "json" | "versions";

export const JobPage: React.FC<{ id: string; onChanged: () => void }> = ({ id, onChanged }) => {
  const [view, setView] = React.useState<JobView | null>(null);
  const [draft, setDraft] = React.useState<Storyboard | null>(null);
  const [jsonText, setJsonText] = React.useState("");
  const [tab, setTab] = React.useState<Tab>("scenes");
  const [errors, setErrors] = React.useState<string[]>([]);
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [formats, setFormats] = React.useState<Format[]>(["16x9"]);
  const [voice, setVoice] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const dirtyRef = React.useRef(false);

  const load = React.useCallback(async () => {
    const v = await api.get(id);
    setView(v);
    return v;
  }, [id]);

  // Carga inicial: el borrador parte del storyboard guardado.
  React.useEffect(() => {
    load().then((v) => {
      if (v.storyboard) {
        setDraft(v.storyboard);
        setJsonText(JSON.stringify(v.storyboard, null, 2));
        setFormats(v.manifest.request.formats.length ? v.manifest.request.formats : ["16x9"]);
      }
    });
  }, [load]);

  // Progreso en vivo; al terminar se recarga el job (y el borrador si aún no existía).
  React.useEffect(
    () =>
      api.events(id, (e) => {
        setEvents((prev) => [...prev.slice(-200), e]);
        if (e.type === "status" && (e.status === "done" || e.status === "error")) {
          load().then((v) => {
            // Si hay un guion nuevo (p. ej. "Reescribir guion") y no hay cambios locales, se muestra.
            if (v.storyboard && !dirtyRef.current) {
              setDraft(v.storyboard);
              setJsonText(JSON.stringify(v.storyboard, null, 2));
            }
          });
          onChanged();
        }
      }),
    [id, load, onChanged],
  );

  const saved = view?.storyboard ?? null;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const running = view?.runtime === "queued" || view?.runtime === "running";
  dirtyRef.current = dirty;

  const updateDraft = (sb: Storyboard) => {
    setDraft(sb);
    setJsonText(JSON.stringify(sb, null, 2));
    setErrors(checkStoryboard(sb));
  };

  const onJson = (text: string) => {
    setJsonText(text);
    try {
      const parsed = StoryboardSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      const errs = checkStoryboard(parsed.data);
      setErrors(errs);
      if (!errs.length) setDraft(parsed.data);
    } catch (e) {
      setErrors([`JSON inválido: ${(e as Error).message}`]);
    }
  };

  const save = async () => {
    if (!draft) return false;
    setSaving(true);
    try {
      const v = await api.saveStoryboard(id, draft);
      setView(v);
      setErrors([]);
      return true;
    } catch (e) {
      setErrors((e as Error & { details?: string[] }).details ?? [(e as Error).message]);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const body = (extra: RunBody = {}): RunBody => ({ formats, tts: voice === "none" ? false : voice || undefined, ...extra });

  const produce = async (extra: RunBody = {}) => {
    if (dirty && !(await save())) return;
    setEvents([]);
    await api.run(id, body(extra));
    load();
  };

  const regenVoice = async (sceneId: string) => {
    if (dirty && !(await save())) return;
    setEvents([]);
    await api.sceneVoice(id, sceneId, body());
    load();
  };

  const restore = async (v: number) => {
    const sb = await api.history(id, v);
    updateDraft(sb);
    setTab("scenes");
  };

  if (!view) return <div className="loading">Cargando…</div>;
  const m = view.manifest;
  const preview = draft ? previewTimeline(draft, view.timeline, id) : null;
  const versions = [...new Set(m.renders.map((r) => r.version))].sort((a, b) => b - a);

  return (
    <div className="job">
      <header className="job-head">
        <div>
          <div className="eyebrow">
            <span className={`kind ${m.request.kind}`}>{m.request.kind}</span> {m.id}
          </div>
          <h1>{draft?.title ?? m.request.raw}</h1>
          <p className="muted">Pedido: “{m.request.raw}”</p>
        </div>
        <div className="stages">
          {(["storyboard", "explore", "record", "tts", "compose", "render"] as const)
            .filter((s) => (s !== "explore" && s !== "record") || draft?.scenes.some((x) => x.type === "screen"))
            .map((s) => {
            const st = m.stages[s]?.status ?? "pending";
            return (
              <span key={s} className={`stage ${st}`} title={m.stages[s]?.error ?? ""}>
                {STAGE_LABEL[s]}
              </span>
            );
          })}
        </div>
      </header>

      {!draft ? (
        <section className="card">
          <h3>Escribiendo el guion…</h3>
          <p className="muted">Claude está preparando el storyboard. Aparecerá aquí para que lo revises.</p>
          <Log events={events} />
        </section>
      ) : (
        <div className="job-grid">
          <section className="card editor">
            <div className="tabs">
              <button className={tab === "scenes" ? "on" : ""} onClick={() => setTab("scenes")}>
                Escenas
              </button>
              <button className={tab === "json" ? "on" : ""} onClick={() => setTab("json")}>
                JSON
              </button>
              <button className={tab === "versions" ? "on" : ""} onClick={() => setTab("versions")}>
                Versiones ({view.history.length})
              </button>
              <span className="spacer" />
              {dirty ? <span className="dirty">Cambios sin guardar</span> : null}
              <button className="ghost" disabled={!dirty || saving || errors.length > 0} onClick={save}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>

            {errors.length ? (
              <ul className="errors">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}

            {tab === "scenes" ? (
              <SceneList
                sb={draft}
                stale={preview?.staleVoice ?? []}
                disabled={running}
                onChange={updateDraft}
                onVoice={regenVoice}
              />
            ) : null}
            {tab === "json" ? <textarea className="json" spellCheck={false} value={jsonText} onChange={(e) => onJson(e.target.value)} /> : null}
            {tab === "versions" ? (
              <div className="versions">
                <h4>Guion</h4>
                {view.history.map((v) => (
                  <div key={v} className="version-row">
                    <span>v{v}{v === m.storyboardVersion ? " (actual)" : ""}</span>
                    <button className="ghost" onClick={() => restore(v)}>
                      Cargar en el editor
                    </button>
                  </div>
                ))}
                <h4>Renders</h4>
                {versions.length === 0 ? <p className="muted">Aún no hay renders.</p> : null}
                {versions.map((v) => (
                  <div key={v} className="version-row">
                    <span>
                      v{v} · guion v{m.renders.find((r) => r.version === v)?.storyboardVersion}
                    </span>
                    <span className="links">
                      {m.renders
                        .filter((r) => r.version === v)
                        .map((r) => (
                          <a key={r.file} href={`/jobs/${m.id}/${r.file}`} target="_blank" rel="noreferrer">
                            {r.format.replace("x", ":")}
                          </a>
                        ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="side">
            {preview ? <Preview timeline={preview.timeline} /> : null}
            {preview?.staleVoice.length ? (
              <p className="hint">La voz de {preview.staleVoice.join(", ")} se regenerará al producir (la narración cambió).</p>
            ) : null}

            <div className="card produce">
              <h3>Producir</h3>
              <div className="row">
                <span className="label">Formatos</span>
                {FORMATS.map((f) => (
                  <label key={f} className="check">
                    <input
                      type="checkbox"
                      checked={formats.includes(f)}
                      onChange={(e) => setFormats((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))}
                    />
                    {f.replace("x", ":")}
                  </label>
                ))}
              </div>
              <div className="row">
                <span className="label">Voz</span>
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row buttons">
                <button className="primary" disabled={running || !formats.length || errors.length > 0} onClick={() => produce()}>
                  {running ? "Procesando…" : dirty ? "Guardar y producir" : "Producir video"}
                </button>
                <button className="ghost" disabled={running} onClick={() => produce({ from: "render" })} title="Vuelve a renderizar sin tocar voz ni guion">
                  Solo render
                </button>
                <button
                  className="ghost"
                  disabled={running}
                  onClick={() => produce({ from: "storyboard", until: "storyboard" })}
                  title="Pide a Claude un guion nuevo (queda como nueva versión)"
                >
                  Reescribir guion
                </button>
                {draft.scenes.some((x) => x.type === "screen") ? (
                  <>
                    <button className="ghost" disabled={running} onClick={() => produce({ from: "record" })} title="Vuelve a grabar el ERP con el mismo plan (sin IA)">
                      Regrabar ERP
                    </button>
                    <button className="ghost" disabled={running} onClick={() => produce({ from: "explore" })} title="El agente vuelve a explorar el ERP y genera un plan nuevo">
                      Re-explorar ERP
                    </button>
                  </>
                ) : null}
              </div>
              <Log events={events} />
            </div>

            <Renders view={view} disabled={running} onAdd={(f) => produce({ formats: [f] })} />
          </section>
        </div>
      )}
    </div>
  );
};

const SceneList: React.FC<{
  sb: Storyboard;
  stale: string[];
  disabled: boolean;
  onChange: (sb: Storyboard) => void;
  onVoice: (id: string) => void;
}> = ({ sb, stale, disabled, onChange, onVoice }) => {
  const set = (i: number, patch: Partial<Storyboard["scenes"][number]>) => {
    const scenes = sb.scenes.map((s, j) => (j === i ? ({ ...s, ...patch } as typeof s) : s));
    onChange({ ...sb, scenes });
  };
  const total = sb.scenes.reduce((a, s) => a + s.estDurationSec, 0) + 7;
  return (
    <div className="scenes">
      <div className="scenes-meta">
        <label>
          Título
          <input value={sb.title} onChange={(e) => onChange({ ...sb, title: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={sb.music} onChange={(e) => onChange({ ...sb, music: e.target.checked })} />
          Música de fondo
        </label>
        <span className="muted">≈ {total.toFixed(1)} s con intro y cierre</span>
      </div>
      {sb.scenes.map((s, i) => (
        <div key={s.id} className="scene">
          <div className="scene-head">
            <span className="scene-n">{i + 1}</span>
            <span className="scene-id">{s.id}</span>
            <span className="tag">{s.type === "motion" ? s.template : "pantalla"}</span>
            {stale.includes(s.id) ? <span className="tag warn">voz desactualizada</span> : null}
            <span className="spacer" />
            <button className="ghost small" disabled={disabled} onClick={() => onVoice(s.id)} title="Sintetiza de nuevo la voz de esta escena y vuelve a renderizar">
              Regenerar voz
            </button>
          </div>
          <label>
            Texto en pantalla
            <input value={s.onScreenText} onChange={(e) => set(i, { onScreenText: e.target.value })} />
          </label>
          <label>
            Narración
            <textarea rows={2} value={s.narration} onChange={(e) => set(i, { narration: e.target.value })} />
          </label>
          <label className="inline">
            Duración estimada (s)
            <input
              type="number"
              min={1.5}
              step={0.5}
              value={s.estDurationSec}
              onChange={(e) => set(i, { estDurationSec: Number(e.target.value) })}
            />
          </label>
          {s.type === "screen" ? (
            <ol className="steps">
              {s.steps.map((st, k) => {
                const setStep = (patch: Partial<typeof st>) =>
                  set(i, { steps: s.steps.map((x, j) => (j === k ? { ...x, ...patch } : x)) } as never);
                return (
                  <li key={st.id}>
                    <div className="step-objective">{st.objective}</div>
                    <label>
                      Callout
                      <input value={st.callout} onChange={(e) => setStep({ callout: e.target.value })} />
                    </label>
                    <label>
                      Narración del paso
                      <textarea rows={2} value={st.narration ?? ""} onChange={(e) => setStep({ narration: e.target.value || undefined })} />
                    </label>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ))}
      <p className="muted small">Los datos de cada plantilla (ítems, cifras, gráficos) se editan en la pestaña JSON.</p>
    </div>
  );
};

const Log: React.FC<{ events: RunEvent[] }> = ({ events }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events]);
  if (!events.length) return null;
  return (
    <div className="log" ref={ref}>
      {events.map((e, i) => (
        <div key={i} className={`log-line ${e.status ?? ""}`}>
          <span className="log-stage">{e.stage ? STAGE_LABEL[e.stage] ?? e.stage : "●"}</span> {e.message}
        </div>
      ))}
    </div>
  );
};

const Renders: React.FC<{ view: JobView; disabled: boolean; onAdd: (f: Format) => void }> = ({ view, disabled, onAdd }) => {
  const m = view.manifest;
  const last = m.renders.reduce((a, r) => Math.max(a, r.version), 0);
  const files = m.renders.filter((r) => r.version === last);
  if (!files.length) return null;
  const missing = FORMATS.filter((f) => !files.some((r) => r.format === f));
  return (
    <div className="card renders">
      <div className="renders-head">
        <h3>Render v{last}</h3>
        <span className="links">
          {missing.map((f) => (
            <button key={f} className="ghost small" disabled={disabled} onClick={() => onAdd(f)} title="Genera este formato con el mismo contenido">
              + {f.replace("x", ":")}
            </button>
          ))}
        </span>
      </div>
      <div className="render-grid">
        {files.map((r) => (
          <figure key={r.file} className={`f${r.format}`}>
            <video src={`/jobs/${m.id}/${r.file}`} controls preload="metadata" />
            <figcaption>
              {r.format.replace("x", ":")} ·{" "}
              <a href={`/jobs/${m.id}/${r.file}`} download>
                Descargar
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
};
