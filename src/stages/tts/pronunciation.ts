/**
 * Ajustes de pronunciación para la locución. Se aplican palabra por palabra para poder mapear los tiempos
 * del audio de vuelta al texto original (los subtítulos muestran el texto escrito, no el hablado).
 * Agrega aquí siglas o términos que la voz lea mal.
 */
export const PRONUNCIATION: Record<string, string> = {
  SUNAT: "Sunat",
  IGV: "i ge ve",
  RUC: "ruc",
  ERP: "e erre pe",
  PDF: "pe de efe",
  XML: "equis eme ele",
  CDR: "ce de erre",
  "S/": "soles",
};

export interface SpokenText {
  spoken: string;
  /** Para cada palabra original, cuántas palabras habladas la representan. */
  spans: number[];
  original: string[];
}

const splitWord = (w: string) => /^([¿¡"“(]*)(.*?)([.,;:!?"”)…]*)$/.exec(w) ?? ["", "", w, ""];

export function toSpoken(text: string): SpokenText {
  const original = text.split(/\s+/).filter(Boolean);
  const spokenWords: string[] = [];
  const spans: number[] = [];
  for (const w of original) {
    const [, pre, core, post] = splitWord(w);
    const replacement = PRONUNCIATION[core!] ?? PRONUNCIATION[core!.toUpperCase()];
    const parts = replacement ? `${pre}${replacement}${post}`.split(" ") : [w];
    spokenWords.push(...parts);
    spans.push(parts.length);
  }
  return { spoken: spokenWords.join(" "), spans, original };
}

/** Reagrupa los tiempos de las palabras habladas en las palabras originales. */
export function mapTimings<T extends { startSec: number; endSec: number }>(
  st: SpokenText,
  spokenTimings: T[],
): { text: string; startSec: number; endSec: number }[] {
  if (spokenTimings.length !== st.spans.reduce((a, b) => a + b, 0)) {
    // El proveedor tokenizó distinto: repartir proporcionalmente para no perder la sincronía global.
    const total = spokenTimings.at(-1)?.endSec ?? 0;
    const start = spokenTimings[0]?.startSec ?? 0;
    const lens = st.original.map((w) => w.length + 1);
    const sum = lens.reduce((a, b) => a + b, 0);
    let t = start;
    return st.original.map((text, i) => {
      const d = ((total - start) * lens[i]!) / sum;
      const w = { text, startSec: t, endSec: t + d };
      t += d;
      return w;
    });
  }
  let k = 0;
  return st.original.map((text, i) => {
    const first = spokenTimings[k]!;
    const last = spokenTimings[k + st.spans[i]! - 1]!;
    k += st.spans[i]!;
    return { text, startSec: first.startSec, endSec: last.endSec };
  });
}
