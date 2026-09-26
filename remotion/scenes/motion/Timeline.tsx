import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { TimelineProps } from "../../../src/schemas/templates";
import { progress, stagger, useSpringIn } from "../../anim";
import { brand } from "../../brand";
import { useLayout } from "../../layout";
import { SceneShell } from "../../components/SceneShell";

type Props = z.infer<typeof TimelineProps>;

const Milestone: React.FC<{ m: Props["milestones"][number]; index: number; delay: number; vertical: boolean }> = ({
  m,
  index,
  delay,
  vertical,
}) => {
  const { u } = useLayout();
  const s = useSpringIn(delay, 14);
  const dot = 84 * u;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: vertical ? "row" : "column",
        alignItems: "center",
        gap: 24 * u,
        flex: 1,
        opacity: s,
      }}
    >
      <div
        style={{
          width: dot,
          height: dot,
          borderRadius: 99,
          background: brand.green,
          color: brand.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 34 * u,
          fontWeight: 700,
          transform: `scale(${s})`,
          boxShadow: `0 0 0 ${10 * u}px rgba(0,155,114,0.15)`,
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        {index + 1}
      </div>
      <div style={{ textAlign: vertical ? "left" : "center", transform: `translateY(${(1 - s) * 16 * u}px)` }}>
        <div style={{ fontSize: 42 * u, fontWeight: 700, color: brand.ink, lineHeight: 1.2 }}>{m.label}</div>
        {m.detail ? (
          <div style={{ fontSize: 31 * u, color: brand.muted, fontWeight: 500, marginTop: 6 * u, lineHeight: 1.3 }}>{m.detail}</div>
        ) : null}
      </div>
    </div>
  );
};

export const Timeline: React.FC<{ title: string; props: Props }> = ({ title, props }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { u, isPortrait } = useLayout();
  const n = props.milestones.length;
  const step = stagger(n, durationInFrames * 0.55, 18);
  const line = progress(frame, 8, 8 + step * n);
  const dot = 84 * u;
  const lineStyle: React.CSSProperties = isPortrait
    ? { position: "absolute", left: dot / 2 - 3 * u, top: dot / 2, width: 6 * u, height: `calc(${line} * (100% - ${dot}px))` }
    : { position: "absolute", top: dot / 2 - 3 * u, left: `${50 / n}%`, width: `${line * (100 - 100 / n)}%`, height: 6 * u };
  return (
    <SceneShell title={title}>
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            display: "flex",
            flexDirection: isPortrait ? "column" : "row",
            gap: isPortrait ? 70 * u : 0,
          }}
        >
          <div style={{ ...lineStyle, background: brand.green, opacity: 0.35, borderRadius: 9 }} />
          {props.milestones.map((m, i) => (
            <Milestone key={i} m={m} index={i} delay={10 + i * step} vertical={isPortrait} />
          ))}
        </div>
      </div>
    </SceneShell>
  );
};
