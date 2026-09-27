import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { runFf } from "../media";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { ASSETS_DIR, JOBS_DIR, ROOT_DIR } from "../config";
import { Job, STAGES, type Stage } from "../jobs/store";
import { reviewLatest } from "../stages/review";
import { log } from "../log";
import { parseRequest } from "../request";
import { FORMATS, Storyboard, checkStoryboard, type Format } from "../schemas/storyboard";
import { enqueue, regenerateSceneVoice, runtimeStatus, subscribe } from "./runner";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const WEB_DIST = path.join(ROOT_DIR, "web/dist");

const app = express();
app.use(express.json({ limit: "2mb" }));

const openJob = (req: Request, res: Response): Job | undefined => {
  const id = String(req.params.id);
  if (!/^[\w-]+$/.test(id)) {
    res.status(400).json({ error: "id inválido" });
    return undefined;
  }
  try {
    return Job.open(id);
  } catch {
    res.status(404).json({ error: "job no encontrado" });
    return undefined;
  }
};

const runOpts = (body: Record<string, unknown>) => {
  const formats = Array.isArray(body.formats) ? (body.formats.filter((f) => FORMATS.includes(f as Format)) as Format[]) : undefined;
  const from = STAGES.includes(body.from as Stage) ? (body.from as Stage) : undefined;
  const until = STAGES.includes(body.until as Stage) ? (body.until as Stage) : undefined;
  const tts = body.tts === false ? (false as const) : typeof body.tts === "string" && body.tts ? body.tts : undefined;
  return { formats: formats?.length ? formats : undefined, from, until, tts, draft: body.draft === true };
};

const jobView = (job: Job) => ({
  manifest: job.manifest,
  runtime: runtimeStatus(job.id),
  storyboard: job.exists("storyboard.json") ? job.readJson("storyboard.json") : null,
  timeline: job.exists("timeline.json") ? job.readJson("timeline.json") : null,
  history: existsSync(job.path("history"))
    ? readdirSync(job.path("history"))
        .map((f) => Number(/storyboard\.v(\d+)\.json/.exec(f)?.[1]))
        .filter(Boolean)
        .sort((a, b) => b - a)
    : [],
});

// ── API ────────────────────────────────────────────────────────────────────
app.get("/api/jobs", (_req, res) => {
  res.json(
    Job.list().map((m) => {
      let title: string | undefined;
      try {
        title = (Job.open(m.id).readJson("storyboard.json") as { title?: string }).title;
      } catch {
        /* aún sin guion */
      }
      return { ...m, title, runtime: runtimeStatus(m.id) };
    }),
  );
});

/** Nuevo pedido: crea el job y genera solo el guion, para revisarlo antes de producir. */
app.post("/api/jobs", (req, res) => {
  const text = String(req.body?.request ?? "").trim();
  if (!text) return void res.status(400).json({ error: "Escribe un pedido" });
  const job = Job.create(parseRequest(text));
  enqueue(job.id, { until: "storyboard" });
  res.status(201).json({ id: job.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = openJob(req, res);
  if (job) res.json(jobView(job));
});

/** Guarda el storyboard editado como nueva versión (validado con zod). */
app.put("/api/jobs/:id/storyboard", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  const parsed = Storyboard.safeParse(req.body?.storyboard);
  if (!parsed.success) {
    return void res.status(400).json({ errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  }
  const errors = checkStoryboard(parsed.data);
  if (errors.length) return void res.status(400).json({ errors });
  job.writeStoryboard(parsed.data);
  job.setStage("storyboard", { status: "done", error: undefined });
  res.json(jobView(job));
});

app.get("/api/jobs/:id/history/:v", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  const rel = `history/storyboard.v${Number(req.params.v)}.json`;
  if (!job.exists(rel)) return void res.status(404).json({ error: "versión no encontrada" });
  res.json(job.readJson(rel));
});

/** Ejecuta el pipeline (opcionalmente desde/hasta una etapa). */
app.post("/api/jobs/:id/run", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  res.json({ status: enqueue(job.id, runOpts(req.body ?? {})) });
});

/** Regenera la voz de una sola escena y vuelve a renderizar. */
app.post("/api/jobs/:id/scenes/:scene/voice", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  const scene = String(req.params.scene);
  if (!/^[a-z0-9-]+$/.test(scene)) return void res.status(400).json({ error: "escena inválida" });
  res.json({ status: regenerateSceneVoice(job, scene, runOpts(req.body ?? {})) });
});

/** Revisa (o vuelve a revisar) la última versión renderizada. Tarda unos segundos por formato. */
app.post("/api/jobs/:id/review", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  if (["queued", "running"].includes(runtimeStatus(job.id))) return void res.status(409).json({ error: "El job se está procesando" });
  try {
    reviewLatest(job);
    res.json(jobView(job));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Fotograma de la grabación del ERP en el segundo `t` (PNG, con caché). Lo usa el editor de clips. */
app.get("/api/jobs/:id/frame", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  const t = Math.max(0, Math.round(Number(req.query.t ?? 0) * 10) / 10);
  if (!Number.isFinite(t) || !job.exists("recordings/tutorial.mp4")) return void res.status(404).end();
  const rel = `recordings/thumbs/${t.toFixed(1)}.png`;
  if (!job.exists(rel)) {
    mkdirSync(job.path("recordings/thumbs"), { recursive: true });
    try {
      runFf("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", job.path("recordings/tutorial.mp4"), "-frames:v", "1", "-vf", "scale=1280:-2", job.path(rel)]);
    } catch {
      return void res.status(500).end();
    }
  }
  res.sendFile(job.path(rel));
});

/** Progreso en vivo (Server-Sent Events). */
app.get("/api/jobs/:id/events", (req, res) => {
  const job = openJob(req, res);
  if (!job) return;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const unsubscribe = subscribe(job.id, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// ── Archivos ───────────────────────────────────────────────────────────────
// Renders y audios de cada job (con soporte de Range para el reproductor).
app.use("/jobs", express.static(JOBS_DIR, { dotfiles: "deny", index: false }));
// Recursos de marca en la raíz: staticFile() del Player de Remotion los pide como /fonts/…, /logo.svg, /music/….
app.use(express.static(ASSETS_DIR, { index: false }));
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/|jobs\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
} else {
  app.get("/", (_req, res) => res.type("text").send("Falta compilar la interfaz: npm run web"));
}

app.listen(PORT, HOST, () => log.info(`Integrator Video Studio → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`));
