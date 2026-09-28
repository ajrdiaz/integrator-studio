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
  const pieces = screen.pieces;
  /** Frames que se reproducen de cada tramo (el resto del tramo es el último cuadro congelado). */
  const played = (p: (typeof pieces)[number]) => Math.max(1, Math.min(p.duration, Math.floor(((p.srcEnd - p.srcStart) / p.rate) * fps)));
  const timeAt = (fr: number) => {
    const p = pieces.find((x) => fr >= x.from && fr < x.from + x.duration) ?? pieces[pieces.length - 1]!;
    const local = Math.min(Math.max(0, fr - p.from), played(p) - 1);
    return p.srcStart + (local / fps) * p.rate;
  };
  const t = timeAt(frame);
  const cam = smoothCamera(frame, timeAt, screen.steps, src, out);

  const videoStyle: React.CSSProperties = {
    position: "absolute",
    width: screen.width * cam.scale,
    height: screen.height * cam.scale,
    left: width / 2 - cam.cx * cam.scale,
    top: height / 2 - cam.cy * cam.scale,
    maxWidth: "none",
  };
  const clip = (p: (typeof pieces)[number]) => (
    <OffthreadVideo src={baseUrl + screen.src} startFrom={Math.round((screen.start + p.srcStart) * fps)} playbackRate={p.rate} muted style={videoStyle} />
  );

  // Resaltado + callout durante la pausa final de cada paso.
  const step = screen.steps.find((s) => !s.hideHighlight && s.highlights.some((h) => t >= h.start && t < h.end + 0.25));
  const hl = step?.highlights.find((h) => t >= h.start && t < h.end + 0.25);
  let overlay: React.ReactNode = null;
  if (step && hl) {
    const b = project(hl.box, cam, out);
    const p = Math.min(
      interpolate(t, [hl.start, hl.start + 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      interpolate(t, [hl.end, hl.end + 0.25], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    );
    const pad = 10 * u;
    // Arriba del elemento salvo que choque con el chip del título (zona superior).
    const chipBottom = (isPortrait ? 170 : 120) * u;
    const bubbleAbove = b.y - pad - 90 * u > chipBottom && b.y > height * 0.3;
    const bubbleTop = bubbleAbove ? b.y - pad - 22 * u : b.y + b.height + pad + 22 * u;
    // El globo se centra sobre el elemento sin salirse del cuadro: se limita por su ancho estimado (Poppins ≈ 0,6 em
    // por carácter + relleno), no solo por su centro.
    const bubbleFont = (isPortrait ? 40 : 34) * u;
    const bubbleHalf = Math.min(width - 80 * u, step.callout.length * bubbleFont * 0.6 + 48 * u) / 2;
    const bubbleLeft = Math.min(width - 24 * u - bubbleHalf, Math.max(24 * u + bubbleHalf, b.x + b.width / 2));
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
            fontSize: bubbleFont,
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
      {/* premountFor: en la vista previa (Player) cada tramo es un <video> distinto; montarlo antes evita ver
          el fondo oscuro mientras carga y busca su cuadro. En el render no cambia nada. */}
      {pieces.map((p, i) => (
        <React.Fragment key={i}>
          <Sequence from={p.from} durationInFrames={played(p)} premountFor={fps}>
            {clip(p)}
          </Sequence>
          {p.duration > played(p) ? (
            <Sequence from={p.from + played(p)} durationInFrames={p.duration - played(p)} premountFor={fps}>
              <Freeze frame={played(p) - 1}>{clip(p)}</Freeze>
            </Sequence>
          ) : null}
        </React.Fragment>
      ))}
      {screen.blur?.map((bx, i) => {
        const b = project(bx, cam, out);
        return (
          <div
            key={`blur-${i}`}
            style={{
              position: "absolute",
              left: b.x,
              top: b.y,
              width: b.width,
              height: b.height,
              backdropFilter: `blur(${Math.max(8, 10 * cam.scale)}px)`,
              WebkitBackdropFilter: `blur(${Math.max(8, 10 * cam.scale)}px)`,
              background: "rgba(240,244,243,0.35)",
              borderRadius: 6 * u,
            }}
          />
        );
      })}
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
