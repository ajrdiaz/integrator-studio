import type { SynthesisResult, TtsProvider } from "./types";

const RATE = 16000;

/** WAV PCM 16-bit mono en silencio. */
function silenceWav(seconds: number): Buffer {
  const samples = Math.round(seconds * RATE);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/**
 * Proveedor de prueba sin red: audio en silencio con la duración y los tiempos por palabra que tendría
 * una locución a ~2,6 palabras/s. Sirve para probar composición y subtítulos sin gastar créditos.
 */
export class SilentProvider implements TtsProvider {
  readonly id = "silent";
  readonly cacheKey = { wps: 2.6 };

  async synthesize(text: string): Promise<SynthesisResult> {
    const tokens = text.split(/\s+/).filter(Boolean);
    const weights = tokens.map((t) => 0.12 + t.length * 0.055 + (/[.,;:!?]$/.test(t) ? 0.25 : 0));
    let t = 0.05;
    const words = tokens.map((text, i) => {
      const w = { text, startSec: t, endSec: t + weights[i]! - 0.04 };
      t += weights[i]!;
      return w;
    });
    return { audio: silenceWav(t + 0.1), ext: "wav", words };
  }
}
