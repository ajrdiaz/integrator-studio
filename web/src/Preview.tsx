import { Player } from "@remotion/player";
import React from "react";
import { Video } from "../../remotion/Video";
import { FORMATS, type Format, type Storyboard } from "../../src/schemas/storyboard";
import type { Timeline } from "../../src/schemas/timeline";
import { compose, type SceneAudio } from "../../src/stages/compose";

const DIMS: Record<Format, [number, number]> = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };

/**
 * Vista previa instantánea: compone en el navegador el storyboard que se está editando, reutilizando la voz
 * ya generada de las escenas cuya narración no cambió.
 */
export function previewTimeline(sb: Storyboard, saved: Timeline | null, jobId: string): { timeline: Timeline; staleVoice: string[] } {
  const audio: Record<string, SceneAudio> = {};
  const staleVoice: string[] = [];
  for (const scene of sb.scenes) {
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
  const timeline = compose(sb, { audio, music: saved?.music });
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
