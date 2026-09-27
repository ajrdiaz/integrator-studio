import { Player } from "@remotion/player";
import React from "react";
import { Video } from "../../remotion/Video";
import { FORMATS, type Format, type Storyboard } from "../../src/schemas/storyboard";
import type { Recording } from "../../src/schemas/recording-plan";
import type { Timeline } from "../../src/schemas/timeline";
import { compose, type SceneAudio } from "../../src/stages/compose";

/** Reconstruye la grabación del ERP a partir del timeline guardado (para la vista previa). */
function recordingFrom(saved: Timeline | null): Recording | undefined {
  const screens = saved?.scenes.filter((s) => s.screen) ?? [];
  if (!screens.length) return undefined;
  const first = screens[0]!.screen!;
  return {
    file: first.src,
    width: first.width,
    height: first.height,
    durationSec: Math.max(...screens.map((s) => s.screen!.end)),
    scenes: screens.map((s) => ({ sceneId: s.scene.id, start: s.screen!.start, end: s.screen!.end })),
    steps: screens.flatMap((s) => {
      const o = s.screen!.start;
      return s.screen!.steps.map((st) => ({
        ...st,
        start: st.start + o,
        end: st.end + o,
        highlights: st.highlights.map((h) => ({ ...h, start: h.start + o, end: h.end + o })),
        clicks: st.clicks.map((c) => ({ ...c, t: c.t + o })),
        focus: st.focus.map((f) => ({ ...f, t: f.t + o })),
      }));
    }),
  };
}

const DIMS: Record<Format, [number, number]> = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };

/**
 * Vista previa instantánea: compone en el navegador el storyboard que se está editando, reutilizando la voz
 * ya generada de las escenas cuya narración no cambió.
 */
export function previewTimeline(sb: Storyboard, saved: Timeline | null, jobId: string): { timeline: Timeline; staleVoice: string[] } {
  const audio: Record<string, SceneAudio> = {};
  const staleVoice: string[] = [];
  for (const scene of sb.scenes) {
    if (scene.type === "screen" && scene.steps.some((st) => st.narration)) continue; // voz por paso: abajo
    const prev = saved?.scenes.find((s) => s.scene.id === scene.id);
    if (prev?.audio && prev.scene.narration === scene.narration) {
      const fps = saved!.fps;
      const offset = prev.audio.offsetFrames;
      audio[scene.id] = {
        src: prev.audio.src,
        durationSec: prev.audio.durationInFrames / fps,
        words: prev.captions?.map((w) => ({ text: w.text, startSec: (w.startFrame - offset) / fps, endSec: (w.endFrame - offset) / fps })),
      };
    } else if (saved?.scenes.some((s) => s.audio)) {
      staleVoice.push(scene.id);
    }
  }
  // Voces por paso (escenas de pantalla) y grabación ya existentes.
  for (const ts of saved?.scenes ?? []) {
    const scene = sb.scenes.find((x) => x.id === ts.scene.id);
    for (const v of ts.stepVoices ?? []) {
      const stepId = v.key.slice(ts.scene.id.length + 2);
      const prevStep = ts.scene.type === "screen" ? ts.scene.steps.find((x) => x.id === stepId) : undefined;
      const step = scene?.type === "screen" ? scene.steps.find((x) => x.id === stepId) : undefined;
      if (step && prevStep && step.narration === prevStep.narration) {
        const fps = saved!.fps;
        audio[v.key] = {
          src: v.src,
          durationSec: v.durationInFrames / fps,
          words: ts.captions
            ?.filter((w) => w.startFrame >= v.offsetFrames && w.startFrame < v.offsetFrames + v.durationInFrames + 3)
            .map((w) => ({ text: w.text, startSec: (w.startFrame - v.offsetFrames) / fps, endSec: (w.endFrame - v.offsetFrames) / fps })),
        };
      } else if (step?.narration && !staleVoice.includes(ts.scene.id)) {
        staleVoice.push(ts.scene.id);
      }
    }
  }
  const recording = recordingFrom(saved);
  const timeline = compose(sb, { audio, music: saved?.music, recording });
  return { timeline: { ...timeline, assetBaseUrl: `/jobs/${jobId}/` }, staleVoice };
}

export const Preview: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const [format, setFormat] = React.useState<Format>("16x9");
  const [w, h] = DIMS[format];
  return (
    <div className="preview">
      <div className="preview-head">
        <h3>Vista previa</h3>
        <div className="seg">
          {FORMATS.map((f) => (
            <button key={f} className={f === format ? "on" : ""} onClick={() => setFormat(f)}>
              {f.replace("x", ":")}
            </button>
          ))}
        </div>
      </div>
      <div className={`player-wrap f${format}`}>
        <Player
          component={Video}
          inputProps={{ timeline, format }}
          durationInFrames={Math.max(1, timeline.totalFrames)}
          fps={timeline.fps}
          compositionWidth={w}
          compositionHeight={h}
          controls
          acknowledgeRemotionLicense
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
};
