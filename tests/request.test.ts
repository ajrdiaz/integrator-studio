import { describe, expect, it } from "vitest";
import { parseRequest } from "../src/request";

describe("parseRequest", () => {
  it("promo con duración y formato vertical", () => {
    const r = parseRequest("promo: sin costos ocultos, 30 s, vertical");
    expect(r).toMatchObject({ kind: "promo", topic: "sin costos ocultos", durationSec: 30, formats: ["9x16"] });
  });

  it("tutorial sin duración usa 16x9 por defecto", () => {
    const r = parseRequest("tutorial: emitir una factura electrónica");
    expect(r).toMatchObject({ kind: "tutorial", topic: "emitir una factura electrónica", formats: ["16x9"] });
    expect(r.durationSec).toBeUndefined();
  });

  it("minutos y todos los formatos", () => {
    const r = parseRequest("tutorial: guía de remisión, 1.5 min, todos los formatos");
    expect(r.durationSec).toBe(90);
    expect(r.formats).toEqual(["16x9", "9x16", "1x1"]);
    expect(r.topic).toBe("guía de remisión");
  });

  it("infiere tutorial sin prefijo", () => {
    expect(parseRequest("cómo registrar una detracción").kind).toBe("tutorial");
  });
});
