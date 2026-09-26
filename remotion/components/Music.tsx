import React from "react";
import { Audio, interpolate, staticFile } from "remotion";
import type { Timeline } from "../../src/schemas/timeline";

/** Intervalos (en frames globales) donde suena la voz. */
export function voiceIntervals(timeline: Timeline): [number, number][] {
  return timeline.scenes
    .filter((s) => s.audio)
    .map((s) => [s.from + s.audio!.offsetFrames, s.from + s.audio!.offsetFrames + s.audio!.durationInFrames] as [number, number]);
}

/**
 * Volumen de la música en un frame: `base` sin voz, `base * duck` bajo la voz, con rampas suaves,
 * entrada y salida en fade.
 */
export function musicVolume(frame: number, total: number, base: number, intervals: [number, number][], duck = 0.25, ramp = 8): number {
  let presence = 0;
  for (const [a, b] of intervals) {
    const p = interpolate(frame, [a - ramp, a, b, b + ramp * 1.5], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    presence = Math.max(presence, p);
  }
  const fade = interpolate(frame, [0, 15, total - 45, total - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return base * fade * (1 - presence * (1 - duck));
}

export const Music: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const music = timeline.music;
  const intervals = React.useMemo(() => voiceIntervals(timeline), [timeline]);
  if (!music) return null;
  return (
    <Audio
      src={staticFile(music.src)}
      loop
      volume={(f) => musicVolume(f, timeline.totalFrames, music.volume, intervals)}
    />
  );
};
