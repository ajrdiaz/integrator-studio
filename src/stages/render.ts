import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { availableParallelism } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { ASSETS_DIR, ROOT_DIR, browserExecutable } from "../config";
import { log } from "../log";
import { TARGET_LUFS, normalizeLoudness } from "../media";
import type { Format } from "../schemas/storyboard";
import type { Timeline, VideoProps } from "../schemas/timeline";

let bundlePromise: Promise<string> | null = null;

/** Empaqueta el proyecto Remotion una vez por proceso. */
export function getBundle(): Promise<string> {
  bundlePromise ??= bundle({
    entryPoint: path.join(ROOT_DIR, "remotion/index.ts"),
    publicDir: ASSETS_DIR,
    onProgress: () => undefined,
  });
  return bundlePromise;
}

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

/** Servidor HTTP local (solo lectura, con Range) para que el render acceda a audios y grabaciones del job. */
export async function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = path.resolve(root, "." + rel);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
      createReadStream(file).pipe(res);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface RenderOptions {
  timeline: Timeline;
  format: Format;
  outFile: string;
  /** Directorio del job, servido para audios/grabaciones. */
  assetsDir: string;
  /** Borrador: media resolución y compresión rápida (para revisar). */
  draft?: boolean;
}

export async function renderVideo({ timeline, format, outFile, assetsDir, draft }: RenderOptions) {
  const serveUrl = await getBundle();
  const server = await serveDir(assetsDir);
  try {
    const inputProps: VideoProps = { timeline: { ...timeline, assetBaseUrl: server.url }, format };
    const id = `Video-${format}`;
    const exe = browserExecutable();
    const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable: exe });
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: draft ? 28 : 18,
      scale: draft ? 0.5 : 1,
      x264Preset: draft ? "veryfast" : "medium",
      // Remotion usa la mitad de los núcleos por defecto; el render es el cuello de botella, así que se usan todos.
      concurrency: Math.max(1, availableParallelism()),
      jpegQuality: draft ? 60 : 80,
      outputLocation: outFile,
      inputProps,
      browserExecutable: exe,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== last) {
          last = pct;
          log.info(`  ${format}: ${pct}%`);
        }
      },
    });
    // Remotion mezcla voz y música sin normalizar: se lleva la sonoridad al estándar de redes.
    const norm = normalizeLoudness(outFile);
    if (norm) log.info(`  ${format}: audio ${norm.beforeLufs} → ${TARGET_LUFS} LUFS`);
    return outFile;
  } finally {
    await server.close();
  }
}

/** Captura un fotograma (útil para revisar plantillas sin renderizar todo el video). */
export async function renderFrame(opts: Omit<RenderOptions, "outFile"> & { frame: number; outFile: string }) {
  const serveUrl = await getBundle();
  const server = await serveDir(opts.assetsDir);
  try {
    const inputProps: VideoProps = { timeline: { ...opts.timeline, assetBaseUrl: server.url }, format: opts.format };
    const exe = browserExecutable();
    const composition = await selectComposition({ serveUrl, id: `Video-${opts.format}`, inputProps, browserExecutable: exe });
    await renderStill({ composition, serveUrl, frame: opts.frame, output: opts.outFile, inputProps, browserExecutable: exe });
    return opts.outFile;
  } finally {
    await server.close();
  }
}
