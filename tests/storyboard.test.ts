import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Storyboard, checkStoryboard } from "../src/schemas/storyboard";
import { compose, FPS } from "../src/stages/compose";

const load = (name: string) => Storyboard.parse(JSON.parse(readFileSync(`fixtures/${name}.storyboard.json`, "utf8")));

describe("storyboard", () => {
  it("los fixtures son válidos", () => {
    for (const name of ["promo-sin-costos-ocultos", "plantillas"]) expect(checkStoryboard(load(name))).toEqual([]);
  });

  it("rechaza props que no corresponden a la plantilla", () => {
    const sb = load("promo-sin-costos-ocultos");
    const bad = structuredClone(sb) as unknown as { scenes: { props: unknown }[] };
    bad.scenes[1]!.props = { items: ["x", "y"] }; // comparison con props de checklist
    expect(Storyboard.safeParse(bad).success).toBe(false);
  });

  it("detecta ids duplicados y gráficos desalineados", () => {
    const sb = load("plantillas");
    sb.scenes[1]!.id = sb.scenes[0]!.id;
    const dash = sb.scenes[2]!;
    if (dash.type === "motion" && dash.template === "dashboard") dash.props.chart.values.pop();
    expect(checkStoryboard(sb)).toHaveLength(2);
  });
});

describe("compose", () => {
  it("el promo de 30 s dura exactamente 30 s con intro y cierre", () => {
    const tl = compose(load("promo-sin-costos-ocultos"));
    expect(tl.totalFrames).toBe(30 * FPS);
    expect(tl.scenes[0]!.from).toBe(tl.introFrames);
    for (let i = 1; i < tl.scenes.length; i++) {
      expect(tl.scenes[i]!.from).toBe(tl.scenes[i - 1]!.from + tl.scenes[i - 1]!.durationInFrames);
    }
  });

  it("alarga la escena si la voz real es más larga que la estimada", () => {
    const sb = load("promo-sin-costos-ocultos");
    const id = sb.scenes[0]!.id;
    const tl = compose(sb, { audio: { [id]: { src: "audio/a.mp3", durationSec: 6 } }, leadInSec: 0.5, tailSec: 0.5 });
    expect(tl.scenes[0]!.durationInFrames).toBe(7 * FPS);
    expect(tl.scenes[0]!.audio).toMatchObject({ offsetFrames: 15, durationInFrames: 180 });
  });
});

describe("compose con grabación y voz por paso", () => {
  it("un tramo por paso, cada voz empieza con su paso y la escena dura lo necesario", async () => {
    const { stepKey } = await import("../src/stages/compose");
    const sb = Storyboard.parse({
      kind: "tutorial",
      title: "t",
      targetDurationSec: 30,
      formats: ["16x9"],
      music: false,
      scenes: [
        {
          id: "s1",
          type: "screen",
          onScreenText: "x",
          narration: "resumen",
          estDurationSec: 5,
          goal: "g",
          steps: [
            { id: "a", objective: "o", callout: "c", narration: "uno" },
            { id: "b", objective: "o", callout: "c", narration: "dos" },
          ],
        },
      ],
    });
    const step = (id: string, start: number, end: number) => ({ sceneId: "s1", stepId: id, callout: "c", start, end, clicks: [], focus: [], highlights: [] });
    const recording = { file: "r.mp4", width: 1920, height: 1080, durationSec: 20, scenes: [{ sceneId: "s1", start: 2, end: 20 }], steps: [step("a", 2, 14), step("b", 14, 20)] };
    const audio = {
      [stepKey("s1", "a")]: { src: "a.wav", durationSec: 2, words: [{ text: "uno", startSec: 0, endSec: 1 }] },
      [stepKey("s1", "b")]: { src: "b.wav", durationSec: 8 },
    };
    const tl = compose(sb, { audio, recording });
    const sc = tl.scenes[0]!;
    const [pa, pb] = sc.screen!.pieces;
    expect(pa).toMatchObject({ srcStart: 0, srcEnd: 12, rate: 1.5, from: 0, duration: 240 });
    expect(pb!.rate).toBe(1); // la voz (8 s) es más larga que el tramo (6 s): se congela el final
    expect(pb!.duration).toBe(Math.round((0.2 + 8 + 0.3) * FPS));
    expect(sc.stepVoices!.map((v) => v.offsetFrames)).toEqual([6, 240 + 6]);
    expect(sc.audio).toBeUndefined();
    expect(sc.captions![0]!.startFrame).toBe(6);
    expect(sc.durationInFrames).toBe(pa!.duration + pb!.duration);
  });
});
