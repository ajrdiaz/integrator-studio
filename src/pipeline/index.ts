import path from "node:path";
import { log, redact } from "../log";
import { Job, STAGES, hash, type Stage } from "../jobs/store";
import { parseRequest } from "../request";
import type { Format, Storyboard } from "../schemas/storyboard";
import type { Timeline } from "../schemas/timeline";
import { existsSync, readdirSync } from "node:fs";
import { ASSETS_DIR } from "../config";
import { compose, type SceneAudio } from "../stages/compose";
import { explore } from "../stages/explore";
import { record } from "../stages/record";
import { RecordingPlan, type Recording } from "../schemas/recording-plan";
import { getProvider, synthesizeScenes } from "../stages/tts";
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
  /** Proveedor de voz ("elevenlabs", "silent") o false para un video sin voz. */
  tts?: string | false;
}

/** Primera pista en assets/music (mp3/m4a/wav), si existe. */
function pickMusic(): string | undefined {
  const dir = `${ASSETS_DIR}/music`;
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).filter((n) => /\.(mp3|m4a|wav)$/i.test(n)).sort()[0];
  return f ? `music/${f}` : undefined;
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
  // Formatos a renderizar: los pedidos explícitamente; si no, los del pedido original (por defecto solo 16:9).
  const formats: Format[] = opts.formats?.length ? opts.formats : job.manifest.request.formats.length ? job.manifest.request.formats : ["16x9"];
  if (stop("storyboard")) return job;

  // 2. Exploración del ERP (agente) y grabación determinista ─────────────────
  const screens = storyboard.scenes.filter((s) => s.type === "screen");
  let recording: Recording | undefined;
  if (screens.length) {
    // El plan depende solo de los objetivos y pasos de las escenas de pantalla (no de textos ni voz).
    const exploreHash = hash(screens.map((s) => ({ id: s.id, goal: s.goal, steps: s.steps.map((st) => ({ id: st.id, objective: st.objective })) })));
    let plan: RecordingPlan;
    if (job.stage("explore").status === "done" && job.stage("explore").inputHash === exploreHash && job.exists("recording-plan.json")) {
      plan = RecordingPlan.parse(job.readJson("recording-plan.json"));
      onProgress("explore", "recording plan reutilizado");
    } else {
      onProgress("explore", "el agente explora el ERP de prueba…");
      try {
        plan = await explore(job, storyboard, (m) => onProgress("explore", m));
        job.writeJson("recording-plan.json", plan);
      } catch (e) {
        job.setStage("explore", { status: "failed", error: redact((e as Error).message) });
        throw e;
      }
      if (plan.blocked) {
        const msg = `El agente se trabó en ${plan.blocked.sceneId}/${plan.blocked.stepId}: ${plan.blocked.reason}`;
        job.setStage("explore", { status: "failed", error: redact(msg) });
        throw new Error(msg);
      }
      job.setStage("explore", { status: "done", inputHash: exploreHash, error: undefined });
      job.invalidateFrom("record");
    }
    if (stop("explore")) return job;

    const recordHash = hash({ plan: plan.scenes, v: 1 });
    if (job.stage("record").status === "done" && job.stage("record").inputHash === recordHash && job.exists("recordings/recording.json")) {
      recording = job.readJson<Recording>("recordings/recording.json");
      onProgress("record", "grabación reutilizada");
    } else {
      try {
        recording = await record(job, plan, (m) => onProgress("record", m));
        job.writeJson("recordings/recording.json", recording);
        job.setStage("record", { status: "done", inputHash: recordHash, error: undefined });
        onProgress("record", `${recording.durationSec.toFixed(1)} s grabados`);
      } catch (e) {
        job.setStage("record", { status: "failed", error: redact((e as Error).message) });
        throw e;
      }
    }
    if (stop("record")) return job;
  }

  // 3. Voz en off ─────────────────────────────────────────────────────────────
  let audio: Record<string, SceneAudio> | undefined;
  if (opts.tts !== false) {
    const provider = getProvider(opts.tts || undefined);
    try {
      const res = await synthesizeScenes(job, storyboard, provider, (m) => onProgress("tts", m));
      audio = res.audio;
      job.setStage("tts", { status: "done", inputHash: hash(audio), error: undefined, scenes: Object.fromEntries(Object.entries(audio).map(([k, v]) => [k, hash(v)])) });
      onProgress("tts", res.generated.length ? `${res.generated.length} audio(s) nuevos (${provider.id})` : "sin cambios");
    } catch (e) {
      job.setStage("tts", { status: "failed", error: redact((e as Error).message) });
      throw e;
    }
  } else {
    job.setStage("tts", { status: "skipped" });
  }
  if (stop("tts")) return job;

  // 4. Composición ───────────────────────────────────────────────────────────
  const musicSrc = storyboard.music ? pickMusic() : undefined;
  if (storyboard.music && !musicSrc) onProgress("compose", "sin música: agrega una pista en assets/music/");
  const music = musicSrc ? { src: musicSrc, volume: 0.28 } : undefined;
  const composeHash = hash({ storyboard, audio, music, recording });
  let timeline: Timeline;
  if (job.stage("compose").status === "done" && job.stage("compose").inputHash === composeHash && job.exists("timeline.json")) {
    timeline = job.readJson<Timeline>("timeline.json");
    onProgress("compose", "reutilizada");
  } else {
    timeline = compose(storyboard, { audio, music, recording });
    job.writeJson("timeline.json", timeline);
    job.setStage("compose", { status: "done", inputHash: composeHash });
    job.invalidateFrom("render");
    onProgress("compose", `${(timeline.totalFrames / timeline.fps).toFixed(1)} s, ${timeline.scenes.length} escenas`);
  }
  if (stop("compose")) return job;

  // 5. Render ────────────────────────────────────────────────────────────────
  // Si el timeline no cambió, se reutiliza la última versión y solo se generan los formatos que falten.
  const timelineHash = hash(timeline);
  const lastVersion = job.nextRenderVersion() - 1;
  const last = job.manifest.renders.filter((r) => r.version === lastVersion);
  const reuse = opts.from !== "render" && last.length > 0 && last.every((r) => r.timelineHash === timelineHash);
  const version = reuse ? lastVersion : lastVersion + 1;
  const missing = reuse ? formats.filter((f) => !last.some((r) => r.format === f)) : formats;
  if (!missing.length) {
    onProgress("render", `sin cambios; v${version} ya tiene ${formats.join(", ")}`);
    return job;
  }
  try {
    for (const format of missing) {
      const rel = `renders/v${version}/${format}.mp4`;
      onProgress("render", `v${version} ${format}…`);
      await renderVideo({ timeline, format, outFile: job.path(rel), assetsDir: job.dir });
      job.manifest.renders.push({
        version,
        format,
        file: rel,
        createdAt: new Date().toISOString(),
        storyboardVersion: job.manifest.storyboardVersion,
        timelineHash,
      });
      job.save();
      onProgress("render", `listo → ${rel}`);
    }
    job.setStage("render", { status: "done", inputHash: timelineHash, error: undefined });
  } catch (e) {
    job.setStage("render", { status: "failed", error: redact((e as Error).message) });
    throw e;
  }
  return job;
}
