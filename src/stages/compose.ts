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
      const byStep = scene.type === "screen" && steps.length > 0 && steps.some((st) => opts.audio?.[stepKey(scene.id, st.stepId)]);
      // Tramos: uno por paso si hay voz por paso; si no, uno para toda la escena con la voz de la escena.
      const spans = byStep
        ? steps.map((st, i) => ({ srcStart: i === 0 ? 0 : st.start, srcEnd: steps[i + 1]?.start ?? segLen, voice: opts.audio?.[stepKey(scene.id, st.stepId)] }))
        : [{ srcStart: 0, srcEnd: segLen, voice: audio }];
      let from = 0;
      const pieces = spans.map((sp, i) => {
        const len = sp.srcEnd - sp.srcStart;
        const lead = byStep ? 0.2 : leadIn;
        const need = sp.voice ? lead + sp.voice.durationSec + (byStep ? 0.3 : tail) : 0;
        // Acelera hasta 1,5x si el tramo es mucho más largo que su voz; si la voz es más larga, se congela el final.
        const rate = need > 0 && len > need * 1.1 ? Math.min(1.5, len / need) : 1;
        const duration = toFrames(Math.max(len / rate, need));
        if (byStep && sp.voice) {
          stepVoices.push({ key: stepKey(scene.id, steps[i]!.stepId), src: sp.voice.src, durationInFrames: toFrames(sp.voice.durationSec), offsetFrames: from + toFrames(lead) });
        }
        const piece = { srcStart: sp.srcStart, srcEnd: sp.srcEnd, rate, from, duration };
        from += duration;
        return piece;
      });
      durationSec = from / FPS;
      screen = { src: opts.recording.file, width: opts.recording.width, height: opts.recording.height, start: seg.start, end: seg.end, pieces, steps };
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
