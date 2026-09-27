import type { Recording } from "../schemas/recording-plan";
import { INTRO_SEC, OUTRO_SEC, type Storyboard } from "../schemas/storyboard";
import type { CaptionWord, Timeline, TimelineScene } from "../schemas/timeline";

export const FPS = 30;

/** Datos de voz por escena (Fase 2). */
export interface SceneAudio {
  src: string;
  durationSec: number;
  words?: { text: string; startSec: number; endSec: number }[];
}

export interface ComposeOptions {
  audio?: Record<string, SceneAudio>;
  music?: { src: string; volume: number };
  /** Grabación del ERP para las escenas de pantalla (Fase 3). */
  recording?: Recording;
  /** Silencio antes y después de la locución dentro de cada escena. */
  leadInSec?: number;
  tailSec?: number;
}

const toFrames = (sec: number) => Math.round(sec * FPS);

/** Clave de audio de un paso de una escena de pantalla. */
export const stepKey = (sceneId: string, stepId: string) => `${sceneId}--${stepId}`;

/**
 * Convierte el storyboard en una línea de tiempo en frames.
 * Duración de escena = max(estimada, lead-in + audio real + cola), así la voz nunca se corta.
 */
export function compose(sb: Storyboard, opts: ComposeOptions = {}): Timeline {
  const leadIn = opts.leadInSec ?? 0.35;
  const tail = opts.tailSec ?? 0.45;
  const introFrames = toFrames(INTRO_SEC);
  const outroFrames = toFrames(OUTRO_SEC);

  let cursor = introFrames;
  const scenes: TimelineScene[] = sb.scenes.map((scene) => {
    const audio = opts.audio?.[scene.id];
    const needed = audio ? leadIn + audio.durationSec + tail : 0;
    const seg = scene.type === "screen" ? opts.recording?.scenes.find((s) => s.sceneId === scene.id) : undefined;
    let durationSec = Math.max(scene.estDurationSec, needed);
    let screen: TimelineScene["screen"];
    const stepVoices: NonNullable<TimelineScene["stepVoices"]> = [];
    if (seg && opts.recording) {
      const steps = opts.recording.steps
        .filter((st) => st.sceneId === scene.id)
        .map((st) => ({
          ...st,
          start: st.start - seg.start,
          end: st.end - seg.start,
          highlights: st.highlights.map((h) => ({ ...h, start: h.start - seg.start, end: h.end - seg.start })),
          clicks: st.clicks.map((c) => ({ ...c, t: c.t - seg.start })),
          focus: st.focus.map((f) => ({ ...f, t: f.t - seg.start })),
        }));
      const segLen = seg.end - seg.start;
      const sceneSteps = scene.type === "screen" ? scene.steps : [];
      const clipOf = (id: string) => sceneSteps.find((x) => x.id === id)?.clip;
      for (const st of steps) {
        // El texto del callout manda el guion (editable), no el que quedó en la grabación.
        const sbStep = sceneSteps.find((x) => x.id === st.stepId);
        if (sbStep) st.callout = sbStep.callout;
        const c = clipOf(st.stepId);
        if (c?.zoom) st.zoomMode = c.zoom;
        if (c?.zoomBox) st.zoomBox = c.zoomBox;
        if (c?.highlight === false) st.hideHighlight = true;
      }
      // Pantallas de carga del ERP: se saltan (dejando 0,2 s a cada lado para que el corte se entienda).
      const skips =
        sb.skipLoading === false
          ? []
          : (opts.recording.loading ?? [])
              .map((l) => ({ start: l.start - seg.start + 0.2, end: l.end - seg.start - 0.2 }))
              .filter((l) => l.end - l.start > 0.3);
      const keep = (a: number, b: number) => {
        let parts = [{ a, b }];
        for (const k of skips) parts = parts.flatMap((p) => (k.end <= p.a || k.start >= p.b ? [p] : [{ a: p.a, b: k.start }, { a: k.end, b: p.b }]));
        parts = parts.filter((p) => p.b - p.a > 0.05);
        return parts.length ? parts : [{ a, b: Math.max(b, a + 0.2) }];
      };
      const byStep = scene.type === "screen" && steps.length > 0 && steps.some((st) => opts.audio?.[stepKey(scene.id, st.stepId)]);
      // Tramos por paso (con recortes); la voz va por paso o, si no hay, una sola para toda la escena.
      const stepSpans = (steps.length ? steps : [{ stepId: "", start: 0 }]).map((st, i, arr) => {
        const c = st.stepId ? clipOf(st.stepId) : undefined;
        const a = (i === 0 ? 0 : st.start) + (c?.trimStart ?? 0);
        const b = (arr[i + 1]?.start ?? segLen) - (c?.trimEnd ?? 0);
        return { stepId: st.stepId, parts: keep(a, Math.max(b, a + 0.2)), speed: c?.speed };
      });
      const groups = byStep
        ? stepSpans.map((sp) => ({ spans: [sp], voice: opts.audio?.[stepKey(scene.id, sp.stepId)], key: stepKey(scene.id, sp.stepId) }))
        : [{ spans: stepSpans, voice: audio, key: "" }];
      let from = 0;
      const pieces: NonNullable<TimelineScene["screen"]>["pieces"] = [];
      for (const g of groups) {
        const lead = byStep ? 0.2 : leadIn;
        const need = g.voice ? lead + g.voice.durationSec + (byStep ? 0.3 : tail) : 0;
        const len = g.spans.reduce((acc, sp) => acc + sp.parts.reduce((x, p) => x + p.b - p.a, 0), 0);
        // Automático: acelera hasta 1,5x si el tramo es mucho más largo que su voz; si la voz es más larga, se congela el final.
        const auto = need > 0 && len > need * 1.1 ? Math.min(1.5, len / need) : 1;
        const groupStart = from;
        for (const sp of g.spans) {
          for (const p of sp.parts) {
            const rate = sp.speed ?? auto;
            const duration = Math.max(1, toFrames((p.b - p.a) / rate));
            pieces.push({ srcStart: p.a, srcEnd: p.b, rate, from, duration });
            from += duration;
          }
        }
        const extra = toFrames(need) - (from - groupStart);
        if (extra > 0 && pieces.length) {
          pieces[pieces.length - 1]!.duration += extra;
          from += extra;
        }
        if (byStep && g.voice) {
          stepVoices.push({ key: g.key, src: g.voice.src, durationInFrames: toFrames(g.voice.durationSec), offsetFrames: groupStart + toFrames(lead) });
        }
      }
      durationSec = from / FPS;
      const blur = scene.type === "screen" ? scene.clip?.blur : undefined;
      screen = { src: opts.recording.file, width: opts.recording.width, height: opts.recording.height, start: seg.start, end: seg.end, pieces, steps, ...(blur?.length ? { blur } : {}) };
    }
    const durationInFrames = toFrames(durationSec);
    const offsetFrames = toFrames(leadIn);
    const ts: TimelineScene = { scene, from: cursor, durationInFrames, ...(screen ? { screen } : {}) };
    if (stepVoices.length) {
      // Con voz por paso, la narración general de la escena no se locuta.
      ts.stepVoices = stepVoices;
      ts.captions = stepVoices.flatMap((v) =>
        (opts.audio?.[v.key]?.words ?? []).map<CaptionWord>((w) => ({
          text: w.text,
          startFrame: v.offsetFrames + toFrames(w.startSec),
          endFrame: v.offsetFrames + Math.max(toFrames(w.endSec), toFrames(w.startSec) + 1),
        })),
      );
    } else if (audio) {
      ts.audio = { src: audio.src, durationInFrames: toFrames(audio.durationSec), offsetFrames };
      if (audio.words) {
        ts.captions = audio.words.map<CaptionWord>((w) => ({
          text: w.text,
          startFrame: offsetFrames + toFrames(w.startSec),
          endFrame: offsetFrames + Math.max(toFrames(w.endSec), toFrames(w.startSec) + 1),
        }));
      }
    }
    cursor += durationInFrames;
    return ts;
  });

  return {
    fps: FPS,
    title: sb.title,
    introFrames,
    outroFrames,
    scenes,
    totalFrames: cursor + outroFrames,
    music: opts.music,
  };
}
