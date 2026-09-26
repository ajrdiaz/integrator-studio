import { describe, expect, it } from "vitest";
import { clampCamera, focusAt, project, targetCamera } from "../remotion/camera";
import { LocatorSpec, RecordingPlan } from "../src/schemas/recording-plan";
import type { RecordedStep } from "../src/schemas/recording-plan";

const src = { width: 1920, height: 1080 };
const box = { x: 1500, y: 900, width: 200, height: 40 };
const step: RecordedStep = {
  sceneId: "s2",
  stepId: "a",
  callout: "Nueva Factura",
  start: 0,
  end: 5,
  holdAt: 3.5,
  clicks: [],
  focus: [{ t: 1, box: { x: 100, y: 100, width: 150, height: 30 } }],
  box,
};

describe("cámara", () => {
  it("sigue el elemento activo y en la pausa final el resaltado", () => {
    expect(focusAt([step], 0.2)).toBeNull();
    expect(focusAt([step], 0.8)?.x).toBe(100); // anticipa 0,35 s
    expect(focusAt([step], 4)).toEqual(box);
    expect(focusAt([step], 6)).toBeNull();
  });

  it("en 16:9 hace zoom moderado sin dejar bordes vacíos", () => {
    const out = { width: 1920, height: 1080 };
    const cam = clampCamera(targetCamera(box, src, out), src, out);
    expect(cam.scale).toBeGreaterThanOrEqual(1.25);
    expect(cam.scale).toBeLessThanOrEqual(1.6);
    const p = project({ x: 0, y: 0, width: 1920, height: 1080 }, cam, out);
    expect(p.x).toBeLessThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(0);
    expect(p.x + p.width).toBeGreaterThanOrEqual(1920 - 1e-6);
    expect(p.y + p.height).toBeGreaterThanOrEqual(1080 - 1e-6);
  });

  it("en 9:16 cubre el cuadro y encuadra el área activa", () => {
    const out = { width: 1080, height: 1920 };
    const cam = clampCamera(targetCamera(box, src, out), src, out);
    const b = project(box, cam, out);
    expect(b.x + b.width / 2).toBeGreaterThan(0);
    expect(b.x + b.width / 2).toBeLessThan(1080);
    expect(cam.scale).toBeGreaterThanOrEqual(1920 / 1080);
  });
});

describe("recording plan", () => {
  it("exige un selector no vacío y acepta selectores anidados", () => {
    expect(LocatorSpec.safeParse({}).success).toBe(false);
    expect(LocatorSpec.safeParse({ role: "button", name: "Grabar", within: { role: "dialog" } }).success).toBe(true);
    expect(
      RecordingPlan.safeParse({
        erpHost: "new.integrator.pe",
        company: "NEW INTEGRATOR",
        createdAt: "2026-09-26",
        scenes: [{ sceneId: "s2", steps: [{ id: "a", objective: "x", callout: "y", actions: [{ type: "click", target: { text: "Comercial" } }] }] }],
      }).success,
    ).toBe(true);
  });
});
