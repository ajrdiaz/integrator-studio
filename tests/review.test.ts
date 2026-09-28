import { describe, expect, it } from "vitest";
import type { RecordingPlan } from "../src/schemas/recording-plan";
import { Storyboard } from "../src/schemas/storyboard";
import type { Timeline } from "../src/schemas/timeline";
import { stepKey } from "../src/stages/compose";
import { checkScript, checkTimeline, found, mentions } from "../src/stages/review";

describe("revisión: menciones de la narración", () => {
  it("extrae lo que se pide tocar, sin cruzar el fin de oración ni tomar minúsculas", () => {
    expect(mentions("Haz clic en Nueva Factura para abrir un comprobante en blanco.")).toEqual(["Nueva Factura"]);
    expect(mentions("Presiona Grabar y Continuar para guardar la factura.")).toEqual(["Grabar y Continuar"]);
    expect(mentions("Selecciona Cerrar. Con serie electrónica, la factura se envía a SUNAT.")).toEqual(["Cerrar"]);
    expect(mentions("Entra a Comercial, luego Facturación, y abre la opción Facturas.")).toEqual(["Comercial", "Facturas"]);
    expect(mentions("Elige una serie electrónica; así la factura se enviará a SUNAT.")).toEqual([]);
    expect(mentions("Luego pulsa el botón «Guardar».")).toEqual(["Guardar"]);
  });

  it("compara sin tildes ni plurales, pero no acepta coincidencias parciales", () => {
    expect(found("Facturas", ["Factura"])).toBe(true);
    expect(found("Facturación", ["FACTURACION"])).toBe(true);
    expect(found("Nueva Factura", ["Facturas"])).toBe(false);
    expect(found("Grabar y Continuar", ["Grabar"])).toBe(false);
  });
});

const storyboard = Storyboard.parse({
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
      narration: "",
      estDurationSec: 10,
      goal: "g",
      steps: [
        { id: "nuevo", objective: "o", callout: "Nueva Factura", narration: "Haz clic en Nueva Factura." },
        { id: "cliente", objective: "o", callout: "Cliente", narration: "Busca al cliente." },
      ],
    },
  ],
});
const plan: RecordingPlan = {
  erpHost: "demo",
  company: "x",
  createdAt: "",
  scenes: [
    {
      sceneId: "s1",
      steps: [
        { id: "nuevo", objective: "o", callout: "Nueva Factura", actions: [{ type: "click", target: { role: "button", name: "Nuevo Registro" } }] },
        {
          id: "cliente",
          objective: "o",
          callout: "Cliente",
          actions: [
            { type: "fill", target: { placeholder: "Digite al menos 3 caracteres" }, value: "demo" },
            { type: "click", target: { role: "button", name: "Hoy" } },
          ],
        },
      ],
    },
  ],
};
const timeline = (over: Partial<Timeline["scenes"][number]> = {}): Timeline => ({
  fps: 30,
  title: "t",
  introFrames: 30,
  outroFrames: 30,
  totalFrames: 360,
  scenes: [{ scene: storyboard.scenes[0]!, from: 30, durationInFrames: 300, ...over }],
});

describe("revisión: guion vs. grabación", () => {
  it("sin textos de pantalla marca el botón que no coincide (un solo aviso) y no los callouts de campos", () => {
    const f = checkScript(storyboard, plan, timeline());
    const warnings = f.filter((x) => x.level === "warning");
    expect(warnings.map((x) => x.message)).toEqual([
      "La narración y el callout dicen «Nueva Factura», pero no coincide con ningún elemento que se usa. En este paso se hace clic en: «Nuevo Registro».",
    ]);
    expect(f.some((x) => x.level === "info")).toBe(true);
  });

  it("con textos de pantalla revisa también los callouts de campos", () => {
    const screen = { [stepKey("s1", "nuevo")]: "Facturas Nuevo Registro", [stepKey("s1", "cliente")]: "Documento Serie Moneda" };
    const f = checkScript(storyboard, plan, timeline(), screen);
    expect(f.filter((x) => x.step === "cliente").map((x) => x.message)).toEqual(["El callout «Cliente» no aparece en la pantalla. En este paso se hace clic en: «Hoy»."]);
    expect(checkScript(storyboard, plan, timeline(), { ...screen, [stepKey("s1", "cliente")]: "Cliente Documento" }).some((x) => x.step === "cliente")).toBe(false);
    // Un "/" dentro del nombre no separa partes del callout.
    const withSlash = structuredClone(storyboard);
    if (withSlash.scenes[0]!.type === "screen") withSlash.scenes[0]!.steps[1]!.callout = "Precio (S/)";
    expect(checkScript(withSlash, plan, timeline(), { ...screen, [stepKey("s1", "cliente")]: "Cantidad Precio (S/) Precio +IGV" }).some((x) => x.step === "cliente")).toBe(false);
  });
});

describe("revisión: timeline", () => {
  it("detecta huecos sin video, voces cortadas o superpuestas e imagen congelada", () => {
    const voice = (key: string, offsetFrames: number, durationInFrames: number) => ({ key, src: "v.wav", offsetFrames, durationInFrames });
    const findings = checkTimeline(
      timeline({
        stepVoices: [voice("a", 0, 120), voice("b", 100, 250)],
        screen: {
          src: "r.mp4",
          width: 1920,
          height: 1080,
          start: 0,
          end: 10,
          steps: [],
          pieces: [
            { srcStart: 0, srcEnd: 2, rate: 1, from: 0, duration: 200 },
            { srcStart: 2, srcEnd: 4, rate: 1, from: 230, duration: 50 },
          ],
        },
      }),
    ).map((f) => f.message);
    expect(findings).toEqual([
      "Las voces a y b se superponen 0.7 s.",
      "La voz b se corta: termina 1.7 s después del fin de la escena.",
      "La imagen queda congelada 4.7 s esperando a la voz.",
      "Hueco sin video de 1.00 s (se vería el fondo).",
      "Los últimos 0.67 s de la escena no tienen video (se vería el fondo).",
    ]);
  });

  it("un timeline sano no genera hallazgos", () => {
    expect(checkTimeline(timeline({ screen: { src: "r.mp4", width: 1920, height: 1080, start: 0, end: 10, steps: [], pieces: [{ srcStart: 0, srcEnd: 10, rate: 1, from: 0, duration: 300 }] } }))).toEqual([]);
  });
});
