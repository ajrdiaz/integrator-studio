import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { env } from "../config";
import type { Job, RenderEntry } from "../jobs/store";
import { log } from "../log";
import { runFf } from "../media";
import { Storyboard } from "../schemas/storyboard";
import type { Timeline } from "../schemas/timeline";
import { reviewPath, sortFindings, summarize, type Finding, type Review } from "./review";

/**
 * Revisión visual con Claude: un cuadro por paso de pantalla (cuando el globo del callout está visible) y uno por
 * escena animada, cada uno con lo que dice la narración. Claude marca lo que no coincide: el globo señala otro
 * elemento, la pantalla muestra otra cosa, textos cortados o superpuestos, mensajes de error visibles.
 * Tiene costo (una consulta con imágenes), por eso se ejecuta a pedido.
 */

export interface Moment {
  /** Segundo del video final. */
  at: number;
  scene: string;
  step?: string;
  /** Lo que el espectador debería ver/oír en ese momento. */
  narration: string;
  callout?: string;
  onScreenText?: string;
}

/** Segundo del video final en que se ve el instante `t` de la grabación (relativo al inicio del tramo de la escena). */
function videoTime(ts: Timeline["scenes"][number], t: number, fps: number): number {
  const pieces = ts.screen!.pieces;
  const p = pieces.find((x) => t >= x.srcStart && t < x.srcEnd) ?? pieces.at(-1)!;
  const local = Math.min(Math.max(0, (t - p.srcStart) / p.rate), (p.duration - 1) / fps);
  return (ts.from + p.from) / fps + local;
}

export function visualMoments(sb: Storyboard, tl: Timeline): Moment[] {
  const out: Moment[] = [];
  for (const ts of tl.scenes) {
    const scene = sb.scenes.find((s) => s.id === ts.scene.id) ?? ts.scene;
    if (scene.type === "screen" && ts.screen) {
      for (const rec of ts.screen.steps) {
        const st = scene.steps.find((s) => s.id === rec.stepId);
        if (!st) continue;
        // Mitad del último resaltado (ahí se ve el globo); si no hay, el final del paso.
        const hl = rec.hideHighlight ? undefined : rec.highlights.at(-1);
        const t = hl ? (hl.start + hl.end) / 2 : Math.max(rec.start, rec.end - 0.3);
        out.push({ at: videoTime(ts, t, tl.fps), scene: scene.id, step: st.id, narration: st.narration ?? "", callout: hl ? st.callout : undefined });
      }
    } else {
      // Escenas animadas: cuando la animación ya terminó de entrar.
      out.push({ at: (ts.from + ts.durationInFrames * 0.75) / tl.fps, scene: scene.id, narration: scene.narration, onScreenText: scene.onScreenText });
    }
  }
  return out;
}

const Verdict = z.object({
  moments: z.array(
    z.object({
      index: z.number().int().describe("Número del momento (empieza en 1)"),
      issues: z
        .array(z.object({ severity: z.enum(["error", "warning"]), message: z.string().describe("Qué está mal y qué se ve, en una frase") }))
        .describe("Vacío si todo coincide"),
    }),
  ),
});

const SYSTEM_PROMPT = `Revisas la calidad de videos tutoriales del ERP Integrator antes de publicarlos. Recibes cuadros del video final y, para cada uno, lo que dice la narración y el globo (callout) que se muestra.

Para cada momento, revisa:
- Si hay un globo verde con texto (callout) y un recuadro verde, ¿el recuadro señala el elemento que nombra el globo? (p. ej. un globo "Precio (S/)" sobre una fila de la tabla está mal).
- ¿Lo que se ve en pantalla corresponde a lo que dice la narración? (p. ej. la narración dice "presiona Registrar" y no hay nada de eso a la vista).
- Textos cortados, superpuestos o ilegibles; subtítulos que tapan lo importante.
- Mensajes de error, pantallas vacías o de carga donde debería verse el resultado.

Sé concreto y no marques detalles menores de estilo. "error" = el espectador se confundiría o aprendería algo incorrecto; "warning" = mejorable. Responde en español.`;

async function ask(moments: Moment[], images: string[]): Promise<{ verdict: z.infer<typeof Verdict>; costUsd?: number }> {
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const content: Extract<SDKUserMessage["message"]["content"], unknown[]> = [
    { type: "text", text: `Video con ${moments.length} momentos a revisar. Devuelve un elemento por momento.` },
  ];
  moments.forEach((m, i) => {
    const said = [
      `Momento ${i + 1} (${fmt(m.at)}, ${m.step ? `paso ${m.scene}/${m.step}` : `escena ${m.scene}`})`,
      m.narration ? `Narración: «${m.narration}»` : "",
      m.callout ? `Globo (callout): «${m.callout}»` : "",
      m.onScreenText ? `Texto en pantalla esperado: «${m.onScreenText}»` : "",
    ].filter(Boolean);
    content.push({ type: "text", text: said.join("\n") });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: images[i]! } });
  });

  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null } as SDKUserMessage;
  }
  const messages = query({
    prompt: prompt(),
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: env.CLAUDE_MODEL,
      tools: [],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 3,
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(Verdict, { target: "draft-7" }) as Record<string, unknown> },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "integrator-video-studio/0.1" },
    },
  });
  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  for await (const msg of messages) if (msg.type === "result") result = msg;
  if (!result || result.subtype !== "success") throw new Error(`La revisión visual no terminó (${result?.subtype ?? "sin resultado"}).`);
  const data = result.structured_output ?? JSON.parse(result.result);
  return { verdict: Verdict.parse(data), costUsd: result.total_cost_usd };
}

/** Revisa visualmente un render y agrega los hallazgos ("visual") a su revisión (reemplaza los visuales anteriores). */
export async function visualReview(job: Job, entry: RenderEntry, tl: Timeline): Promise<Review> {
  // El guion con que se hizo este render (el vigente puede haber cambiado después).
  const history = `history/storyboard.v${entry.storyboardVersion}.json`;
  const sb = job.exists(history) ? Storyboard.parse(job.readJson(history)) : job.readStoryboard();
  const moments = visualMoments(sb, tl);
  if (!moments.length) throw new Error("El video no tiene momentos que revisar.");
  const dir = job.path(entry.file.replace(/\.mp4$/, ".visual"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const images = moments.map((m, i) => {
    const file = `${dir}/${String(i + 1).padStart(2, "0")}.jpg`;
    runFf("ffmpeg", ["-v", "error", "-y", "-ss", m.at.toFixed(3), "-i", job.path(entry.file), "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", file]);
    return readFileSync(file).toString("base64");
  });

  log.info(`  revisión visual: ${moments.length} cuadros → Claude`);
  const { verdict, costUsd } = await ask(moments, images);
  const visual: Finding[] = verdict.moments.flatMap((v) => {
    const m = moments[v.index - 1];
    if (!m) return [];
    return v.issues.map((i) => ({ level: i.severity, check: "visual" as const, message: i.message, at: m.at, scene: m.scene, step: m.step }));
  });

  const rel = reviewPath(entry.file);
  const previous = job.exists(rel) ? job.readJson<Review>(rel) : undefined;
  const review: Review = {
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    file: entry.file,
    format: previous?.format ?? (entry.format as Review["format"]),
    stats: previous?.stats ?? { durationSec: tl.totalFrames / tl.fps, width: 0, height: 0 },
    findings: sortFindings([...(previous?.findings ?? []).filter((f) => f.check !== "visual"), ...visual]),
    visual: { createdAt: new Date().toISOString(), moments: moments.length, costUsd },
  };
  job.writeJson(rel, review);
  entry.review = { ...summarize(review), createdAt: new Date().toISOString() };
  job.save();
  return review;
}

/** Revisión visual de todos los formatos de la última versión. */
export async function visualReviewLatest(job: Job): Promise<Review[]> {
  const last = job.manifest.renders.reduce((a, r) => Math.max(a, r.version), 0);
  const tl = job.readJson<Timeline>("timeline.json");
  const out: Review[] = [];
  for (const r of job.manifest.renders.filter((x) => x.version === last && job.exists(x.file))) out.push(await visualReview(job, r, tl));
  return out;
}
