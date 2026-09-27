import type { Job, RenderEntry } from "../jobs/store";
import { ffmpegLog, ffmpegStdout, runFf } from "../media";
import type { LocatorSpec, PlanStep, RecordingPlan } from "../schemas/recording-plan";
import type { Format, Storyboard } from "../schemas/storyboard";
import type { Timeline } from "../schemas/timeline";
import { stepKey } from "./compose";

/**
 * Revisión automática de un render (sin IA):
 *  1. Guion vs. grabación: los botones y opciones que nombran la narración y los callouts existen en la pantalla.
 *  2. Técnica: duración y tamaño del MP4, cuadros negros, parpadeos, imagen quieta, silencios, volumen y huecos del timeline.
 */

export interface Finding {
  level: "error" | "warning" | "info";
  check: "guion" | "timeline" | "video" | "audio";
  message: string;
  /** Segundo del video final donde mirar. */
  at?: number;
  scene?: string;
  step?: string;
}

export interface Review {
  createdAt: string;
  file: string;
  format: Format;
  findings: Finding[];
  stats: { durationSec: number; width: number; height: number; loudnessLufs?: number; peakDb?: number };
}

/** Textos visibles de cada paso (al empezar y al terminar), por `stepKey`. Los guarda la grabación. */
export type ScreenTexts = Record<string, string>;

export const DIMS: Record<Format, [number, number]> = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };

// ── 1. Guion vs. grabación ──────────────────────────────────────────────────

/** Minúsculas, sin tildes ni signos, y cada palabra sin plural simple ("facturas" = "factura"). */
export const norm = (s: string) =>
  ` ${s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, "") : w))
    .join(" ")} `;

const UPPER = "A-ZÁÉÍÓÚÑÜ";
const WORD = `[${UPPER}][\\wÁÉÍÓÚÑÜáéíóúñü]*`;
/** Frase con mayúscula inicial en cada palabra, admitiendo conectores entre ellas: "Grabar y Continuar", "Nota de Venta". */
const PHRASE = `${WORD}(?:\\s+(?:(?:y|e|o|de|del|la|el|a|en|con|para)\\s+)?${WORD})*`;
/** Solo la primera letra del verbo admite mayúscula (inicio de oración); la frase sí distingue mayúsculas. */
const ci = (w: string) => `[${w[0]}${w[0]!.toUpperCase()}]${w.slice(1)}`;
const VERBS = ["haz\\s+clic", "clic", "pulsa", "presiona", "oprime", "selecciona", "elige", "abre", "entra", "ve", "ingresa", "marca", "activa", "usa", "toca", "botón", "opción", "pestaña", "menú", "enlace"];
const FILLER = "(?:\\s+(?:en|a|al|sobre|el|la|los|las|un|una|botón|opción|pestaña|menú|enlace|módulo|campo|ícono|icono))*";
const MENTION = new RegExp(`(?<![\\wáéíóúñ])(?:${VERBS.map(ci).join("|")})${FILLER}\\s+(${PHRASE})`, "gu");
const QUOTED = /[«"“]([^»"”]{2,60})[»"”]/g;

/** Nombres de la interfaz que la narración le pide al usuario usar: "Haz clic en Nueva Factura" → "Nueva Factura". */
export function mentions(narration: string): string[] {
  const out = new Set<string>();
  for (const m of narration.matchAll(MENTION)) out.add(m[1]!.replace(/\.$/, ""));
  for (const m of narration.matchAll(QUOTED)) out.add(m[1]!);
  return [...out];
}

/** Textos de los elementos que usa un paso del plan (nombres, etiquetas, opciones elegidas). */
function targetTexts(step: PlanStep): string[] {
  const out: string[] = [];
  const add = (t?: LocatorSpec) => {
    if (!t) return;
    for (const v of [t.name, t.label, t.placeholder, t.text]) if (v) out.push(v);
    add(t.within);
  };
  for (const a of step.actions) {
    if ("target" in a) add(a.target);
    if (a.type === "select") out.push(a.option);
  }
  add(step.highlight);
  return out;
}

const CLICKABLE = ["button", "link", "menuitem", "tab"];
const clickedNames = (step: PlanStep) =>
  step.actions.flatMap((a) => (a.type === "click" && a.target.name && CLICKABLE.includes(a.target.role ?? "") ? [a.target.name] : []));

/**
 * La mención coincide con un texto si está contenida en él ("Facturas" en "Comercial > Facturas"), o si el texto
 * cubre casi toda una mención larga. "Factura" no alcanza para "Nueva Factura", ni "Grabar" para "Grabar y Continuar".
 */
export const found = (mention: string, texts: string[]) => {
  const m = norm(mention);
  const words = m.trim().split(" ").length;
  return texts.some((t) => {
    const n = norm(t);
    return n.includes(m) || (words > 2 && m.includes(n) && n.trim().split(" ").length >= words - 1);
  });
};

/** Segundo del video final en que empieza un paso (por su voz o por el tramo de grabación). */
function stepTime(tl: Timeline, sceneId: string, stepId: string): number | undefined {
  const ts = tl.scenes.find((s) => s.scene.id === sceneId);
  if (!ts) return undefined;
  const voice = ts.stepVoices?.find((v) => v.key === stepKey(sceneId, stepId));
  if (voice) return (ts.from + voice.offsetFrames) / tl.fps;
  const st = ts.screen?.steps.find((s) => s.stepId === stepId);
  const piece = st && ts.screen?.pieces.find((p) => st.start >= p.srcStart - 0.05 && st.start < p.srcEnd);
  return piece ? (ts.from + piece.from) / tl.fps : ts.from / tl.fps;
}

export function checkScript(sb: Storyboard, plan: RecordingPlan, tl: Timeline, screen?: ScreenTexts): Finding[] {
  const findings: Finding[] = [];
  for (const scene of sb.scenes) {
    if (scene.type !== "screen") continue;
    const planScene = plan.scenes.find((p) => p.sceneId === scene.id);
    if (!planScene) continue;
    const sceneTexts = planScene.steps.flatMap(targetTexts);
    for (const st of scene.steps) {
      const planStep = planScene.steps.find((p) => p.id === st.id);
      if (!planStep) continue;
      const where = { scene: scene.id, step: st.id, at: stepTime(tl, scene.id, st.id) };
      const own = targetTexts(planStep);
      const onScreen = screen?.[stepKey(scene.id, st.id)];
      const visible = (m: string) => !!onScreen && norm(onScreen).includes(norm(m));
      const used = clickedNames(planStep);
      const hint = used.length ? ` En este paso se hace clic en: ${used.map((u) => `«${u}»`).join(", ")}.` : "";

      // Narración: lo que se le pide al usuario tocar debe existir (en el paso, en la escena o en la pantalla).
      const flagged = new Map<string, Finding>();
      for (const m of mentions(st.narration ?? "")) {
        if (found(m, own) || found(m, sceneTexts) || visible(m)) continue;
        const f: Finding = {
          level: "warning",
          check: "guion",
          ...where,
          message: `La narración dice «${m}», pero ${onScreen ? "no aparece en la pantalla" : "no coincide con ningún elemento que se usa"}.${hint}`,
        };
        findings.push(f);
        flagged.set(norm(m), f);
      }

      // Callout: cada parte ("Comercial > Facturación > Facturas") debe verse en la pantalla. Sin los textos de
      // pantalla no se puede saber si nombra una etiqueta de campo ("Cliente"), así que solo se une al aviso de la
      // narración cuando ambos dicen lo mismo.
      const callout = st.callout ?? planStep.callout;
      if (!callout) continue;
      const same = flagged.get(norm(callout));
      const parts = callout.split(/\s*[>›/]\s*/).filter(Boolean);
      if (!onScreen || parts.every((p) => found(p, own) || visible(p))) {
        if (same && !onScreen) same.message = same.message.replace("La narración dice", "La narración y el callout dicen");
        continue;
      }
      if (same) same.message = same.message.replace("La narración dice", "La narración y el callout dicen");
      else findings.push({ level: "warning", check: "guion", ...where, message: `El callout «${callout}» no aparece en la pantalla.${hint}` });
    }
  }
  if (!screen && sb.scenes.some((s) => s.type === "screen")) {
    findings.push({ level: "info", check: "guion", message: "Esta grabación no guardó los textos de pantalla: solo se revisaron los botones que se usan. Los callouts de campos se revisarán cuando vuelvas a grabar." });
  }
  return findings;
}

// ── 2a. Timeline ────────────────────────────────────────────────────────────

export function checkTimeline(tl: Timeline): Finding[] {
  const findings: Finding[] = [];
  const sec = (f: number) => f / tl.fps;
  for (const ts of tl.scenes) {
    const id = ts.scene.id;
    const end = ts.durationInFrames;
    const voices = ts.stepVoices?.length ? ts.stepVoices : ts.audio ? [{ key: id, ...ts.audio }] : [];
    for (const [i, v] of voices.entries()) {
      if (v.offsetFrames + v.durationInFrames > end + 1) {
        findings.push({ level: "error", check: "timeline", scene: id, at: sec(ts.from + end), message: `La voz ${v.key} se corta: termina ${sec(v.offsetFrames + v.durationInFrames - end).toFixed(1)} s después del fin de la escena.` });
      }
      const next = voices[i + 1];
      if (next && v.offsetFrames + v.durationInFrames > next.offsetFrames + 1) {
        findings.push({ level: "error", check: "timeline", scene: id, at: sec(ts.from + next.offsetFrames), message: `Las voces ${v.key} y ${next.key} se superponen ${sec(v.offsetFrames + v.durationInFrames - next.offsetFrames).toFixed(1)} s.` });
      }
    }
    const pieces = ts.screen?.pieces ?? [];
    let cursor = 0;
    for (const p of pieces) {
      if (p.from > cursor + 1) {
        findings.push({ level: "error", check: "timeline", scene: id, at: sec(ts.from + cursor), message: `Hueco sin video de ${sec(p.from - cursor).toFixed(2)} s (se vería el fondo).` });
      }
      cursor = Math.max(cursor, p.from + p.duration);
      const played = Math.min(p.duration, Math.floor(((p.srcEnd - p.srcStart) / p.rate) * tl.fps));
      const frozen = sec(p.duration - played);
      if (frozen > 4) {
        findings.push({ level: "warning", check: "timeline", scene: id, at: sec(ts.from + p.from + played), message: `La imagen queda congelada ${frozen.toFixed(1)} s esperando a la voz.` });
      }
      if (p.rate > 2) {
        findings.push({ level: "warning", check: "timeline", scene: id, at: sec(ts.from + p.from), message: `Un tramo se acelera ×${p.rate.toFixed(1)}: puede verse demasiado rápido.` });
      }
    }
    if (pieces.length && cursor < end - 1) {
      findings.push({ level: "error", check: "timeline", scene: id, at: sec(ts.from + cursor), message: `Los últimos ${sec(end - cursor).toFixed(2)} s de la escena no tienen video (se vería el fondo).` });
    }
  }
  return findings;
}

// ── 2b. MP4 ─────────────────────────────────────────────────────────────────

/** Nombre de la parte del video en el segundo `t`. */
function sceneAt(tl: Timeline, t: number): string {
  const f = t * tl.fps;
  if (f < tl.introFrames) return "intro";
  return tl.scenes.find((s) => f >= s.from && f < s.from + s.durationInFrames)?.scene.id ?? "cierre";
}

/** Intervalos "clave_inicio: x … clave_fin: y" del registro de ffmpeg (`open`: uno que no terminó). */
const intervals = (log: string, startKey: string, endKey: string) => {
  const out: { start: number; end: number }[] = [];
  let start: number | undefined;
  for (const line of log.split("\n")) {
    const s = new RegExp(`${startKey}[:=]\\s*([\\d.]+)`).exec(line);
    if (s) start = Number(s[1]);
    const e = new RegExp(`${endKey}[:=]\\s*([\\d.]+)`).exec(line);
    if (e && start !== undefined) {
      out.push({ start, end: Number(e[1]) });
      start = undefined;
    }
  }
  return { out, open: start };
};

/** Lado de los cuadros reducidos que se analizan (escala de grises). */
const THUMB = 64;

/**
 * Analiza cada cuadro reducido a 64×64 en grises (el ffmpeg de Remotion no trae blackdetect/freezedetect):
 *  - pantalla negra en cualquier parte (salvo el primer y último medio segundo);
 *  - en escenas de pantalla, cuadros dominados por el fondo oscuro (el video del ERP no se dibujó);
 *  - parpadeos: 1–6 cuadros mucho más oscuros que los de antes y después;
 *  - imagen totalmente quieta más de 6 s.
 */
export function checkFrames(file: string, tl: Timeline, durationSec: number): Finding[] {
  const raw = ffmpegStdout(["-v", "error", "-i", file, "-an", "-vf", `scale=${THUMB}:${THUMB},format=gray`, "-c:v", "rawvideo", "-f", "image2pipe", "-"]);
  const size = THUMB * THUMB;
  const n = Math.floor(raw.length / size);
  const mean = new Float32Array(n);
  const dark = new Float32Array(n);
  const black = new Float32Array(n);
  const still = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * size;
    let sum = 0;
    let d = 0;
    let b = 0;
    let maxDiff = 0;
    for (let k = 0; k < size; k++) {
      const v = raw[o + k]!;
      sum += v;
      if (v < 50) d++;
      if (v < 24) b++;
      if (i > 0) maxDiff = Math.max(maxDiff, Math.abs(v - raw[o - size + k]!));
    }
    mean[i] = sum / size;
    dark[i] = d / size;
    black[i] = b / size;
    still[i] = i > 0 && maxDiff <= 2 ? 1 : 0;
  }

  const t = (i: number) => i / tl.fps;
  const edge = (i: number) => t(i) < 0.5 || t(i) > durationSec - 0.5;
  const isScreen = (i: number) => tl.scenes.some((s) => s.screen && i >= s.from && i < s.from + s.durationInFrames);
  const runs = (flag: (i: number) => boolean) => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (!flag(i)) continue;
      const a = i;
      while (i + 1 < n && flag(i + 1)) i++;
      out.push([a, i]);
    }
    return out;
  };
  const findings: Finding[] = [];
  const flagged = new Uint8Array(n);
  const report = ([a, b]: [number, number], what: string) => {
    const frames = b - a + 1;
    findings.push({ level: "error", check: "video", at: t(a), scene: sceneAt(tl, t(a)), message: `${what} (${frames} cuadro${frames > 1 ? "s" : ""}, ${(frames / tl.fps).toFixed(2)} s).` });
    flagged.fill(1, a, b + 1);
  };

  for (const r of runs((i) => black[i]! >= 0.98 && !edge(i))) report(r, "Pantalla negra");
  for (const r of runs((i) => !flagged[i] && isScreen(i) && dark[i]! >= 0.6)) report(r, "Se ve el fondo oscuro en vez de la grabación");
  // Parpadeo: tramo corto claramente más oscuro que los cuadros que lo rodean (que se parecen entre sí).
  for (let i = 1; i < n - 1; i++) {
    if (flagged[i] || edge(i)) continue;
    for (let len = 1; len <= 6 && i + len < n; len++) {
      const before = mean[i - 1]!;
      const after = mean[i + len]!;
      let allDark = true;
      for (let k = i; k < i + len; k++) if (mean[k]! > Math.min(before, after) - 40) allDark = false;
      if (allDark && Math.abs(before - after) < 25) {
        report([i, i + len - 1], "Parpadeo oscuro");
        i += len;
        break;
      }
    }
  }
  for (const [a, b] of runs((i) => !!still[i])) {
    const sec = (b - a + 2) / tl.fps;
    const scene = sceneAt(tl, t(a));
    if (sec < 6 || scene === "cierre" || scene === "intro") continue;
    findings.push({ level: "warning", check: "video", at: t(a - 1), scene, message: `Imagen totalmente quieta durante ${sec.toFixed(1)} s.` });
  }
  return findings;
}

export function checkVideo(file: string, tl: Timeline, format: Format): { findings: Finding[]; stats: Review["stats"] } {
  const findings: Finding[] = [];
  const probe = JSON.parse(runFf("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file])) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration: string };
  };
  const video = probe.streams.find((s) => s.codec_type === "video");
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const durationSec = Number(probe.format.duration);
  const stats: Review["stats"] = { durationSec, width: video?.width ?? 0, height: video?.height ?? 0 };
  const expected = tl.totalFrames / tl.fps;
  const [w, h] = DIMS[format];

  if (!video) return { findings: [{ level: "error", check: "video", message: "El archivo no tiene video." }], stats };
  if (Math.abs(durationSec - expected) > 0.2) {
    findings.push({ level: "error", check: "video", message: `Dura ${durationSec.toFixed(2)} s, pero el timeline dice ${expected.toFixed(2)} s.` });
  }
  if (video.width !== w || video.height !== h) {
    findings.push({ level: "error", check: "video", message: `Mide ${video.width}×${video.height}; para ${format} debería ser ${w}×${h}.` });
  }
  const voiced = tl.scenes.some((s) => s.audio || s.stepVoices?.length);
  if (!hasAudio && (voiced || tl.music)) findings.push({ level: "error", check: "audio", message: "El video no tiene pista de audio." });

  findings.push(...checkFrames(file, tl, durationSec));

  if (hasAudio) {
    // El ffmpeg de Remotion no trae volumedetect/ebur128: loudnorm mide la sonoridad (LUFS) y el pico real.
    const log = ffmpegLog(["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=n=-50dB:d=2.5,loudnorm=print_format=json", "-c:a", "pcm_s16le", "-f", "null", "-"]);
    const sil = intervals(log, "silence_start", "silence_end");
    if (sil.open !== undefined) sil.out.push({ start: sil.open, end: durationSec });
    for (const s of sil.out) {
      const scene = sceneAt(tl, s.start);
      if (scene === "intro" || scene === "cierre") continue;
      findings.push({ level: "warning", check: "audio", at: s.start, scene, message: `Silencio de ${(s.end - s.start).toFixed(1)} s.` });
    }
    const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(log);
    if (json) {
      const ln = JSON.parse(json[0]) as { input_i: string; input_tp: string };
      stats.loudnessLufs = Number(ln.input_i);
      stats.peakDb = Number(ln.input_tp);
    }
    if (stats.peakDb !== undefined && stats.peakDb > -0.5) findings.push({ level: "warning", check: "audio", message: `El audio llega a ${stats.peakDb} dBTP: puede saturar (distorsión).` });
    if (stats.loudnessLufs !== undefined && (stats.loudnessLufs < -20 || stats.loudnessLufs > -11)) {
      findings.push({
        level: "warning",
        check: "audio",
        message: `Sonoridad de ${stats.loudnessLufs} LUFS: para redes lo habitual es entre -16 y -14 (${stats.loudnessLufs < -20 ? "se escuchará bajo" : "se escuchará muy fuerte"}).`,
      });
    }
  }
  return { findings, stats };
}

// ── Revisión completa ───────────────────────────────────────────────────────

export const reviewPath = (renderFile: string) => renderFile.replace(/\.mp4$/, ".review.json");

export function reviewRender(job: Job, entry: Pick<RenderEntry, "file" | "format">, tl: Timeline): Review {
  const sb = job.readStoryboard();
  const plan = job.exists("recording-plan.json") ? job.readJson<RecordingPlan>("recording-plan.json") : undefined;
  const screen = job.exists("recordings/screen-text.json") ? job.readJson<ScreenTexts>("recordings/screen-text.json") : undefined;
  const video = checkVideo(job.path(entry.file), tl, entry.format as Format);
  const order = { error: 0, warning: 1, info: 2 };
  const findings = [...(plan ? checkScript(sb, plan, tl, screen) : []), ...checkTimeline(tl), ...video.findings].sort(
    (a, b) => order[a.level] - order[b.level] || (a.at ?? Infinity) - (b.at ?? Infinity),
  );
  const review: Review = { createdAt: new Date().toISOString(), file: entry.file, format: entry.format as Format, findings, stats: video.stats };
  job.writeJson(reviewPath(entry.file), review);
  return review;
}

export const summarize = (r: Pick<Review, "findings">) => ({
  errors: r.findings.filter((f) => f.level === "error").length,
  warnings: r.findings.filter((f) => f.level === "warning").length,
});

/** Revisa un render del job y guarda el resumen en su entrada del manifest. */
export function reviewEntry(job: Job, entry: RenderEntry, tl: Timeline): Review {
  const review = reviewRender(job, entry, tl);
  entry.review = { ...summarize(review), createdAt: review.createdAt };
  job.save();
  return review;
}

/** Revisa todos los formatos de la última versión renderizada. */
export function reviewLatest(job: Job): Review[] {
  const last = job.manifest.renders.reduce((a, r) => Math.max(a, r.version), 0);
  const tl = job.readJson<Timeline>("timeline.json");
  return job.manifest.renders.filter((r) => r.version === last && job.exists(r.file)).map((r) => reviewEntry(job, r, tl));
}
