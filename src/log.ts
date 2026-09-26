import { env, SECRET_KEYS } from "./config";

const MASK = "«oculto»";

function secretValues(): string[] {
  return SECRET_KEYS.map((k) => env[k]).filter((v): v is string => typeof v === "string" && v.length >= 3);
}

/** Reemplaza cualquier valor secreto conocido en un texto. Úsalo antes de escribir logs o archivos. */
export function redact(text: string): string {
  let out = text;
  for (const secret of secretValues()) out = out.split(secret).join(MASK);
  return out;
}

function fmt(args: unknown[]): string {
  return redact(
    args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(" "),
  );
}

export const log = {
  info: (...args: unknown[]) => console.log(fmt(args)),
  step: (...args: unknown[]) => console.log(`▸ ${fmt(args)}`),
  warn: (...args: unknown[]) => console.warn(`⚠ ${fmt(args)}`),
  error: (...args: unknown[]) => console.error(`✖ ${fmt(args)}`),
};
