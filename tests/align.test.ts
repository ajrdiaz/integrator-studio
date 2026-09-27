import { describe, expect, it } from "vitest";
import type { Action, RecordingPlan } from "../src/schemas/recording-plan";
import { Storyboard } from "../src/schemas/storyboard";
import { alignScript } from "../src/stages/align";

const click = (name: string, role = "button"): Action => ({ type: "click", target: { role, name } });

/** Un paso por caso: [callout, narración, clics del paso]. */
function setup(steps: [string, string, Action[]][]) {
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
        narration: "",
        estDurationSec: 10,
        goal: "g",
        steps: steps.map(([callout, narration], i) => ({ id: `p${i}`, objective: "o", callout, narration })),
      },
    ],
  });
  const plan: RecordingPlan = {
    erpHost: "demo",
    company: "x",
    createdAt: "",
    scenes: [{ sceneId: "s1", steps: steps.map(([callout, , actions], i) => ({ id: `p${i}`, objective: "o", callout, actions })) }],
  };
  const { storyboard, changes } = alignScript(sb, plan);
  const out = storyboard.scenes[0]!.type === "screen" ? storyboard.scenes[0]!.steps : [];
  return { changes, steps: out.map((s) => [s.callout, s.narration]) };
}

describe("ajuste del guion a la interfaz real", () => {
  it("cambia el botón inexistente por el único que se usa, en narración y callout", () => {
    const r = setup([
      ["Nueva Factura", "Haz clic en Nueva Factura para abrir un comprobante en blanco.", [click("Nuevo Registro")]],
      ["Grabar y Continuar", "Presiona Grabar y Continuar para guardar la factura.", [click("Actualizar")]],
    ]);
    expect(r.steps).toEqual([
      ["Nuevo Registro", "Haz clic en Nuevo Registro para abrir un comprobante en blanco."],
      ["Actualizar", "Presiona Actualizar para guardar la factura."],
    ]);
    expect(r.changes.map((c) => `${c.from} → ${c.to}`)).toEqual(["Nueva Factura → Nuevo Registro", "Grabar y Continuar → Actualizar"]);
  });

  it("no toca lo que ya coincide ni el callout de un campo", () => {
    const r = setup([
      ["Comercial > Facturas", "Entra a Comercial y abre la opción Facturas.", [click("Comercial", "link"), click("Facturas", "link")]],
      ["Cliente", "Busca al cliente.", [click("Hoy")]],
    ]);
    expect(r.changes).toEqual([]);
  });

  it("con varios botones posibles elige el que comparte una palabra; si no hay uno claro, no adivina", () => {
    const r = setup([
      ["Cerrar", "Selecciona Cerrar Factura.", [click("Opciones"), click("Cerrar"), click("Si, confirmar")]],
      ["Guardar", "Presiona Guardar.", [click("Actualizar"), click("Enviar")]],
    ]);
    expect(r.steps).toEqual([
      ["Cerrar", "Selecciona Cerrar."],
      ["Guardar", "Presiona Guardar."],
    ]);
  });

  it("los nombres en mayúsculas se escriben normal en la narración (la voz no los deletrea)", () => {
    const r = setup([["Grabar", "Presiona Grabar.", [click("REGISTRAR DOCUMENTO")]]]);
    expect(r.steps).toEqual([["REGISTRAR DOCUMENTO", "Presiona Registrar Documento."]]);
  });
});
