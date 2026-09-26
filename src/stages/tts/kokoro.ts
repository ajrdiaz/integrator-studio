import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT_DIR, env } from "../../config";
import type { SynthesisResult, TtsProvider, WordTiming } from "./types";

const PAUSE = 0.12;

/** Divide en oraciones: cada una se sintetiza aparte y se mide, así los subtítulos no se desfasan. */
export function sentences(text: string): string[] {
  return text.match(/[^.!?;:…]+[.!?;:…]*["”)]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/** Peso aproximado de una palabra hablada (grupos vocálicos ≈ sílabas). */
const weight = (w: string) => Math.max(1, (w.toLowerCase().match(/[aeiouáéíóúü]+/g) ?? []).length) + (/[,;:]$/.test(w) ? 0.6 : 0);

/** Reparte los tiempos de cada oración entre sus palabras según su número de sílabas. */
export function distribute(chunks: string[], spans: { start: number; end: number }[]): WordTiming[] {
  const words: WordTiming[] = [];
  chunks.forEach((chunk, i) => {
    const span = spans[i]!;
    const ws = chunk.split(/\s+/).filter(Boolean);
    const total = ws.reduce((a, w) => a + weight(w), 0);
    let t = span.start;
    for (const w of ws) {
      const d = ((span.end - span.start) * weight(w)) / total;
      words.push({ text: w, startSec: t, endSec: t + d });
      t += d;
    }
  });
  return words;
}

/**
 * Kokoro TTS local (sin API ni costo). Requiere `scripts/setup-kokoro.sh`.
 * Voces en español: em_alex, em_santa (masculinas), ef_dora (femenina).
 */
export class KokoroProvider implements TtsProvider {
  readonly id = "kokoro";
  private readonly dir = path.resolve(ROOT_DIR, env.KOKORO_MODEL_DIR);
  private readonly voice = env.KOKORO_VOICE;
  private readonly speed = env.KOKORO_SPEED;

  constructor() {
    if (!existsSync(path.join(this.dir, "kokoro-v1.0.onnx"))) {
      throw new Error(`No se encontró el modelo de Kokoro en ${this.dir}. Ejecuta: npm run setup:kokoro`);
    }
  }

  get cacheKey() {
    return { voice: this.voice, speed: this.speed, v: 1 };
  }

  async synthesize(text: string): Promise<SynthesisResult> {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "kokoro-"));
    try {
      const chunks = sentences(text);
      const out = path.join(tmp, "out.wav");
      const stdout = execFileSync(env.KOKORO_PYTHON, [path.join(ROOT_DIR, "scripts/kokoro_tts.py")], {
        input: JSON.stringify({
          chunks,
          voice: this.voice,
          speed: this.speed,
          lang: "es",
          pause: PAUSE,
          out,
          model: path.join(this.dir, "kokoro-v1.0.onnx"),
          voices: path.join(this.dir, "voices-v1.0.bin"),
        }),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      const { spans } = JSON.parse(stdout) as { spans: { start: number; end: number }[] };
      return { audio: readFileSync(out), ext: "wav", words: distribute(chunks, spans) };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}
