import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionWord } from "../../src/schemas/timeline";
import { brand } from "../brand";
import { useLayout } from "../layout";

export interface CaptionPage {
  words: CaptionWord[];
  startFrame: number;
  endFrame: number;
}

/** Agrupa palabras en "páginas" cortas (1-2 líneas), cortando en puntuación. */
export function paginate(words: CaptionWord[], maxWords: number, maxChars: number, sceneEnd: number): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    pages.push({ words: cur, startFrame: cur[0]!.startFrame, endFrame: cur[cur.length - 1]!.endFrame });
    cur = [];
  };
  for (const w of words) {
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || chars > maxChars)) flush();
    cur.push(w);
    if (/[.!?;:]$/.test(w.text) || (/,$/.test(w.text) && cur.length >= 3)) flush();
  }
  flush();
  // Cada página se mantiene hasta que empieza la siguiente (sin parpadeos), con un tope al final de la escena.
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    p.endFrame = next ? next.startFrame : Math.min(sceneEnd, p.endFrame + 12);
  });
  return pages;
}

/** Espacio que las escenas deben dejar libre abajo para los subtítulos. */
export const CaptionReserve = React.createContext(0);

/** Subtítulos quemados, sincronizados palabra por palabra con la locución de la escena. */
export const Captions: React.FC<{ words: CaptionWord[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { u, isPortrait, orientation } = useLayout();
  const maxChars = orientation === "landscape" ? 52 : 30;
  const pages = React.useMemo(() => paginate(words, orientation === "landscape" ? 9 : 6, maxChars, durationInFrames), [words, orientation, maxChars, durationInFrames]);
  const page = pages.find((p) => frame >= p.startFrame && frame < p.endFrame);
  if (!page) return null;

  const fontSize = (isPortrait ? 54 : orientation === "square" ? 46 : 44) * u;
  const appear = Math.min(1, (frame - page.startFrame) / 4);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          marginBottom: (isPortrait ? 300 : 70) * u,
          maxWidth: isPortrait ? "86%" : "78%",
          padding: `${14 * u}px ${26 * u}px`,
          borderRadius: 22 * u,
          background: "rgba(8, 32, 26, 0.82)",
          textAlign: "center",
          lineHeight: 1.35,
          fontFamily: brand.font,
          fontWeight: 600,
          fontSize,
          color: brand.white,
          opacity: appear,
          transform: `translateY(${(1 - appear) * 8 * u}px)`,
        }}
      >
        {page.words.map((w, i) => {
          const next = page.words[i + 1];
          const active = frame >= w.startFrame && (next ? frame < next.startFrame : frame < w.endFrame + 6);
          const spoken = frame >= w.startFrame;
          return (
            <span
              key={i}
              style={{
                padding: `0 ${6 * u}px`,
                margin: `0 ${1 * u}px`,
                borderRadius: 10 * u,
                background: active ? brand.green : "transparent",
                color: spoken ? brand.white : "rgba(255,255,255,0.72)",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
