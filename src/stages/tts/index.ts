import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { env } from "../../config";
import { log } from "../../log";
import { hash, type Job } from "../../jobs/store";
import { mediaDuration } from "../../media";
import type { Storyboard } from "../../schemas/storyboard";
import type { SceneAudio } from "../compose";
import { ElevenLabsProvider } from "./elevenlabs";
import { KokoroProvider } from "./kokoro";
import { mapTimings, toSpoken } from "./pronunciation";
import { SilentProvider } from "./silent";
import type { TtsProvider } from "./types";

/** Proveedores disponibles. Para agregar uno (p. ej. Azure): implementa TtsProvider y añádelo aquí. */
const PROVIDERS: Record<string, () => TtsProvider> = {
  elevenlabs: () => new ElevenLabsProvider(),
  kokoro: () => new KokoroProvider(),
  silent: () => new SilentProvider(),
};

export function getProvider(requested?: string): TtsProvider {
  let id = requested ?? env.TTS_PROVIDER;
  // Sin claves de ElevenLabs, usar Kokoro local si está instalado (solo cuando no se pidió explícitamente).
  if (!requested && id === "elevenlabs" && !(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID)) {
    log.warn("Faltan ELEVENLABS_API_KEY/ELEVENLABS_VOICE_ID: se usa Kokoro (local)");
    id = "kokoro";
  }
  const make = PROVIDERS[id];
  if (!make) throw new Error(`Proveedor TTS desconocido: ${id} (disponibles: ${Object.keys(PROVIDERS).join(", ")})`);
  return make();
}

interface AudioMeta {
  hash: string;
  provider: string;
  file: string;
  durationSec: number;
  words: { text: string; startSec: number; endSec: number }[];
}

/**
 * Genera un audio por escena. Solo sintetiza las escenas cuya narración (o voz) cambió:
 * el hash se guarda junto al audio en audio/<escena>.json.
 */
export async function synthesizeScenes(
  job: Job,
  sb: Storyboard,
  provider: TtsProvider,
  onProgress: (msg: string) => void,
): Promise<{ audio: Record<string, SceneAudio>; generated: string[] }> {
  mkdirSync(job.path("audio"), { recursive: true });
  const audio: Record<string, SceneAudio> = {};
  const generated: string[] = [];

  for (const [i, scene] of sb.scenes.entries()) {
    const text = scene.narration.trim();
    if (!text) continue;
    const spoken = toSpoken(text);
    const h = hash({ p: provider.id, k: provider.cacheKey, t: spoken.spoken });
    const metaRel = `audio/${scene.id}.json`;
    let meta: AudioMeta | undefined = job.exists(metaRel) ? job.readJson<AudioMeta>(metaRel) : undefined;

    if (!meta || meta.hash !== h || !existsSync(job.path(meta.file))) {
      onProgress(`${scene.id}: sintetizando (${provider.id})`);
      const res = await provider.synthesize(spoken.spoken, {
        previousText: sb.scenes[i - 1]?.narration,
        nextText: sb.scenes[i + 1]?.narration,
      });
      const file = `audio/${scene.id}.${res.ext}`;
      writeFileSync(job.path(file), res.audio);
      const durationSec = mediaDuration(job.path(file));
      meta = { hash: h, provider: provider.id, file, durationSec, words: mapTimings(spoken, res.words) };
      job.writeJson(metaRel, meta);
      generated.push(scene.id);
    }
    audio[scene.id] = { src: meta.file, durationSec: meta.durationSec, words: meta.words };
  }
  return { audio, generated };
}
