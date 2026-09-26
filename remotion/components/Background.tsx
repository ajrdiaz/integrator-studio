import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { brand } from "../brand";
import { useLayout } from "../layout";

/** Fondo claro de marca con formas verdes difusas que se desplazan lentamente. */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, u } = useLayout();
  const t = frame / 30;
  const blobs = [
    { x: 0.12, y: 0.18, r: 520, dx: 40, dy: 30, o: 0.16, p: 0 },
    { x: 0.9, y: 0.85, r: 620, dx: -50, dy: -25, o: 0.13, p: 2 },
    { x: 0.85, y: 0.1, r: 360, dx: -30, dy: 40, o: 0.08, p: 4 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: brand.bg, overflow: "hidden" }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x * width + Math.sin(t * 0.35 + b.p) * b.dx * u - b.r * u,
            top: b.y * height + Math.cos(t * 0.3 + b.p) * b.dy * u - b.r * u,
            width: b.r * 2 * u,
            height: b.r * 2 * u,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(0,155,114,${b.o}) 0%, rgba(0,155,114,0) 70%)`,
          }}
        />
      ))}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(rgba(6,61,47,0.07) ${1.4 * u}px, transparent ${1.6 * u}px)`,
          backgroundSize: `${34 * u}px ${34 * u}px`,
          maskImage: "linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.2))",
        }}
      />
    </AbsoluteFill>
  );
};
