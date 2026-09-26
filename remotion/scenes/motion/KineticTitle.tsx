import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { KineticTitleProps } from "../../../src/schemas/templates";
import { progress, stagger, useExit } from "../../anim";
import { brand } from "../../brand";
import { useLayout } from "../../layout";
import { CaptionReserve } from "../../components/Captions";

const clean = (w: string) => w.toLowerCase().replace(/[.,:;!¡?¿"“”]/g, "");

export const KineticTitle: React.FC<{ title: string; props: z.infer<typeof KineticTitleProps> }> = ({ title, props }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, isPortrait, pad } = useLayout();
  const exit = useExit(8);
  const reserve = React.useContext(CaptionReserve);
  const words = title.split(/\s+/).filter(Boolean);
  const emphasis = new Set((props.emphasis ?? []).flatMap((e) => e.split(/\s+/)).map(clean));
  const step = stagger(words.length, Math.min(30, durationInFrames * 0.35), 6);
  const subStart = words.length * step + 8;
  const sub = progress(frame, subStart, subStart + 16);
  const fontSize = (isPortrait ? 104 : words.length > 7 ? 104 : 124) * u;

  return (
    <AbsoluteFill
      style={{
        opacity: exit,
        fontFamily: brand.font,
        alignItems: "center",
        justifyContent: "center",
        padding: pad,
        paddingBottom: Math.max(pad, reserve * 0.8),
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: 0.26 * fontSize,
          rowGap: 0.08 * fontSize,
          maxWidth: isPortrait ? "100%" : "82%",
        }}
      >
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * step, fps, config: { damping: 15, mass: 0.7 } });
          const hot = emphasis.has(clean(w));
          const under = progress(frame, i * step + 10, i * step + 26);
          return (
            <span
              key={i}
              style={{
                position: "relative",
                display: "inline-block",
                fontSize,
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: -2 * u,
                color: hot ? brand.green : brand.ink,
                opacity: s,
                transform: `translateY(${(1 - s) * 60 * u}px) scale(${0.92 + 0.08 * s})`,
              }}
            >
              {w}
              {hot ? (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: -0.02 * fontSize,
                    height: 0.12 * fontSize,
                    width: `${under * 100}%`,
                    background: brand.green,
                    opacity: 0.22,
                    borderRadius: 99,
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>
      {props.subline ? (
        <div
          style={{
            marginTop: 44 * u,
            fontSize: (isPortrait ? 44 : 46) * u,
            fontWeight: 500,
            color: brand.muted,
            opacity: sub,
            transform: `translateY(${(1 - sub) * 20 * u}px)`,
            maxWidth: 1200 * u,
          }}
        >
          {props.subline}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
