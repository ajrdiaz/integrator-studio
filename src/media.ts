import { execFileSync, spawnSync } from "node:child_process";
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
