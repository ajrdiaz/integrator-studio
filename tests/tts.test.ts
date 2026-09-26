import { describe, expect, it } from "vitest";
import { paginate } from "../remotion/components/Captions";
import { musicVolume } from "../remotion/components/Music";
import { mapTimings, toSpoken } from "../src/stages/tts/pronunciation";
import { wordsFromCharacters } from "../src/stages/tts/types";

describe("pronunciación", () => {
  it("expande siglas y devuelve los tiempos al texto original", () => {
    const st = toSpoken("Emite con SUNAT y calcula el IGV.");
    expect(st.spoken).toBe("Emite con Sunat y calcula el i ge ve.");
    const spoken = st.spoken.split(" ").map((text, i) => ({ text, startSec: i, endSec: i + 0.5 }));
    const words = mapTimings(st, spoken);
    expect(words.map((w) => w.text)).toEqual(["Emite", "con", "SUNAT", "y", "calcula", "el", "IGV."]);
    expect(words[6]).toMatchObject({ startSec: 6, endSec: 8.5 });
  });

  it("alineación por carácter → palabras", () => {
    const chars = [..."Hola mundo"];
    const t = chars.map((_, i) => i * 0.1);
    const w = wordsFromCharacters(chars, t, t.map((x) => x + 0.1));
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({ text: "mundo", startSec: 0.5 });
    expect(w[1]!.endSec).toBeCloseTo(1.0);
  });
});

describe("subtítulos", () => {
  it("corta páginas en puntuación y las encadena sin huecos", () => {
    const words = "Uno dos tres. Cuatro cinco seis siete ocho nueve diez once".split(" ").map((text, i) => ({
      text,
      startFrame: i * 10,
      endFrame: i * 10 + 8,
    }));
    const pages = paginate(words, 6, 40, 200);
    expect(pages[0]!.words.map((w) => w.text)).toEqual(["Uno", "dos", "tres."]);
    expect(pages[0]!.endFrame).toBe(pages[1]!.startFrame);
    expect(pages.flatMap((p) => p.words)).toHaveLength(words.length);
  });
});

describe("ducking", () => {
  it("baja la música bajo la voz y la recupera después", () => {
    const iv: [number, number][] = [[100, 200]];
    expect(musicVolume(50, 1000, 0.3, iv)).toBeCloseTo(0.3);
    expect(musicVolume(150, 1000, 0.3, iv)).toBeCloseTo(0.075);
    expect(musicVolume(300, 1000, 0.3, iv)).toBeCloseTo(0.3);
    expect(musicVolume(0, 1000, 0.3, iv)).toBe(0);
  });
});
