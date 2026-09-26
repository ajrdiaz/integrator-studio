import React from "react";
import { useCurrentFrame } from "remotion";
import type { z } from "zod";
import type { CounterProps } from "../../../src/schemas/templates";
import { progress, useSpringIn } from "../../anim";
import { brand } from "../../brand";
import { useLayout } from "../../layout";
import { Card, SceneShell } from "../../components/SceneShell";

const formatNumber = (n: number, decimals: number) =>
  n.toLocaleString("es-PE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const CounterItem: React.FC<{ item: z.infer<typeof CounterProps>["items"][number]; delay: number; big: boolean }> = ({
  item,
  delay,
  big,
}) => {
  const frame = useCurrentFrame();
  const { u, isPortrait } = useLayout();
  const enter = useSpringIn(delay, 16);
  const count = progress(frame, delay + 4, delay + 40);
  const decimals = item.decimals ?? 0;
  return (
    <Card
      style={{
        flex: 1,
        padding: `${(isPortrait ? 44 : 56) * u}px ${40 * u}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16 * u,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 50 * u}px)`,
        borderTop: `${10 * u}px solid ${brand.green}`,
      }}
    >
      <div
        style={{
          fontSize: (big ? 150 : 118) * u,
          fontWeight: 800,
          color: brand.green,
          letterSpacing: -3 * u,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {item.prefix ?? ""}
        {formatNumber(item.value * count, decimals)}
        {item.suffix ?? ""}
      </div>
      <div style={{ fontSize: 36 * u, fontWeight: 500, color: brand.muted, textAlign: "center", lineHeight: 1.25 }}>
        {item.label}
      </div>
    </Card>
  );
};

export const Counter: React.FC<{ title: string; props: z.infer<typeof CounterProps> }> = ({ title, props }) => {
  const { u, isPortrait } = useLayout();
  return (
    <SceneShell title={title}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: isPortrait ? "column" : "row",
          gap: 36 * u,
          alignItems: "stretch",
          justifyContent: "center",
          maxHeight: isPortrait ? undefined : 520 * u,
          alignSelf: "center",
          width: "100%",
        }}
      >
        {props.items.map((item, i) => (
          <CounterItem key={i} item={item} delay={10 + i * 8} big={props.items.length === 1} />
        ))}
      </div>
    </SceneShell>
  );
};
