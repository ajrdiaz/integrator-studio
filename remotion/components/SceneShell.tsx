import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { progress, useExit } from "../anim";
import { brand } from "../brand";
import { CaptionReserve } from "./Captions";
import { useLayout } from "../layout";

/**
 * Marco común de las escenas motion: titular arriba con barra verde y área de contenido.
 * Gestiona la salida (fade) de la escena.
 */
export const SceneShell: React.FC<{ title?: string; children: React.ReactNode; bottomReserve?: number }> = ({
  title,
  children,
  bottomReserve = 0,
}) => {
  const frame = useCurrentFrame();
  const { u, pad, isPortrait } = useLayout();
  const reserve = React.useContext(CaptionReserve);
  const exit = useExit(8);
  const t = progress(frame, 0, 14);
  const bar = progress(frame, 4, 20);

  return (
    <AbsoluteFill style={{ opacity: exit, fontFamily: brand.font, color: brand.ink }}>
      <AbsoluteFill
        style={{
          padding: pad,
          paddingTop: pad * (isPortrait ? 1.6 : 0.9),
          paddingBottom: Math.max(pad, reserve) + bottomReserve,
          display: "flex",
          flexDirection: "column",
          gap: (isPortrait ? 60 : 44) * u,
        }}
      >
        {title ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 * u }}>
            <div
              style={{
                width: 90 * u * bar,
                height: 10 * u,
                borderRadius: 99,
                background: brand.green,
              }}
            />
            <div
              style={{
                fontSize: (isPortrait ? 66 : 64) * u,
                fontWeight: 700,
                lineHeight: 1.12,
                letterSpacing: -1 * u,
                opacity: t,
                transform: `translateY(${(1 - t) * 26 * u}px)`,
                maxWidth: isPortrait ? "100%" : "85%",
              }}
            >
              {title}
            </div>
          </div>
        ) : null}
        <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0 }}>{children}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Tarjeta blanca estándar. */
export const Card: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => {
  const { u } = useLayout();
  return (
    <div
      style={{
        background: brand.white,
        borderRadius: 28 * u,
        boxShadow: `0 ${18 * u}px ${50 * u}px rgba(6,61,47,0.10), 0 ${2 * u}px ${6 * u}px rgba(6,61,47,0.06)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
