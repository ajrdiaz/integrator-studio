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
    if (seg && opts.recording) {
      const segLen = seg.end - seg.start;
      // Si la grabación es bastante más larga que la voz, se acelera un poco (máx. 1,35x); si es más corta, se congela el final.
      const rate = needed > 0 && segLen > needed * 1.1 ? Math.min(1.35, segLen / needed) : 1;
      durationSec = Math.max(segLen / rate, needed);
      screen = {
        src: opts.recording.file,
        width: opts.recording.width,
        height: opts.recording.height,
        start: seg.start,
        end: seg.end,
        rate,
        steps: opts.recording.steps
          .filter((st) => st.sceneId === scene.id)
          .map((st) => ({
            ...st,
            start: st.start - seg.start,
            end: st.end - seg.start,
            holdAt: st.holdAt - seg.start,
            clicks: st.clicks.map((c) => ({ ...c, t: c.t - seg.start })),
            focus: st.focus.map((f) => ({ ...f, t: f.t - seg.start })),
          })),
      };
    }
    const durationInFrames = toFrames(durationSec);
    const offsetFrames = toFrames(leadIn);
    const ts: TimelineScene = { scene, from: cursor, durationInFrames, ...(screen ? { screen } : {}) };
    if (audio) {
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
