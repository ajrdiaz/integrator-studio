import type { Format } from "./schemas/storyboard";

export interface ParsedRequest {
  raw: string;
  kind: "promo" | "tutorial";
  topic: string;
  durationSec?: number;
  formats: Format[];
}

const FORMAT_WORDS: [RegExp, Format][] = [
  [/\b(vertical|9\s*[:x]\s*16|reel|reels|tiktok|shorts?|stories)\b/i, "9x16"],
  [/\b(cuadrado|1\s*[:x]\s*1)\b/i, "1x1"],
  [/\b(horizontal|16\s*[:x]\s*9|youtube)\b/i, "16x9"],
];

/**
 * Interpreta pedidos como "promo: sin costos ocultos, 30 s, vertical" o
 * "tutorial: emitir una factura electrónica". Lo que no se reconoce queda en `topic`
 * y lo interpreta Claude al escribir el guion.
 */
export function parseRequest(raw: string): ParsedRequest {
  const text = raw.trim();
  const m = /^\s*(promo|tutorial)\s*[:\-–]\s*(.*)$/i.exec(text);
  const kind = (m?.[1]?.toLowerCase() as ParsedRequest["kind"] | undefined) ?? (/\b(c[oó]mo|tutorial|paso a paso)\b/i.test(text) ? "tutorial" : "promo");
  let rest = m?.[2] ?? text;

  let durationSec: number | undefined;
  const dur = /(\d+(?:[.,]\d+)?)\s*(s|seg|segundos?|min|minutos?)\b/i.exec(rest);
  if (dur) {
    const n = Number(dur[1]!.replace(",", "."));
    durationSec = /^m/i.test(dur[2]!) ? Math.round(n * 60) : Math.round(n);
    rest = rest.replace(dur[0], "");
  }

  const formats: Format[] = [];
  for (const [re, f] of FORMAT_WORDS) {
    if (re.test(rest)) {
      formats.push(f);
      rest = rest.replace(re, "");
    }
  }
  if (/\b(todos los formatos|3 formatos|tres formatos)\b/i.test(rest)) {
    formats.splice(0, formats.length, "16x9", "9x16", "1x1");
    rest = rest.replace(/\b(todos los formatos|3 formatos|tres formatos)\b/i, "");
  }

  const topic = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { raw: text, kind, topic: topic || text, durationSec, formats: formats.length ? formats : ["16x9"] };
}
