import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { ChecklistProps } from "../../../src/schemas/templates";
import { progress, stagger, useSpringIn } from "../../anim";
import { brand } from "../../brand";
import { useLayout } from "../../layout";
import { Card, SceneShell } from "../../components/SceneShell";

const Item: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const frame = useCurrentFrame();
  const { u, isPortrait } = useLayout();
  const s = useSpringIn(delay, 16);
  const check = progress(frame, delay + 8, delay + 20);
  const fill = progress(frame, delay + 4, delay + 12);
  const size = 64 * u;
  return (
    <Card
      style={{
        display: "flex",
        alignItems: "center",
        gap: 30 * u,
        padding: `${(isPortrait ? 30 : 26) * u}px ${34 * u}px`,
        opacity: s,
        transform: `translateX(${(1 - s) * -60 * u}px)`,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
        <circle cx={32} cy={32} r={29} fill={brand.green} opacity={fill} />
        <circle cx={32} cy={32} r={29} fill="none" stroke={brand.green} strokeWidth={4} />
        <path
          d="M19 33 L28 42 L46 23"
          fill="none"
          stroke={brand.white}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={50}
          strokeDashoffset={50 * (1 - check)}
        />
      </svg>
      <div style={{ fontSize: (isPortrait ? 42 : 40) * u, fontWeight: 600, color: brand.ink, lineHeight: 1.2 }}>{text}</div>
    </Card>
  );
};

export const Checklist: React.FC<{ title: string; props: z.infer<typeof ChecklistProps> }> = ({ title, props }) => {
  const { durationInFrames } = useVideoConfig();
  const { u, isLandscape } = useLayout();
  const step = stagger(props.items.length, durationInFrames * 0.6, 16);
  const twoCols = isLandscape && props.items.length > 3;
  return (
    <SceneShell title={title}>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: twoCols ? "1fr 1fr" : "1fr",
          gap: 26 * u,
          alignContent: "center",
          width: "100%",
        }}
      >
        {props.items.map((t, i) => (
          <Item key={i} text={t} delay={12 + i * step} />
        ))}
      </div>
    </SceneShell>
  );
};
