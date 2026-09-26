import React from "react";
import { useVideoConfig } from "remotion";
import type { z } from "zod";
import type { ComparisonProps } from "../../../src/schemas/templates";
import { stagger, useSpringIn } from "../../anim";
import { brand } from "../../brand";
import { useLayout } from "../../layout";
import { Card, SceneShell } from "../../components/SceneShell";

type Props = z.infer<typeof ComparisonProps>;

const Mark: React.FC<{ good: boolean; size: number }> = ({ good, size }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
    <circle cx={20} cy={20} r={19} fill={good ? brand.green : "#f3dcdb"} />
    {good ? (
      <path d="M12 21 L18 27 L29 14" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M14 14 L26 26 M26 14 L14 26" stroke={brand.danger} strokeWidth={4} strokeLinecap="round" />
    )}
  </svg>
);

const Point: React.FC<{ text: string; good: boolean; delay: number }> = ({ text, good, delay }) => {
  const { u, isPortrait, orientation } = useLayout();
  const s = useSpringIn(delay, 16);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20 * u,
        opacity: s,
        transform: `translateY(${(1 - s) * 20 * u}px)`,
      }}
    >
      <Mark good={good} size={52 * u} />
      <div
        style={{
          fontSize: (isPortrait ? 38 : orientation === "square" ? 33 : 40) * u,
          fontWeight: good ? 600 : 500,
          color: good ? brand.ink : brand.muted,
          textDecoration: good ? "none" : "line-through",
          textDecorationColor: "rgba(217,83,79,0.45)",
          lineHeight: 1.25,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Column: React.FC<{ side: Props["left"]; good: boolean; delay: number; step: number }> = ({ side, good, delay, step }) => {
  const { u, isPortrait } = useLayout();
  const s = useSpringIn(delay, 18);
  return (
    <Card
      style={{
        flex: 1,
        padding: (isPortrait ? 40 : 44) * u,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: (isPortrait ? 26 : 38) * u,
        opacity: s,
        transform: `translateY(${(1 - s) * 50 * u}px) scale(${good ? 1 + 0.02 * s : 1})`,
        border: good ? `${4 * u}px solid ${brand.green}` : `${2 * u}px solid #e7ecea`,
        background: good ? brand.white : "#fbfcfc",
      }}
    >
      <div
        style={{
          alignSelf: "flex-start",
          padding: `${10 * u}px ${24 * u}px`,
          borderRadius: 99,
          background: good ? brand.green : "#e8eeec",
          color: good ? brand.white : brand.muted,
          fontSize: 36 * u,
          fontWeight: 700,
          marginBottom: 8 * u,
        }}
      >
        {side.label}
      </div>
      {side.points.map((p, i) => (
        <Point key={i} text={p} good={good} delay={delay + 10 + i * step} />
      ))}
    </Card>
  );
};

export const Comparison: React.FC<{ title: string; props: Props }> = ({ title, props }) => {
  const { durationInFrames } = useVideoConfig();
  const { u, isPortrait } = useLayout();
  const n = Math.max(props.left.points.length, props.right.points.length);
  const step = stagger(n, durationInFrames * 0.25, 8);
  const rightDelay = 14 + n * step;
  return (
    <SceneShell title={title}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: isPortrait ? "column" : "row",
          gap: 36 * u,
          alignItems: "stretch",
        }}
      >
        <Column side={props.left} good={false} delay={8} step={step} />
        <Column side={props.right} good delay={rightDelay} step={step} />
      </div>
    </SceneShell>
  );
};
