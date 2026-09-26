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
    const durationInFrames = toFrames(Math.max(scene.estDurationSec, needed));
    const offsetFrames = toFrames(leadIn);
    const ts: TimelineScene = { scene, from: cursor, durationInFrames };
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
