import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { useSpringIn } from "../anim";
import { brand } from "../brand";
import { useLayout } from "../layout";
import { Logo } from "./Logo";

const ChatIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5Z"
      stroke={brand.white}
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path
      d="M8.6 7.8c.3-.6.7-.6 1-.6h.6c.2 0 .5 0 .7.5l.8 1.9c.1.3 0 .5-.1.7l-.5.6c-.2.2-.2.4 0 .7.6 1 1.6 2 2.7 2.6.3.2.5.1.7-.1l.6-.7c.2-.2.4-.3.7-.2l1.8.9c.3.1.4.3.4.5 0 .6-.3 1.5-1 1.9-.7.4-1.9.6-3.7-.3-2-1-3.6-2.8-4.4-4.4-.8-1.6-.6-2.8-.3-3.3Z"
      fill={brand.white}
    />
  </svg>
);

const GlobeIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={brand.white} strokeWidth="1.8">
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19M12 2.5c2.6 2.6 3.9 5.8 3.9 9.5s-1.3 6.9-3.9 9.5c-2.6-2.6-3.9-5.8-3.9-9.5S9.4 5.1 12 2.5Z" />
  </svg>
);

/** Cierre fijo con CTA: "Asesoría gratuita · WhatsApp +51 941 427 296 · integrator.pe". */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, height, isPortrait } = useLayout();

  const enter = interpolate(frame, [0, 16], [height, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const logo = useSpringIn(12, 16);
  const head = useSpringIn(18, 16);
  const line1 = useSpringIn(26, 18);
  const line2 = useSpringIn(32, 18);

  const pill = (children: React.ReactNode, p: number) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18 * u,
        padding: `${18 * u}px ${34 * u}px`,
        borderRadius: 999,
        background: "rgba(255,255,255,0.14)",
        border: `${2 * u}px solid rgba(255,255,255,0.35)`,
        color: brand.white,
        fontSize: (isPortrait ? 40 : 42) * u,
        fontWeight: 600,
        opacity: p,
        transform: `translateY(${(1 - p) * 30 * u}px)`,
      }}
    >
      {children}
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        transform: `translateY(${enter}px)`,
        background: `linear-gradient(160deg, ${brand.green} 0%, ${brand.greenDark} 60%, ${brand.greenDeep} 100%)`,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: brand.font,
        gap: 34 * u,
      }}
    >
      <div
        style={{
          background: brand.white,
          borderRadius: 28 * u,
          padding: `${24 * u}px ${40 * u}px`,
          transform: `scale(${0.8 + logo * 0.2})`,
          opacity: logo,
        }}
      >
        <Logo height={80 * u} />
      </div>
      <div
        style={{
          color: brand.white,
          fontSize: (isPortrait ? 92 : 96) * u,
          fontWeight: 800,
          letterSpacing: -1.5 * u,
          opacity: head,
          transform: `translateY(${(1 - head) * 30 * u}px)`,
        }}
      >
        {brand.cta.headline}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: isPortrait ? "column" : "row",
          gap: 24 * u,
          alignItems: "center",
        }}
      >
        {pill(
          <>
            <ChatIcon size={46 * u} />
            {brand.cta.whatsapp}
          </>,
          line1,
        )}
        {pill(
          <>
            <GlobeIcon size={42 * u} />
            {brand.cta.web}
          </>,
          line2,
        )}
      </div>
    </AbsoluteFill>
  );
};
