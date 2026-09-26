import { rmSync } from "node:fs";
import { Job, type Stage } from "../jobs/store";
import { log, redact } from "../log";
import { run, type RunOptions } from "../pipeline";

export interface RunEvent {
  t: string;
  type: "progress" | "status";
  stage?: Stage;
  message: string;
  status?: RunStatus;
}

export type RunStatus = "queued" | "running" | "done" | "error";

interface JobRuntime {
  status: RunStatus | "idle";
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
}

const runtimes = new Map<string, JobRuntime>();
/** Un render usa toda la CPU: los trabajos se ejecutan en fila, uno a la vez. */
let queue: Promise<unknown> = Promise.resolve();

function rt(id: string): JobRuntime {
  let r = runtimes.get(id);
  if (!r) {
    r = { status: "idle", events: [], listeners: new Set() };
    runtimes.set(id, r);
  }
  return r;
}

function emit(id: string, e: Omit<RunEvent, "t">) {
  const r = rt(id);
  const ev = { ...e, message: redact(e.message), t: new Date().toISOString() };
  r.events.push(ev);
  if (r.events.length > 500) r.events.shift();
  for (const l of r.listeners) l(ev);
}

export function runtimeStatus(id: string) {
  return rt(id).status;
}

export function subscribe(id: string, fn: (e: RunEvent) => void): () => void {
  const r = rt(id);
  for (const e of r.events) fn(e);
  r.listeners.add(fn);
  return () => r.listeners.delete(fn);
}

/** Encola una ejecución del pipeline para un job existente. */
export function enqueue(id: string, opts: Omit<RunOptions, "jobId" | "request">): RunStatus {
  const r = rt(id);
  if (r.status === "queued" || r.status === "running") return r.status;
  r.status = "queued";
  r.events = [];
  emit(id, { type: "status", status: "queued", message: "En cola" });
  queue = queue.then(async () => {
    r.status = "running";
    emit(id, { type: "status", status: "running", message: "Procesando" });
    try {
      await run({ ...opts, jobId: id }, (stage, message) => {
        log.step(`[${id}] [${stage}] ${message}`);
        emit(id, { type: "progress", stage, message });
      });
      r.status = "done";
      emit(id, { type: "status", status: "done", message: "Listo" });
    } catch (e) {
      r.status = "error";
      emit(id, { type: "status", status: "error", message: (e as Error).message });
    }
  });
  return "queued";
}

/** Fuerza a volver a sintetizar la voz de una escena (borra su caché) y rehace composición y render. */
export function regenerateSceneVoice(job: Job, sceneId: string, opts: Omit<RunOptions, "jobId" | "request">) {
  rmSync(job.path(`audio/${sceneId}.json`), { force: true });
  return enqueue(job.id, opts);
}
