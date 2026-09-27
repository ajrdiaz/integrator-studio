import type { RecordedStep } from "../src/schemas/recording-plan";

export type Box = { x: number; y: number; width: number; height: number };
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

/** Elemento que la cámara debe mostrar en el instante `t` (segundos del tramo). */
export function focusAt(steps: RecordedStep[], t: number): Box | null {
  const step = steps.find((s) => t >= s.start && t < s.end);
  if (!step) return null;
  if (step.zoomMode === "off") return null;
  if (step.zoomMode === "fixed" && step.zoomBox) return step.zoomBox;
  const hl = step.highlights.find((h) => t >= h.start - 0.2 && t < h.end + 0.4);
  if (hl) return hl.box;
  // Anticipa un poco el siguiente elemento para que la cámara llegue junto con el cursor.
  const f = [...step.focus].reverse().find((x) => x.t <= t + 0.35);
  return f?.box ?? null;
}

/** Última zona activa antes de `t` (para que en vertical la cámara no salte al centro de la página). */
export function lastFocusBefore(steps: RecordedStep[], t: number): Box | null {
  let best: { t: number; box: Box } | null = null;
  for (const s of steps) {
    for (const f of s.focus) if (f.t <= t && (!best || f.t > best.t)) best = f;
    for (const h of s.highlights) if (h.start <= t && (!best || h.start > best.t)) best = { t: h.start, box: h.box };
  }
  return best?.box ?? null;
}

/**
 * Cámara objetivo: en horizontal, zoom moderado al elemento activo; en vertical/cuadrado, el video cubre el
 * cuadro y la cámara se desplaza para mantener el área activa a la vista (reencuadre).
 */
export function targetCamera(box: Box | null, src: { width: number; height: number }, out: { width: number; height: number }): Camera {
  const cover = Math.max(out.width / src.width, out.height / src.height);
  const landscape = out.width / out.height > 1.2;
  if (!box) return { cx: src.width / 2, cy: src.height / 2, scale: cover };
  const zoom = landscape
    ? Math.min(1.6, Math.max(1.25, Math.min((0.55 * out.width) / cover / box.width, (0.5 * out.height) / cover / box.height)))
    : Math.min(1.25, Math.max(1, (0.8 * out.width) / cover / Math.max(box.width, 1)));
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, scale: cover * zoom };
}

/** Evita bordes vacíos: el centro se limita para que el video siempre cubra la salida. */
export function clampCamera(c: Camera, src: { width: number; height: number }, out: { width: number; height: number }): Camera {
  const halfW = out.width / 2 / c.scale;
  const halfH = out.height / 2 / c.scale;
  return {
    scale: c.scale,
    cx: Math.min(src.width - halfW, Math.max(halfW, c.cx)),
    cy: Math.min(src.height - halfH, Math.max(halfH, c.cy)),
  };
}

/** Cámara suavizada: promedio de la cámara objetivo en los últimos `window` fotogramas (determinista). */
export function smoothCamera(
  frame: number,
  timeAt: (frame: number) => number,
  steps: RecordedStep[],
  src: { width: number; height: number },
  out: { width: number; height: number },
  window = 18,
): Camera {
  let cx = 0;
  let cy = 0;
  let scale = 0;
  let wsum = 0;
  for (let i = 0; i <= window; i++) {
    const f = Math.max(0, frame - i);
    const w = window + 1 - i; // más peso a lo reciente
    const t = timeAt(f);
    const portraitish = out.width / out.height <= 1.2;
    let target = targetCamera(focusAt(steps, t), src, out);
    if (portraitish && !focusAt(steps, t)) {
      // Sin elemento activo: mantener encuadrada la última zona activa (sin zoom extra).
      const last = lastFocusBefore(steps, t);
      if (last) target = { ...target, cx: last.x + last.width / 2, cy: last.y + last.height / 2 };
    }
    const cam = clampCamera(target, src, out);
    cx += cam.cx * w;
    cy += cam.cy * w;
    scale += cam.scale * w;
    wsum += w;
  }
  return clampCamera({ cx: cx / wsum, cy: cy / wsum, scale: scale / wsum }, src, out);
}

/** Proyecta una caja de la grabación a coordenadas de salida. */
export function project(box: Box, cam: Camera, out: { width: number; height: number }): Box {
  return {
    x: out.width / 2 + (box.x - cam.cx) * cam.scale,
    y: out.height / 2 + (box.y - cam.cy) * cam.scale,
    width: box.width * cam.scale,
    height: box.height * cam.scale,
  };
}
