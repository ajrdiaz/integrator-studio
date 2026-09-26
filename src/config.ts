import "dotenv/config";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: optional,
  CLAUDE_EXPLORER_MODEL: optional,
  ERP_URL: optional,
  ERP_USER: optional,
  ERP_PASSWORD: optional,
  ERP_ENV: optional,
  ERP_PROD_HOSTS: optional,
  TTS_PROVIDER: optional.transform((v) => v ?? "elevenlabs"),
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_VOICE_ID: optional,
  ELEVENLABS_MODEL: optional.transform((v) => v ?? "eleven_multilingual_v2"),
  JOBS_DIR: optional.transform((v) => v ?? "./jobs"),
  REMOTION_BROWSER_EXECUTABLE: optional,
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

/** Variables cuyo valor nunca debe aparecer en logs, transcripts ni archivos del job. */
export const SECRET_KEYS = ["ANTHROPIC_API_KEY", "ERP_USER", "ERP_PASSWORD", "ELEVENLABS_API_KEY"] as const;

export const ROOT_DIR = path.resolve(import.meta.dirname, "..");
export const ASSETS_DIR = path.join(ROOT_DIR, "assets");
export const JOBS_DIR = path.resolve(ROOT_DIR, env.JOBS_DIR);

/** Devuelve la variable o lanza un error que explica para qué se necesita (sin mostrar valores). */
export function requireEnv<K extends keyof Env>(key: K, purpose: string): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Falta la variable de entorno ${String(key)} (necesaria ${purpose}). Defínela en .env.`);
  }
  return value as NonNullable<Env[K]>;
}

/** Chrome Headless Shell para Remotion: variable explícita o el que trae Playwright preinstalado. */
export function browserExecutable(): string | undefined {
  if (env.REMOTION_BROWSER_EXECUTABLE) return env.REMOTION_BROWSER_EXECUTABLE;
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!pwRoot) return undefined;
  for (const candidate of [
    "chromium_headless_shell-1194/chrome-linux/headless_shell",
    "chromium_headless_shell-1194/chrome-headless-shell-linux64/chrome-headless-shell",
  ]) {
    const full = path.join(pwRoot, candidate);
    if (existsSync(full)) return full;
  }
  return undefined;
}
