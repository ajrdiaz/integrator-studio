import React from "react";
import type { Box, ScreenScene, StepClip } from "../../src/schemas/storyboard";
import type { TimelineScene } from "../../src/schemas/timeline";

type Screen = NonNullable<TimelineScene["screen"]>;
const SRC_W = 1920;
const SRC_H = 1080;

/**
 * Fotograma de la grabación del ERP con rectángulos superpuestos. Si `onDraw` está definido, se puede
 * arrastrar para dibujar un rectángulo nuevo (coordenadas de la grabación, 1920x1080).
 */
const ClipFrame: React.FC<{
  jobId: string;
  time: number;
  boxes: { box: Box; color: string; label?: string }[];
  onDraw?: (b: Box) => void;
}> = ({ jobId, time, boxes, onDraw }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const toSrc = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SRC_W, y: ((e.clientY - r.top) / r.height) * SRC_H };
  };
  const pct = (b: Box): React.CSSProperties => ({
    left: `${(b.x / SRC_W) * 100}%`,
    top: `${(b.y / SRC_H) * 100}%`,
    width: `${(b.width / SRC_W) * 100}%`,
    height: `${(b.height / SRC_H) * 100}%`,
  });
  const norm = (d: NonNullable<typeof drag>): Box => ({
    x: Math.round(Math.min(d.x0, d.x1)),
    y: Math.round(Math.min(d.y0, d.y1)),
    width: Math.round(Math.abs(d.x1 - d.x0)),
    height: Math.round(Math.abs(d.y1 - d.y0)),
  });

  return (
    <div
      ref={ref}
      className={`clip-frame ${onDraw ? "drawing" : ""}`}
      onPointerDown={(e) => {
        if (!onDraw) return;
        const p = toSrc(e);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toSrc(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (drag && onDraw) {
          const b = norm(drag);
          if (b.width > 8 && b.height > 8) onDraw(b);
        }
        setDrag(null);
      }}
    >
      <img src={`/api/jobs/${jobId}/frame?t=${Math.max(0, time).toFixed(1)}`} alt="Fotograma de la grabación" draggable={false} />
      {boxes.map((b, i) => (
        <div key={i} className="clip-box" style={{ ...pct(b.box), borderColor: b.color, background: `${b.color}22` }}>
          {b.label ? <span style={{ background: b.color }}>{b.label}</span> : null}
        </div>
      ))}
      {drag ? <div className="clip-box drag" style={pct(norm(drag))} /> : null}
    </div>
  );
};

const SPEEDS = [
  { v: "", label: "Auto" },
  { v: "0.75", label: "0,75x" },
  { v: "1", label: "1x (real)" },
  { v: "1.25", label: "1,25x" },
  { v: "1.5", label: "1,5x" },
  { v: "2", label: "2x" },
];

/** Editor del clip de una escena de pantalla: recortes, velocidad, zoom, resaltado y zonas difuminadas. */
export const ClipEditor: React.FC<{
  jobId: string;
  scene: ScreenScene;
  screen?: Screen;
  disabled: boolean;
  onChange: (scene: ScreenScene) => void;
  onStepVoice: (stepId: string) => void;
}> = ({ jobId, scene, screen, disabled, onChange, onStepVoice }) => {
  const [mode, setMode] = React.useState<{ kind: "blur" } | { kind: "zoom"; stepId: string } | null>(null);
  const [frameStep, setFrameStep] = React.useState<string | null>(scene.steps[0]?.id ?? null);

  if (!screen) {
    return <p className="muted small">El editor de clip estará disponible cuando la escena esté grabada.</p>;
  }
  const recStep = (id: string) => screen.steps.find((s) => s.stepId === id);
  const stepLen = (id: string) => {
    const s = recStep(id);
    return s ? s.end - s.start : 0;
  };
  const frameTime = (() => {
    const s = frameStep ? recStep(frameStep) : undefined;
    return screen.start + (s ? s.start + (s.end - s.start) * 0.85 : 0);
  })();

  const setClip = (stepId: string, patch: Partial<StepClip>) => {
    onChange({
      ...scene,
      steps: scene.steps.map((st) => {
        if (st.id !== stepId) return st;
        const clip = { ...(st.clip ?? {}), ...patch };
        for (const k of Object.keys(clip) as (keyof StepClip)[]) if (clip[k] === undefined) delete clip[k];
        return { ...st, clip: Object.keys(clip).length ? clip : undefined };
      }),
    });
  };
  const blur = scene.clip?.blur ?? [];
  const setBlur = (next: Box[]) => onChange({ ...scene, clip: next.length ? { ...(scene.clip ?? {}), blur: next } : undefined });

  const boxes = [
    ...blur.map((b, i) => ({ box: b, color: "#c9423e", label: `Difuminar ${i + 1}` })),
    ...scene.steps
      .filter((st) => st.id === frameStep && st.clip?.zoom === "fixed" && st.clip.zoomBox)
      .map((st) => ({ box: st.clip!.zoomBox!, color: "#2f4fa8", label: "Zoom fijo" })),
  ];

  return (
    <div className="clip-editor">
      <div className="clip-toolbar">
        <span className="muted small">Fotograma del paso:</span>
        <select value={frameStep ?? ""} onChange={(e) => setFrameStep(e.target.value)}>
          {scene.steps.map((st) => (
            <option key={st.id} value={st.id}>
              {st.id}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className={`ghost small ${mode?.kind === "blur" ? "active" : ""}`} disabled={disabled} onClick={() => setMode(mode?.kind === "blur" ? null : { kind: "blur" })}>
          {mode?.kind === "blur" ? "Arrastra sobre la imagen…" : "+ Zona a difuminar"}
        </button>
      </div>
      <ClipFrame
        jobId={jobId}
        time={frameTime}
        boxes={boxes}
        onDraw={
          mode
            ? (b) => {
                if (mode.kind === "blur") setBlur([...blur, b]);
                else setClip(mode.stepId, { zoom: "fixed", zoomBox: b });
                setMode(null);
              }
            : undefined
        }
      />
      {blur.length ? (
        <div className="chips">
          {blur.map((_, i) => (
            <button key={i} className="chip" disabled={disabled} onClick={() => setBlur(blur.filter((__, j) => j !== i))}>
              Quitar difuminado {i + 1} ✕
            </button>
          ))}
        </div>
      ) : null}

      <table className="clip-steps">
        <thead>
          <tr>
            <th>Paso</th>
            <th>Recorte inicio (s)</th>
            <th>Recorte final (s)</th>
            <th>Velocidad</th>
            <th>Zoom</th>
            <th>Resaltado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {scene.steps.map((st) => {
            const c = st.clip ?? {};
            const len = stepLen(st.id);
            return (
              <tr key={st.id} className={frameStep === st.id ? "current" : ""} onClick={() => setFrameStep(st.id)}>
                <td>
                  <strong>{st.id}</strong>
                  <div className="muted small">{len.toFixed(1)} s grabados</div>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, len - 0.3)}
                    step={0.1}
                    value={c.trimStart ?? 0}
                    disabled={disabled}
                    onChange={(e) => setClip(st.id, { trimStart: Number(e.target.value) || undefined })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, len - 0.3)}
                    step={0.1}
                    value={c.trimEnd ?? 0}
                    disabled={disabled}
                    onChange={(e) => setClip(st.id, { trimEnd: Number(e.target.value) || undefined })}
                  />
                </td>
                <td>
                  <select value={c.speed?.toString() ?? ""} disabled={disabled} onChange={(e) => setClip(st.id, { speed: e.target.value ? Number(e.target.value) : undefined })}>
                    {SPEEDS.map((s) => (
                      <option key={s.v} value={s.v}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.zoom ?? "auto"}
                    disabled={disabled}
                    onChange={(e) => {
                      const z = e.target.value as StepClip["zoom"];
                      if (z === "fixed") {
                        setFrameStep(st.id);
                        setMode({ kind: "zoom", stepId: st.id });
                      } else setClip(st.id, { zoom: z === "auto" ? undefined : z, zoomBox: undefined });
                    }}
                  >
                    <option value="auto">Auto</option>
                    <option value="off">Sin zoom</option>
                    <option value="fixed">{c.zoomBox ? "Fijo ✓" : "Fijo…"}</option>
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={c.highlight !== false} disabled={disabled} onChange={(e) => setClip(st.id, { highlight: e.target.checked ? undefined : false })} />
                </td>
                <td>
                  <button className="ghost small" disabled={disabled || !st.narration} onClick={() => onStepVoice(st.id)} title="Vuelve a sintetizar la voz de este paso">
                    Voz ↻
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {mode?.kind === "zoom" ? <p className="hint">Dibuja sobre la imagen la zona a la que debe acercarse la cámara en {mode.stepId}.</p> : null}
    </div>
  );
};
