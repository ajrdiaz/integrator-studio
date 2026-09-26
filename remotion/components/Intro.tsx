import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useSpringIn, progress } from "../anim";
import { brand } from "../brand";
import { useLayout } from "../layout";
import { Logo } from "./Logo";

export const INTRO_TAGLINE = "El ERP para empresas que venden y producen";

/** Intro fija de 3 s: panel verde, logo en tarjeta blanca, tagline, y salida hacia arriba. */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { u, height, isPortrait } = useLayout();

  const card = useSpringIn(4, 14);
  const ring = progress(frame, 0, 40);
  const tagline = progress(frame, 26, 44);
  const exit = interpolate(frame, [durationInFrames - 14, durationInFrames], [0, -height], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });

  return (
    <AbsoluteFill
      style={{
        transform: `translateY(${exit}px)`,
        background: `radial-gradient(circle at 30% 20%, ${brand.green} 0%, ${brand.greenDark} 55%, ${brand.greenDeep} 100%)`,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: brand.font,
      }}
    >
      {[1, 1.35, 1.7].map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 520 * u * s,
            height: 520 * u * s,
            borderRadius: "50%",
            border: `${2 * u}px solid rgba(255,255,255,${0.18 - i * 0.05})`,
            transform: `scale(${0.6 + ring * 0.4})`,
            opacity: ring,
          }}
        />
      ))}
      <div
        style={{
          background: brand.white,
          borderRadius: 36 * u,
          padding: `${38 * u}px ${56 * u}px`,
          boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.25)`,
          transform: `scale(${0.7 + card * 0.3}) translateY(${(1 - card) * 40 * u}px)`,
          opacity: card,
        }}
      >
        <Logo height={(isPortrait ? 100 : 120) * u} />
      </div>
      <div
        style={{
          marginTop: 48 * u,
          color: brand.white,
          fontSize: (isPortrait ? 40 : 44) * u,
          fontWeight: 500,
          letterSpacing: 0.3 * u,
          opacity: tagline,
          transform: `translateY(${(1 - tagline) * 24 * u}px)`,
          textAlign: "center",
          maxWidth: (isPortrait ? 900 : 1500) * u,
        }}
      >
        {INTRO_TAGLINE}
      </div>
    </AbsoluteFill>
  );
};
