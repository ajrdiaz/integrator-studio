import path from "node:path";
import { log, redact } from "../log";
import { Job, STAGES, hash, type Stage } from "../jobs/store";
import { parseRequest } from "../request";
import type { Format, Storyboard } from "../schemas/storyboard";
import type { Timeline } from "../schemas/timeline";
import { compose } from "../stages/compose";
import { renderVideo } from "../stages/render";
import { generateStoryboard } from "../stages/storyboard";

export interface RunOptions {
  /** Pedido en texto (job nuevo) o id de un job existente. */
  request?: string;
  jobId?: string;
  /** Importar un storyboard JSON en vez de generarlo con Claude. */
  storyboardFile?: string;
  /** Rehacer desde esta etapa aunque sus entradas no hayan cambiado. */
  from?: Stage;
  /** Detenerse después de esta etapa (p. ej. "storyboard" para revisar antes de continuar). */
  until?: Stage;
  formats?: Format[];
}

export type ProgressFn = (stage: Stage, message: string) => void;

/**
 * Ejecuta el pipeline de un job. Cada etapa se salta si ya está "done" con el mismo hash de entradas,
 * así un job se puede reanudar o regenerar parcialmente.
 */
export async function run(opts: RunOptions, onProgress: ProgressFn = (s, m) => log.step(`[${s}] ${m}`)): Promise<Job> {
  const job = opts.jobId ? Job.open(opts.jobId) : Job.create(parseRequest(opts.request ?? "promo"));
  log.info(`Job ${job.id}  →  ${job.dir}`);
  if (opts.from) job.invalidateFrom(opts.from);

  const stop = (s: Stage) => opts.until !== undefined && STAGES.indexOf(s) >= STAGES.indexOf(opts.until);

  // 1. Storyboard ────────────────────────────────────────────────────────────
  let storyboard: Storyboard;
  if (opts.storyboardFile) {
    const { readFileSync } = await import("node:fs");
    storyboard = job.writeStoryboard(JSON.parse(readFileSync(opts.storyboardFile, "utf8")));
    job.setStage("storyboard", { status: "done", inputHash: hash(storyboard), error: undefined });
    job.invalidateFrom("explore");
    onProgress("storyboard", `importado de ${path.basename(opts.storyboardFile)}`);
  } else if (job.stage("storyboard").status === "done" && job.exists("storyboard.json")) {
    storyboard = job.readStoryboard();
    onProgress("storyboard", `reutilizado (v${job.manifest.storyboardVersion})`);
  } else {
    onProgress("storyboard", `generando con Claude…`);
    try {
      const { storyboard: sb, transcript } = await generateStoryboard(job.manifest.request);
      job.writeJson("logs/storyboard.transcript.json", transcript);
      storyboard = job.writeStoryboard(sb);
      job.setStage("storyboard", { status: "done", inputHash: hash(storyboard), error: undefined });
      onProgress("storyboard", `listo: ${storyboard.scenes.length} escenas`);
    } catch (e) {
      job.setStage("storyboard", { status: "failed", error: redact((e as Error).message) });
      throw e;
    }
  }
  if (opts.formats?.length) storyboard = { ...storyboard, formats: opts.formats };
  if (stop("storyboard")) return job;

  const hasScreen = storyboard.scenes.some((s) => s.type === "screen");
  if (hasScreen) onProgress("explore", "escenas de pantalla pendientes (Fase 3): se renderizan como marcador");

  // 2. Composición ───────────────────────────────────────────────────────────
  const composeHash = hash({ storyboard });
  let timeline: Timeline;
  if (job.stage("compose").status === "done" && job.stage("compose").inputHash === composeHash && job.exists("timeline.json")) {
    timeline = job.readJson<Timeline>("timeline.json");
    onProgress("compose", "reutilizada");
  } else {
    timeline = compose(storyboard);
    job.writeJson("timeline.json", timeline);
    job.setStage("compose", { status: "done", inputHash: composeHash });
    job.invalidateFrom("render");
    onProgress("compose", `${(timeline.totalFrames / timeline.fps).toFixed(1)} s, ${timeline.scenes.length} escenas`);
  }
  if (stop("compose")) return job;

  // 3. Render ────────────────────────────────────────────────────────────────
  const renderHash = hash({ timeline, formats: storyboard.formats });
  if (job.stage("render").status === "done" && job.stage("render").inputHash === renderHash) {
    onProgress("render", "sin cambios; se conserva la última versión");
    return job;
  }
  const version = job.nextRenderVersion();
  try {
    for (const format of storyboard.formats) {
      const rel = `renders/v${version}/${format}.mp4`;
      onProgress("render", `v${version} ${format}…`);
      await renderVideo({ timeline, format, outFile: job.path(rel), assetsDir: job.dir });
      job.manifest.renders.push({
        version,
        format,
        file: rel,
        createdAt: new Date().toISOString(),
        storyboardVersion: job.manifest.storyboardVersion,
      });
      job.save();
      onProgress("render", `listo → ${job.path(rel)}`);
    }
    job.setStage("render", { status: "done", inputHash: renderHash, error: undefined });
  } catch (e) {
    job.setStage("render", { status: "failed", error: redact((e as Error).message) });
    throw e;
  }
  return job;
}
