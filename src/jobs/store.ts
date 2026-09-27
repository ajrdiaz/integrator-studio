import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { JOBS_DIR } from "../config";
import { redact } from "../log";
import type { ParsedRequest } from "../request";
import { Storyboard, checkStoryboard } from "../schemas/storyboard";

export const STAGES = ["storyboard", "explore", "record", "tts", "compose", "render"] as const;
export type Stage = (typeof STAGES)[number];

export interface StageState {
  status: "pending" | "done" | "failed" | "skipped";
  /** Hash de las entradas con que se produjo la salida; si cambia, la etapa se rehace. */
  inputHash?: string;
  updatedAt?: string;
  error?: string;
  /** Hashes por escena (TTS, grabación) para regenerar solo lo que cambió. */
  scenes?: Record<string, string>;
}

export interface RenderEntry {
  version: number;
  format: string;
  file: string;
  createdAt: string;
  storyboardVersion: number;
  /** Hash del timeline renderizado: si no cambia, se pueden agregar formatos a la misma versión. */
  timelineHash?: string;
  /** Resumen de la revisión automática (detalle en <archivo>.review.json). */
  review?: { errors: number; warnings: number; createdAt: string };
}

export interface JobManifest {
  id: string;
  createdAt: string;
  request: ParsedRequest;
  storyboardVersion: number;
  stages: Partial<Record<Stage, StageState>>;
  renders: RenderEntry[];
  /** Borradores rápidos (media resolución); no cuentan como versiones. */
  drafts?: { format: string; file: string; createdAt: string; storyboardVersion: number }[];
}

export const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** Acceso a /jobs/<id>. Cada escritura queda en disco para poder reanudar cualquier etapa. */
export class Job {
  readonly dir: string;
  manifest: JobManifest;

  private constructor(dir: string, manifest: JobManifest) {
    this.dir = dir;
    this.manifest = manifest;
  }

  static create(request: ParsedRequest): Job {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
    let id = `${stamp}-${request.kind}-${slug(request.topic) || "video"}`;
    let n = 2;
    while (existsSync(path.join(JOBS_DIR, id))) id = `${id.replace(/-\d+$/, "")}-${n++}`;
    const dir = path.join(JOBS_DIR, id);
    mkdirSync(dir, { recursive: true });
    const job = new Job(dir, {
      id,
      createdAt: now.toISOString(),
      request,
      storyboardVersion: 0,
      stages: {},
      renders: [],
    });
    job.save();
    return job;
  }

  static open(id: string): Job {
    const dir = path.isAbsolute(id) ? id : path.join(JOBS_DIR, id);
    const file = path.join(dir, "job.json");
    if (!existsSync(file)) throw new Error(`No existe el job ${id}`);
    return new Job(dir, JSON.parse(readFileSync(file, "utf8")) as JobManifest);
  }

  static list(): JobManifest[] {
    if (!existsSync(JOBS_DIR)) return [];
    return readdirSync(JOBS_DIR)
      .filter((d) => existsSync(path.join(JOBS_DIR, d, "job.json")))
      .map((d) => JSON.parse(readFileSync(path.join(JOBS_DIR, d, "job.json"), "utf8")) as JobManifest)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get id() {
    return this.manifest.id;
  }

  path(...parts: string[]) {
    return path.join(this.dir, ...parts);
  }

  exists(rel: string) {
    return existsSync(this.path(rel));
  }

  save() {
    writeFileSync(this.path("job.json"), JSON.stringify(this.manifest, null, 2));
  }

  readJson<T>(rel: string): T {
    return JSON.parse(readFileSync(this.path(rel), "utf8")) as T;
  }

  /** Escribe JSON pasando por la redacción de secretos. */
  writeJson(rel: string, data: unknown) {
    const file = this.path(rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, redact(JSON.stringify(data, null, 2)));
  }

  stage(name: Stage): StageState {
    return this.manifest.stages[name] ?? { status: "pending" };
  }

  setStage(name: Stage, state: Partial<StageState>) {
    this.manifest.stages[name] = { ...this.stage(name), ...state, updatedAt: new Date().toISOString() };
    this.save();
  }

  /** Invalida la etapa y todas las posteriores. */
  invalidateFrom(name: Stage) {
    for (const s of STAGES.slice(STAGES.indexOf(name))) {
      const st = this.manifest.stages[s];
      if (st) st.status = "pending";
    }
    this.save();
  }

  readStoryboard(): Storyboard {
    return Storyboard.parse(this.readJson("storyboard.json"));
  }

  /** Valida y guarda una nueva versión del storyboard (con copia en history/). */
  writeStoryboard(data: unknown): Storyboard {
    const sb = Storyboard.parse(data);
    const errors = checkStoryboard(sb);
    if (errors.length) throw new Error(`Storyboard inválido:\n- ${errors.join("\n- ")}`);
    const version = this.manifest.storyboardVersion + 1;
    this.writeJson("storyboard.json", sb);
    this.writeJson(`history/storyboard.v${version}.json`, sb);
    this.manifest.storyboardVersion = version;
    this.save();
    return sb;
  }

  nextRenderVersion() {
    return this.manifest.renders.reduce((m, r) => Math.max(m, r.version), 0) + 1;
  }

  copyIn(src: string, rel: string) {
    mkdirSync(path.dirname(this.path(rel)), { recursive: true });
    copyFileSync(src, this.path(rel));
  }
}
