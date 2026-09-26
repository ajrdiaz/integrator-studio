import { env, requireEnv } from "../../config";
import { type SynthesisContext, type SynthesisResult, type TtsProvider, wordsFromCharacters } from "./types";

interface WithTimestampsResponse {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
}

const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.0 };

/** ElevenLabs con tiempos por carácter (endpoint /with-timestamps) → subtítulos palabra por palabra. */
export class ElevenLabsProvider implements TtsProvider {
  readonly id = "elevenlabs";
  private readonly apiKey = requireEnv("ELEVENLABS_API_KEY", "para la voz en off con ElevenLabs");
  private readonly voiceId = requireEnv("ELEVENLABS_VOICE_ID", "para elegir la voz de ElevenLabs");
  private readonly model = env.ELEVENLABS_MODEL;

  get cacheKey() {
    return { voice: this.voiceId, model: this.model, settings: VOICE_SETTINGS };
  }

  async synthesize(text: string, ctx: SynthesisContext): Promise<SynthesisResult> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          text,
          model_id: this.model,
          voice_settings: VOICE_SETTINGS,
          previous_text: ctx.previousText,
          next_text: ctx.nextText,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as WithTimestampsResponse;
        const a = data.alignment;
        return {
          audio: Buffer.from(data.audio_base64, "base64"),
          ext: "mp3",
          words: a ? wordsFromCharacters(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : [],
        };
      }
      lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    throw new Error(`ElevenLabs falló: ${lastError}`);
  }
}
