import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { Job } from "../jobs/store";
import { mediaDuration, runFf } from "../media";
import type { RecordedStep, Recording, RecordingPlan } from "../schemas/recording-plan";
import { VIEWPORT, assertTestEnvironment, erpTarget, installGuard, launchBrowser, login, resolve } from "./erp/browser";
import { CURSOR_SCRIPT, Executor } from "./erp/executor";
import { stepKey } from "./compose";
import type { ScreenTexts } from "./review";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pausa al final de cada paso con el resultado visible (ahí se muestra el resaltado). */
const HOLD_SEC = 1.0;

/**
 * Ejecuta el recording plan sin IA y graba la pantalla (screencast de Chrome, JPEG de alta calidad) a 1920x1080.
 * Mismo plan + misma semilla ⇒ misma secuencia de acciones, tipeo y pausas.
 */
export async function record(job: Job, plan: RecordingPlan, onProgress: (m: string) => void): Promise<Recording> {
  if (plan.blocked) throw new Error(`El recording plan está bloqueado en ${plan.blocked.stepId}: ${plan.blocked.reason}`);
  const target = erpTarget();
  if (plan.erpHost !== target.host) throw new Error(`El plan es de ${plan.erpHost}, pero ERP_URL apunta a ${target.host}.`);

  const framesDir = job.path("recordings/frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const browser = await launchBrowser();
  const frames: { file: string; t: number }[] = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "es-PE" });
    const blocked: string[] = [];
    await installGuard(context, target, (u) => blocked.push(u));
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    onProgress("iniciando sesión (fuera de cámara)");
    await login(page, target);
    await page.evaluate(CURSOR_SCRIPT);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);

    // ── Screencast ──────────────────────────────────────────────────────────
    const cdp = await context.newCDPSession(page);
    let n = 0;
    cdp.on("Page.screencastFrame", async (f) => {
      const file = path.join(framesDir, `${String(++n).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
    // Fuerza repintados periódicos para que siempre haya fotogramas recientes.
    await page.evaluate(() => {
      const d = document.createElement("div");
      Object.assign(d.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", zIndex: "2147483647", pointerEvents: "none" });
      document.body.appendChild(d);
      let on = false;
      setInterval(() => {
        on = !on;
        d.style.opacity = on ? "0.011" : "0.01";
      }, 33);
    });
    await sleep(800);
    const t0 = Date.now() / 1000;
    const now = () => Date.now() / 1000 - t0;

    const steps: RecordedStep[] = [];
    /** Textos visibles al empezar y al terminar cada paso: la revisión compara con ellos la narración y los callouts. */
    const screenTexts: ScreenTexts = {};
    const loading: { start: number; end: number }[] = [];
    const scenes: Recording["scenes"] = [];
    let current: RecordedStep | undefined;
    const exec = new Executor(page, {
      cinematic: true,
      seed: 20260926,
      onClick: (x, y) => current?.clicks.push({ t: now(), x, y }),
      onFocus: (box) => current?.focus.push({ t: now(), box }),
      onBusy: (a, b) => loading.push({ start: a / 1000 - t0, end: b / 1000 - t0 }),
      onEmphasis: (box, start) => {
        if (!current) return;
        if (start) current.highlights.push({ start: now(), end: now(), box });
        else current.highlights.at(-1)!.end = now();
      },
    });

    for (const scene of plan.scenes) {
      const sceneStart = now();
      for (const step of scene.steps) {
        onProgress(`${scene.sceneId}/${step.id}: ${step.objective}`);
        current = { sceneId: scene.sceneId, stepId: step.id, callout: step.callout, start: now(), end: 0, clicks: [], focus: [], highlights: [] };
        // El último clic/selección del paso es el "clave": se resalta antes de hacerlo.
        const keyIdx = step.actions.map((a) => a.type).lastIndexOf("click") >= step.actions.map((a) => a.type).lastIndexOf("select")
          ? step.actions.map((a) => a.type).lastIndexOf("click")
          : step.actions.map((a) => a.type).lastIndexOf("select");
        const lastIsKey = keyIdx >= 0 && step.actions.slice(keyIdx + 1).every((a) => a.type === "wait");
        const textBefore = await visibleText(page);
        for (const [i, action] of step.actions.entries()) {
          try {
            await exec.run(action, lastIsKey && i === keyIdx);
          } catch (e) {
            const shot = `recordings/error-${step.id}.jpg`;
            writeFileSync(job.path(shot), await page.screenshot({ type: "jpeg", quality: 70 }));
            throw new Error(`La grabación falló en ${scene.sceneId}/${step.id}, acción ${i + 1} (${action.type}): ${(e as Error).message.split("\n")[0]} (captura: ${shot}). Si la interfaz cambió, vuelve a explorar.`);
          }
        }
        await assertTestEnvironment(page);
        screenTexts[stepKey(scene.sceneId, step.id)] = `${textBefore}\n${await visibleText(page)}`;
        if (blocked.length) throw new Error(`Navegación bloqueada fuera del ERP: ${blocked[0]}`);
        await sleep(300);
        // Si el paso termina escribiendo (no en un clic), se resalta el resultado durante la pausa final.
        const box = !lastIsKey && step.highlight ? await exec.box(resolve(page, step.highlight).first()).catch(() => undefined) : undefined;
        const holdStart = now();
        await sleep(HOLD_SEC * 1000);
        if (box) current.highlights.push({ start: holdStart, end: now(), box });
        current.end = now();
        steps.push(current);
      }
      scenes.push({ sceneId: scene.sceneId, start: sceneStart, end: now() });
    }
    job.writeJson("recordings/screen-text.json", screenTexts);
    await sleep(600);
    await cdp.send("Page.stopScreencast");
    await sleep(200);
    const tEnd = Date.now() / 1000;

    // ── Ensamblar a MP4 (CFR 30 fps) ────────────────────────────────────────
    onProgress(`ensamblando ${frames.length} fotogramas`);
    const usable = frames.filter((f) => f.t >= t0 - 0.2).sort((a, b) => a.t - b.t);
    if (usable.length < 2) throw new Error("La grabación no produjo fotogramas.");
    const lines: string[] = [];
    usable.forEach((f, i) => {
      const next = usable[i + 1]?.t ?? tEnd;
      const start = i === 0 ? t0 : f.t;
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - start).toFixed(4)}`);
    });
    lines.push(`file '${usable.at(-1)!.file}'`);
    const list = job.path("recordings/frames.txt");
    writeFileSync(list, lines.join("\n"));
    const out = job.path("recordings/tutorial.mp4");
    runFf("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-r", "30", "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", out]);
    rmSync(framesDir, { recursive: true, force: true });
    rmSync(list, { force: true });

    return {
      file: "recordings/tutorial.mp4",
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      durationSec: mediaDuration(out),
      scenes,
      steps,
      loading,
    };
  } finally {
    await browser.close();
  }
}

/** Texto visible de la página más etiquetas que no son texto (placeholder, aria-label, title, valores de campos). */
export async function visibleText(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const extra = [...document.querySelectorAll<HTMLElement>("[placeholder],[aria-label],[title],input,textarea,select")]
        .filter((el) => el.offsetParent !== null)
        .flatMap((el) => [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("title"), (el as HTMLInputElement).value])
        .filter((v): v is string => !!v && v.length < 200);
      return `${document.body.innerText}\n${extra.join("\n")}`.slice(0, 40000);
    })
    .catch(() => "");
}
