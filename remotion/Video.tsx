import React from "react";
import { AbsoluteFill, Sequence, delayRender, continueRender, useCurrentFrame } from "remotion";
import type { VideoProps } from "../src/schemas/timeline";
import { brand, ensureFonts } from "./brand";
import { Background } from "./components/Background";
import { Intro } from "./components/Intro";
import { Logo } from "./components/Logo";
import { Outro } from "./components/Outro";
import { useLayout } from "./layout";
import { SceneRenderer } from "./registry";

const Chrome: React.FC<{ start: number; end: number }> = ({ start, end }) => {
  const frame = useCurrentFrame();
  const { u, isPortrait } = useLayout();
  const p = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          right: (isPortrait ? 60 : 70) * u,
          top: (isPortrait ? 70 : 54) * u,
          opacity: 0.95,
        }}
      >
        <Logo height={(isPortrait ? 54 : 48) * u} />
      </div>
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 8 * u, width: `${p * 100}%`, background: brand.green }} />
    </AbsoluteFill>
  );
};

export const Video: React.FC<VideoProps> = ({ timeline }) => {
  const [handle] = React.useState(() => delayRender("Cargando Poppins"));
  React.useEffect(() => {
    ensureFonts().then(() => continueRender(handle));
  }, [handle]);

  const scenesStart = timeline.introFrames;
  const scenesEnd = timeline.totalFrames - timeline.outroFrames;

  return (
    <AbsoluteFill style={{ fontFamily: brand.font }}>
      <Background />
      <Sequence from={scenesStart} durationInFrames={scenesEnd - scenesStart} name="Marca">
        <Chrome start={0} end={scenesEnd - scenesStart} />
      </Sequence>
      {timeline.scenes.map((ts) => (
        <Sequence key={ts.scene.id} from={ts.from} durationInFrames={ts.durationInFrames} name={ts.scene.id}>
          <SceneRenderer scene={ts.scene} />
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={timeline.introFrames} name="Intro">
        <Intro />
      </Sequence>
      <Sequence from={scenesEnd} durationInFrames={timeline.outroFrames} name="Cierre">
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
