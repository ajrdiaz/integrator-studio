export interface WordTiming {
  text: string;
  startSec: number;
  endSec: number;
}

export interface SynthesisResult {
  /** Audio codificado (mp3 o wav, según `ext`). */
  audio: Buffer;
  ext: "mp3" | "wav";
  /** Tiempos por palabra del texto hablado (el que se envió al proveedor). */
  words: WordTiming[];
}

export interface SynthesisContext {
  /** Narración de la escena anterior/siguiente: ayuda a que la entonación sea continua. */
  previousText?: string;
  nextText?: string;
}

/** Proveedor de voz intercambiable. Para agregar uno, implementa esta interfaz y regístralo en tts/index.ts. */
export interface TtsProvider {
  readonly id: string;
  /** Todo lo que afecta al audio (voz, modelo, ajustes): entra en el hash de caché. */
  readonly cacheKey: unknown;
  synthesize(text: string, ctx: SynthesisContext): Promise<SynthesisResult>;
}

/** Convierte alineación por carácter (ElevenLabs, Azure) en tiempos por palabra. */
export function wordsFromCharacters(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;
  chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { text: "", startSec: starts[i] ?? 0, endSec: ends[i] ?? 0 };
    current.text += c;
    current.endSec = ends[i] ?? current.endSec;
  });
  if (current) words.push(current);
  return words;
}
