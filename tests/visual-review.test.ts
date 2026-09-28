import { describe, expect, it } from "vitest";
import { Storyboard } from "../src/schemas/storyboard";
import type { Timeline } from "../src/schemas/timeline";
import { visualMoments } from "../src/stages/visual-review";

const sb = Storyboard.parse({
  kind: "tutorial",
  title: "t",
  targetDurationSec: 30,
  formats: ["16x9"],
  music: false,
  scenes: [
    { id: "s1", type: "motion", template: "kinetic-title", onScreenText: "Emite tu factura", narration: "Te mostramos cómo.", estDurationSec: 3, props: { emphasis: [] } },
    {
      id: "s2",
      type: "screen",
      onScreenText: "x",
      narration: "",
      estDurationSec: 10,
      goal: "g",
      steps: [
        { id: "a", objective: "o", callout: "Nuevo Registro", narration: "Haz clic en Nuevo Registro." },
        { id: "b", objective: "o", callout: "Cliente", narration: "Busca al cliente." },
      ],
    },
  ],
});

const box = { x: 0, y: 0, width: 10, height: 10 };
const step = (stepId: string, start: number, end: number, highlights: { start: number; end: number }[]) => ({
  sceneId: "s2",
  stepId,
  callout: "",
  start,
  end,
  clicks: [],
  focus: [],
  highlights: highlights.map((h) => ({ ...h, box })),
});

const tl: Timeline = {
  fps: 30,
  title: "t",
  introFrames: 30,
  outroFrames: 30,
  totalFrames: 600,
  scenes: [
    { scene: sb.scenes[0]!, from: 30, durationInFrames: 120 },
    {
      scene: sb.scenes[1]!,
      from: 150,
      durationInFrames: 420,
      screen: {
        src: "r.mp4",
        width: 1920,
        height: 1080,
        start: 0,
        end: 12,
        // Paso a: 6 s de grabación a ×1,5 (4 s de video). Paso b: 6 s a velocidad normal.
        pieces: [
          { srcStart: 0, srcEnd: 6, rate: 1.5, from: 0, duration: 120 },
          { srcStart: 6, srcEnd: 12, rate: 1, from: 120, duration: 300 },
        ],
        steps: [step("a", 0, 6, [{ start: 3, end: 4.5 }]), step("b", 6, 12, [])],
      },
    },
  ],
};

describe("revisión visual: momentos", () => {
  it("toma el globo del paso en el segundo correcto del video, y el final del paso si no hay resaltado", () => {
    const m = visualMoments(sb, tl);
    expect(m.map((x) => [x.scene, x.step, x.callout])).toEqual([
      ["s1", undefined, undefined],
      ["s2", "a", "Nuevo Registro"],
      ["s2", "b", undefined],
    ]);
    expect(m[0]!.at).toBeCloseTo((30 + 120 * 0.75) / 30); // escena animada, al 75 %
    expect(m[1]!.at).toBeCloseTo(150 / 30 + 3.75 / 1.5); // mitad del resaltado (3,75 s) a ×1,5
    expect(m[2]!.at).toBeCloseTo(270 / 30 + 5.7); // final del paso b (11,7 s de grabación)
  });
});
