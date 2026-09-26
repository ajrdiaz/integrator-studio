import React from "react";
import { useCurrentFrame } from "remotion";
import type { z } from "zod";
import type { DashboardProps } from "../../../src/schemas/templates";
import { progress, useSpringIn } from "../../anim";
import { brand } from "../../brand";
import { useLayout } from "../../layout";
import { Card, SceneShell } from "../../components/SceneShell";

type Props = z.infer<typeof DashboardProps>;

const Chart: React.FC<{ chart: Props["chart"]; start: number }> = ({ chart, start }) => {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const W = 1000;
  const H = 420;
  const padB = 4;
  const max = Math.max(...chart.values, 1) * 1.1;
  const n = chart.values.length;
  const colW = W / n;
  const y = (v: number) => (H - padB) * (1 - v / max);
  const grid = [0.25, 0.5, 0.75, 1].map((g) => (H - padB) * (1 - g));

  const clipId = React.useId().replace(/:/g, "");
  if (chart.kind === "line") {
    const pts = chart.values.map((v, i) => [colW * i + colW / 2, y(v)] as const);
    const d = pts.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x},${yy}`).join(" ");
    const area = `${d} L${pts[pts.length - 1]![0]},${H - padB} L${pts[0]![0]},${H - padB} Z`;
    const draw = progress(frame, start, start + 45);
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
          {grid.map((g, i) => (
            <line key={i} x1={0} x2={W} y1={g} y2={g} stroke="#e4eeea" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={W * draw} height={H} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <path d={area} fill={brand.green} opacity={0.12} />
            <path
              d={d}
              fill="none"
              stroke={brand.green}
              strokeWidth={6 * u}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        </svg>
        {pts.map(([x, yy], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(x / W) * 100}%`,
              top: `${(yy / H) * 100}%`,
              width: 22 * u,
              height: 22 * u,
              marginLeft: -11 * u,
              marginTop: -11 * u,
              borderRadius: 99,
              background: brand.white,
              border: `${5 * u}px solid ${brand.green}`,
              boxSizing: "border-box",
              opacity: draw * W >= x ? 1 : 0,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
      {grid.map((g, i) => (
        <line key={i} x1={0} x2={W} y1={g} y2={g} stroke="#e4eeea" strokeWidth={2} />
      ))}
      {chart.values.map((v, i) => {
        const p = progress(frame, start + i * 4, start + i * 4 + 24);
        const h = (H - padB - y(v)) * p;
        const bw = colW * 0.56;
        const last = i === n - 1;
        return (
          <g key={i}>
            <rect
              x={colW * i + (colW - bw) / 2}
              y={H - padB - h}
              width={bw}
              height={h}
              rx={10}
              fill={last ? brand.green : "#9fd9c5"}
            />
          </g>
        );
      })}
    </svg>
  );
};

export const Dashboard: React.FC<{ title: string; props: Props }> = ({ title, props }) => {
  const { u, isPortrait } = useLayout();
  const win = useSpringIn(6, 18);
  const cols = isPortrait ? 2 : props.kpis.length;
  return (
    <SceneShell title={title}>
      <Card
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          opacity: win,
          transform: `translateY(${(1 - win) * 60 * u}px) scale(${0.96 + 0.04 * win})`,
        }}
      >
        <div
          style={{
            height: 64 * u,
            background: brand.greenDeep,
            display: "flex",
            alignItems: "center",
            gap: 12 * u,
            padding: `0 ${28 * u}px`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: 99, background: c }} />
          ))}
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 24 * u, fontWeight: 500, marginLeft: 16 * u }}>
            Integrator · Tablero gerencial
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 36 * u, gap: 32 * u, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 24 * u }}>
            {props.kpis.map((k, i) => (
              <Kpi key={i} kpi={k} delay={16 + i * 6} />
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 * u }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Chart chart={props.chart} start={24 + props.kpis.length * 4} />
            </div>
            <div style={{ display: "flex" }}>
              {props.chart.labels.map((l, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 24 * u, color: brand.muted, fontWeight: 500 }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </SceneShell>
  );
};

const Kpi: React.FC<{ kpi: Props["kpis"][number]; delay: number }> = ({ kpi, delay }) => {
  const { u } = useLayout();
  const s = useSpringIn(delay, 16);
  const positive = !kpi.delta || !kpi.delta.trim().startsWith("-");
  return (
    <div
      style={{
        background: brand.bg,
        borderRadius: 20 * u,
        padding: `${22 * u}px ${26 * u}px`,
        opacity: s,
        transform: `translateY(${(1 - s) * 24 * u}px)`,
        border: `${2 * u}px solid #e1efe9`,
      }}
    >
      <div style={{ fontSize: 24 * u, color: brand.muted, fontWeight: 500 }}>{kpi.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 * u, marginTop: 6 * u }}>
        <div style={{ fontSize: 46 * u, fontWeight: 700, color: brand.ink, whiteSpace: "nowrap" }}>{kpi.value}</div>
        {kpi.delta ? (
          <div style={{ fontSize: 24 * u, fontWeight: 600, color: positive ? brand.green : brand.danger }}>{kpi.delta}</div>
        ) : null}
      </div>
    </div>
  );
};
