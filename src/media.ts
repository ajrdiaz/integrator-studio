import { execFileSync, spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** ffprobe/ffmpeg incluidos en el compositor de Remotion (o los del sistema si no se encuentran). */
function binDir(): string | undefined {
  const variants =
    process.platform === "linux" ? [`linux-${process.arch}-gnu`, `linux-${process.arch}-musl`] : [`${process.platform}-${process.arch}`];
  for (const v of variants) {
    try {
      return path.dirname(require.resolve(`@remotion/compositor-${v}/package.json`));
    } catch {
      /* siguiente */
    }
  }
  return undefined;
}

function ffCommand(tool: "ffmpeg" | "ffprobe") {
  const dir = binDir();
  const bin = dir ? path.join(dir, tool) : tool;
  // Las bibliotecas (libav*) vienen junto al binario: LD_LIBRARY_PATH en Linux, DYLD_LIBRARY_PATH en macOS.
  const libPath = (v?: string) => [dir, v].filter(Boolean).join(":");
  const env = dir
    ? { ...process.env, LD_LIBRARY_PATH: libPath(process.env.LD_LIBRARY_PATH), DYLD_LIBRARY_PATH: libPath(process.env.DYLD_LIBRARY_PATH) }
    : process.env;
  return { bin, env };
}

export function runFf(tool: "ffmpeg" | "ffprobe", args: string[]): string {
  const { bin, env } = ffCommand(tool);
  return execFileSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Ejecuta ffmpeg y devuelve su registro (stderr), donde escriben los filtros de análisis (blackdetect, volumedetect…). */
export function ffmpegLog(args: string[]): string {
  const { bin, env } = ffCommand("ffmpeg");
  const r = spawnSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg falló (${r.status}): ${r.stderr.split("\n").filter(Boolean).slice(-3).join(" ")}`);
  return r.stderr;
}

/** Ejecuta ffmpeg y devuelve su salida binaria (p. ej. cuadros crudos por image2pipe). */
export function ffmpegStdout(args: string[]): Buffer {
  const { bin, env } = ffCommand("ffmpeg");
  const r = spawnSync(bin, args, { env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg falló (${r.status}): ${r.stderr.toString().split("\n").filter(Boolean).slice(-3).join(" ")}`);
  return r.stdout;
}

/** Duración real de un archivo de audio/video en segundos. */
export function mediaDuration(file: string): number {
  const out = runFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = Number(out.trim());
  if (!Number.isFinite(d)) throw new Error(`No se pudo medir la duración de ${file}`);
  return d;
}

/** Sonoridad objetivo del audio final: la habitual en redes (YouTube, Instagram, TikTok normalizan cerca de -14). */
export const TARGET_LUFS = -14;

/**
 * Normaliza el audio de un MP4 a TARGET_LUFS con loudnorm en dos pasadas (medir y aplicar), sin recodificar el video.
 * Si el pico no deja margen para una ganancia lineal, loudnorm limita dinámicamente. Devuelve la sonoridad medida antes.
 */
export function normalizeLoudness(file: string): { beforeLufs: number } | undefined {
  const hasAudio = runFf("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]).trim();
  if (!hasAudio) return undefined;
  const target = `I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const log = ffmpegLog(["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `loudnorm=${target}:print_format=json`, "-c:a", "pcm_s16le", "-f", "null", "-"]);
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(log);
  if (!json) throw new Error("loudnorm no devolvió mediciones");
  const m = JSON.parse(json[0]) as Record<string, string>;
  if (!Number.isFinite(Number(m.input_i))) return undefined; // audio en silencio: nada que normalizar
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  const tmp = file.replace(/\.mp4$/, ".norm.mp4");
  runFf("ffmpeg", [
    "-v", "error", "-y", "-i", file,
    "-map", "0:v", "-map", "0:a", "-c:v", "copy",
    "-af", `loudnorm=${target}:${measured}:linear=true`,
    "-ar", "48000", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", tmp,
  ]);
  renameSync(tmp, file);
  return { beforeLufs: Number(m.input_i) };
}
