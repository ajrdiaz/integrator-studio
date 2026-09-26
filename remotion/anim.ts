import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/** Resorte 0→1 que arranca en `delay` frames. */
export function useSpringIn(delay = 0, damping = 18, durationInFrames?: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.8 }, durationInFrames });
}

/** Progreso lineal suavizado entre dos frames (0→1). */
export function progress(frame: number, start: number, end: number, easing = Easing.bezier(0.33, 1, 0.68, 1)) {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

/** Opacidad de salida en los últimos `frames` de una secuencia. */
export function useExit(frames = 10) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [durationInFrames - frames, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Reparte `n` apariciones dentro de `budget` frames, sin exceder `max` por ítem. */
export function stagger(n: number, budget: number, max = 14) {
  return Math.max(3, Math.min(max, Math.floor(budget / Math.max(1, n))));
}
