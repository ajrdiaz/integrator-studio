import { execFileSync } from "node:child_process";
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

export function runFf(tool: "ffmpeg" | "ffprobe", args: string[]): string {
  const dir = binDir();
  const bin = dir ? path.join(dir, tool) : tool;
  const env = dir ? { ...process.env, LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } : process.env;
  return execFileSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Duración real de un archivo de audio/video en segundos. */
export function mediaDuration(file: string): number {
  const out = runFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = Number(out.trim());
  if (!Number.isFinite(d)) throw new Error(`No se pudo medir la duración de ${file}`);
  return d;
}
