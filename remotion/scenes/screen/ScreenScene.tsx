import React from "react";
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ScreenScene as ScreenSceneT } from "../../../src/schemas/storyboard";
import type { TimelineScene } from "../../../src/schemas/timeline";
import { progress, useExit } from "../../anim";
import { brand } from "../../brand";
import { project, smoothCamera } from "../../camera";
import { useLayout } from "../../layout";

type Screen = NonNullable<TimelineScene["screen"]>;

/** Escena de pantalla: grabación del ERP con cámara que sigue al área activa, resaltado y callout por paso. */
export const ScreenScene: React.FC<{ scene: ScreenSceneT; screen: Screen; baseUrl: string }> = ({ scene, screen, baseUrl }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { u, isPortrait } = useLayout();
  const exit = useExit(6);
  const src = { width: screen.width, height: screen.height };
  const out = { width, height };
  const segFrames = Math.max(1, Math.floor(((screen.end - screen.start) / screen.rate) * fps));
  const f = Math.min(frame, segFrames - 1);
  const t = (f / fps) * screen.rate;
  const cam = smoothCamera(f, fps, screen.rate, screen.steps, src, out);

  const video = (
    <OffthreadVideo
      src={baseUrl + screen.src}
      startFrom={Math.round(screen.start * fps)}
      playbackRate={screen.rate}
      muted
      style={{
        position: "absolute",
        width: screen.width * cam.scale,
        height: screen.height * cam.scale,
        left: width / 2 - cam.cx * cam.scale,
        top: height / 2 - cam.cy * cam.scale,
        maxWidth: "none",
      }}
    />
  );

  // Resaltado + callout durante la pausa final de cada paso.
  const step = screen.steps.find((s) => t >= s.holdAt && t < s.end + 0.3 && s.box);
  let overlay: React.ReactNode = null;
  if (step?.box) {
    const b = project(step.box, cam, out);
    const p = interpolate(t, [step.holdAt, step.holdAt + 0.35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const pad = 10 * u;
    const bubbleAbove = b.y > height * 0.3;
    const bubbleTop = bubbleAbove ? b.y - pad - 22 * u : b.y + b.height + pad + 22 * u;
    const bubbleLeft = Math.min(width - 40 * u, Math.max(40 * u, b.x + b.width / 2));
    overlay = (
      <>
        <AbsoluteFill style={{ background: `rgba(6,30,24,${0.28 * p})`, clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${b.y - pad}px, ${b.x - pad}px ${b.y - pad}px, ${b.x - pad}px ${b.y + b.height + pad}px, ${b.x + b.width + pad}px ${b.y + b.height + pad}px, ${b.x + b.width + pad}px ${b.y - pad}px, 0 ${b.y - pad}px)` }} />
        <div
          style={{
            position: "absolute",
            left: b.x - pad,
            top: b.y - pad,
            width: b.width + pad * 2,
            height: b.height + pad * 2,
            borderRadius: 14 * u,
            border: `${5 * u}px solid ${brand.green}`,
            boxShadow: `0 0 0 ${8 * u * p}px rgba(0,155,114,0.22)`,
            opacity: p,
            transform: `scale(${1.08 - 0.08 * p})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: bubbleLeft,
            top: bubbleTop,
            transform: `translate(-50%, ${bubbleAbove ? "-100%" : "0"}) translateY(${(1 - p) * 10 * u}px)`,
            opacity: p,
            background: brand.green,
            color: brand.white,
            fontFamily: brand.font,
            fontWeight: 600,
            fontSize: (isPortrait ? 40 : 34) * u,
            padding: `${12 * u}px ${24 * u}px`,
            borderRadius: 16 * u,
            whiteSpace: "nowrap",
            maxWidth: width - 80 * u,
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.25)`,
          }}
        >
          {step.callout}
        </div>
      </>
    );
  }

  const chip = progress(frame, 4, 18);
  const stepIndex = Math.max(0, screen.steps.findIndex((s) => t >= s.start && t < s.end));

  return (
    <AbsoluteFill style={{ opacity: exit, backgroundColor: "#0c1f1a", overflow: "hidden" }}>
      <Sequence durationInFrames={segFrames} layout="none">
        {video}
      </Sequence>
      {frame >= segFrames ? <Freeze frame={segFrames - 1}>{video}</Freeze> : null}
      {overlay}
      <div
        style={{
          position: "absolute",
          left: (isPortrait ? 50 : 40) * u,
          top: (isPortrait ? 70 : 34) * u,
          display: "flex",
          alignItems: "center",
          gap: 14 * u,
          padding: `${12 * u}px ${22 * u}px`,
          borderRadius: 16 * u,
          background: "rgba(8, 32, 26, 0.86)",
          color: brand.white,
          fontFamily: brand.font,
          fontWeight: 600,
          fontSize: (isPortrait ? 36 : 30) * u,
          opacity: chip,
          transform: `translateY(${(1 - chip) * -12 * u}px)`,
          maxWidth: width - 120 * u,
        }}
      >
        <span style={{ background: brand.green, borderRadius: 10 * u, padding: `${2 * u}px ${12 * u}px`, fontSize: 0.8 * (isPortrait ? 36 : 30) * u }}>
          {stepIndex + 1}/{screen.steps.length}
        </span>
        {scene.onScreenText}
      </div>
    </AbsoluteFill>
  );
};
