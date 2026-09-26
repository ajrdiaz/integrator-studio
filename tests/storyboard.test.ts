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
