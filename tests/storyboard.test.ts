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

describe("editor de clips", () => {
  const base = () =>
    Storyboard.parse({
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
          narration: "r",
          estDurationSec: 5,
          goal: "g",
          steps: [
            { id: "a", objective: "o", callout: "c" },
            { id: "b", objective: "o", callout: "c" },
          ],
        },
      ],
    });
  const step = (id: string, start: number, end: number) => ({ sceneId: "s1", stepId: id, callout: "c", start, end, clicks: [], focus: [], highlights: [] });
  const recording = {
    file: "r.mp4",
    width: 1920,
    height: 1080,
    durationSec: 20,
    scenes: [{ sceneId: "s1", start: 0, end: 20 }],
    steps: [step("a", 0, 10), step("b", 10, 20)],
    loading: [{ start: 3, end: 6 }],
  };

  it("salta las pantallas de carga (dejando 0,2 s a cada lado)", () => {
    const tl = compose(base(), { recording });
    const p = tl.scenes[0]!.screen!.pieces;
    expect(p.map((x) => [x.srcStart, x.srcEnd])).toEqual([
      [0, 3.2],
      [5.8, 10],
      [10, 20],
    ]);
  });

  it("no salta la carga si skipLoading = false; aplica recortes, velocidad y banderas", () => {
    const sb = base();
    sb.skipLoading = false;
    const sc = sb.scenes[0]!;
    if (sc.type !== "screen") throw new Error();
    sc.steps[1]!.clip = { trimStart: 2, trimEnd: 3, speed: 2, zoom: "off", highlight: false };
    sc.clip = { blur: [{ x: 10, y: 10, width: 100, height: 20 }] };
    const tl = compose(sb, { recording });
    const scr = tl.scenes[0]!.screen!;
    expect(scr.pieces.map((x) => [x.srcStart, x.srcEnd, x.rate])).toEqual([
      [0, 10, 1],
      [12, 17, 2],
    ]);
    expect(scr.pieces[1]!.duration).toBe(Math.round((5 / 2) * FPS));
    expect(scr.steps[1]).toMatchObject({ zoomMode: "off", hideHighlight: true });
    expect(scr.blur).toHaveLength(1);
  });

  it("zoom fijo exige zona", () => {
    const sb = base();
    const sc = sb.scenes[0]!;
    if (sc.type !== "screen") throw new Error();
    sc.steps[0]!.clip = { zoom: "fixed" };
    expect(checkStoryboard(sb)).toHaveLength(1);
  });

  it("los valores por defecto de cada plantilla son válidos", async () => {
    const { TEMPLATE_DEFAULTS, TEMPLATE_IDS } = await import("../src/schemas/templates");
    for (const t of TEMPLATE_IDS) {
      const ok = Storyboard.safeParse({ ...base(), scenes: [{ id: "s1", type: "motion", template: t, onScreenText: "x", narration: "y", estDurationSec: 3, props: TEMPLATE_DEFAULTS[t] }] }).success;
      expect(ok, t).toBe(true);
    }
  });
});

describe("callouts", () => {
  it("el callout del guion reemplaza al de la grabación", () => {
    const sb = Storyboard.parse({
      kind: "tutorial", title: "t", targetDurationSec: 30, formats: ["16x9"], music: false,
      scenes: [{ id: "s1", type: "screen", onScreenText: "x", narration: "r", estDurationSec: 5, goal: "g", steps: [{ id: "a", objective: "o", callout: "Nuevo Registro" }] }],
    });
    const rec = { file: "r.mp4", width: 1920, height: 1080, durationSec: 5, scenes: [{ sceneId: "s1", start: 0, end: 5 }],
      steps: [{ sceneId: "s1", stepId: "a", callout: "Nueva Factura", start: 0, end: 5, clicks: [], focus: [], highlights: [] }] };
    expect(compose(sb, { recording: rec }).scenes[0]!.screen!.steps[0]!.callout).toBe("Nuevo Registro");
  });
});
