import { mkdirSync, writeFileSync } from "node:fs";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";
import { env } from "../config";
import type { Job } from "../jobs/store";
import { log, redact } from "../log";
import { Action, LocatorSpec, type PlanStep, type RecordingPlan } from "../schemas/recording-plan";
import type { ScreenScene, Storyboard } from "../schemas/storyboard";
import { VIEWPORT, assertTestEnvironment, describeSpec, erpTarget, installGuard, launchBrowser, login, resolve } from "./erp/browser";
import { Executor } from "./erp/executor";

const sample = process.env.ERP_SAMPLE_CUSTOMER ? `, o exactamente "${process.env.ERP_SAMPLE_CUSTOMER}"` : "";
const SYSTEM_PROMPT = `Eres un agente que explora el ERP Integrator (entorno web de PRUEBA) para descubrir cómo completar pasos de un tutorial y dejar un "recording plan" que luego se grabará sin IA.

Reglas de seguridad (obligatorias):
- Ya iniciaste sesión en la empresa de prueba. Nunca cambies de empresa, ni de usuario, ni cierres sesión.
- No entres a Sistemas, usuarios, permisos ni configuración general, salvo que el paso lo pida explícitamente.
- No elimines, anules ni modifiques registros existentes. Solo crea lo que el tutorial necesita.
- El video será público: no muestres datos de personas reales. Para el cliente, busca primero uno genérico o de prueba (p. ej. "CLIENTES VARIOS", "DEMO", "PRUEBA"${sample}). Si solo hay clientes con nombre de persona o empresa real, llama report_blocked pidiendo que se cree un cliente de prueba.
- Usa productos y almacenes que ya existan en el entorno de prueba. Si debes escribir datos nuevos, usa valores ficticios evidentes (p. ej. "Cliente Demo", RUC 20000000001).
- Solo puedes navegar dentro del ERP; las herramientas bloquean cualquier otro dominio.
- Si no logras completar un paso tras intentos razonables, llama report_blocked explicando exactamente dónde te trabaste y detente.

Método de trabajo:
- Usa snapshot (árbol de accesibilidad) para leer la página; screenshot solo cuando el árbol no alcance.
- Selectores: prefiere {role, name} (p. ej. role "button", name "Guardar"), luego label, placeholder o text. Usa css solo como último recurso. Si hay varias coincidencias, usa "within" o "nth".
- Cada acción exitosa (click, fill, select, press, wait, goto) queda registrada como pendiente. Cuando el objetivo de un paso se cumpla, llama commit_step con su id y el elemento a resaltar: esas acciones pasan al plan.
- El plan se re-ejecutará tal cual desde el inicio de sesión: evita clics de exploración innecesarios. Si te desviaste, llama restart (vuelve al estado del último paso confirmado) y repite solo lo necesario.
- Para esperar a que algo aparezca, agrega una acción wait con el elemento esperado; no uses esperas fijas largas.
- Sé eficiente: no describas cada acción, simplemente ejecútalas.`;

const text = (t: string) => ({ content: [{ type: "text" as const, text: redact(t) }] });

interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  exec: Executor;
}

/**
 * Explora el ERP con el Claude Agent SDK para las escenas "screen" del storyboard y devuelve el recording plan.
 * Si el agente se traba, el plan incluye `blocked` con el motivo y una captura.
 */
export async function explore(job: Job, sb: Storyboard, onProgress: (m: string) => void): Promise<RecordingPlan> {
  const target = erpTarget();
  const screens = sb.scenes.filter((s): s is ScreenScene => s.type === "screen");
  mkdirSync(job.path("explore"), { recursive: true });
  const browser = await launchBrowser();
  const blockedUrls: string[] = [];

  const committed: { sceneId: string; step: PlanStep }[] = [];
  let pending: Action[] = [];
  let blocked: RecordingPlan["blocked"];
  let currentScene: ScreenScene | undefined;
  let shot = 0;

  const newSession = async (): Promise<Session> => {
    const context = await browser.newContext({ viewport: VIEWPORT, locale: "es-PE" });
    await installGuard(context, target, (u) => blockedUrls.push(u));
    const page = await context.newPage();
    await login(page, target);
    const exec = new Executor(page, { cinematic: false });
    for (const c of committed) for (const a of c.step.actions) await exec.run(a);
    return { browser, context, page, exec };
  };

  let s = await newSession();

  const act = async (a: Action) => {
    const parsed = Action.safeParse(a);
    if (!parsed.success) return text(`Acción inválida: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const before = blockedUrls.length;
    try {
      await s.exec.run(parsed.data);
      await assertTestEnvironment(s.page);
    } catch (e) {
      const extra = blockedUrls.length > before ? ` (navegación bloqueada: ${blockedUrls.at(-1)})` : "";
      return text(`Error: ${(e as Error).message.split("\n")[0]}${extra}`);
    }
    pending.push(parsed.data);
    return text(`OK. URL: ${s.page.url()}. Acciones pendientes: ${pending.length}.`);
  };

  const Target = { target: LocatorSpec as z.ZodType<LocatorSpec> };
  const server = createSdkMcpServer({
    name: "erp",
    version: "1.0.0",
    tools: [
      tool("snapshot", "Árbol de accesibilidad de la página actual (roles y nombres accesibles) y su URL.", {}, async () => {
        const tree = await s.page.locator("body").ariaSnapshot({ timeout: 10000 }).catch((e) => `(sin árbol: ${e.message})`);
        return text(`URL: ${s.page.url()}\n${tree.length > 14000 ? tree.slice(0, 14000) + "\n…(recortado)" : tree}`);
      }),
      tool("screenshot", "Captura de pantalla de la página actual.", {}, async () => {
        const buf = await s.page.screenshot({ type: "jpeg", quality: 55 });
        const file = job.path(`explore/shot-${String(++shot).padStart(3, "0")}.jpg`);
        writeFileSync(file, buf);
        return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/jpeg" }] };
      }),
      tool("goto", "Navega a una ruta del ERP (solo dentro del dominio permitido).", { path: z.string() }, (a) => act({ type: "goto", path: a.path })),
      tool("click", "Hace clic en un elemento.", Target, (a) => act({ type: "click", target: a.target })),
      tool("fill", "Escribe un valor en un campo (reemplaza el contenido).", { ...Target, value: z.string() }, (a) =>
        act({ type: "fill", target: a.target, value: a.value }),
      ),
      tool("select", "Elige una opción de un combo/desplegable (nativo o personalizado).", { ...Target, option: z.string() }, (a) =>
        act({ type: "select", target: a.target, option: a.option }),
      ),
      tool("press", "Presiona una tecla (p. ej. Enter, Tab, ArrowDown), opcionalmente sobre un elemento.", { key: z.string(), target: (LocatorSpec as z.ZodType<LocatorSpec>).optional() }, (a) =>
        act({ type: "press", key: a.key, target: a.target }),
      ),
      tool("wait", "Espera a que un elemento sea visible (preferido) o un número de milisegundos.", { target: (LocatorSpec as z.ZodType<LocatorSpec>).optional(), ms: z.number().optional() }, (a) =>
        act({ type: "wait", target: a.target, ms: a.ms }),
      ),
      tool(
        "commit_step",
        "Confirma que el paso indicado quedó completo: las acciones pendientes pasan a ese paso del plan.",
        { stepId: z.string(), highlight: (LocatorSpec as z.ZodType<LocatorSpec>).optional().describe("Elemento a resaltar en el video para este paso") },
        async (a) => {
          const step = currentScene?.steps.find((st) => st.id === a.stepId);
          if (!currentScene || !step) return text(`El paso ${a.stepId} no pertenece a la escena actual.`);
          if (committed.some((c) => c.step.id === a.stepId && c.sceneId === currentScene!.id)) return text(`El paso ${a.stepId} ya estaba confirmado.`);
          if (a.highlight) {
            const visible = await resolve(s.page, a.highlight).first().isVisible().catch(() => false);
            if (!visible) return text(`El elemento a resaltar (${describeSpec(a.highlight)}) no está visible ahora. Elige otro o no lo indiques.`);
          }
          committed.push({ sceneId: currentScene.id, step: { id: step.id, objective: step.objective, callout: step.callout, actions: pending, highlight: a.highlight } });
          onProgress(`${currentScene.id}/${step.id}: ${pending.length} acción(es) confirmadas`);
          pending = [];
          return text(`Paso ${a.stepId} confirmado.`);
        },
      ),
      tool("restart", "Descarta las acciones pendientes y vuelve a iniciar desde el último paso confirmado.", {}, async () => {
        await s.context.close();
        pending = [];
        s = await newSession();
        return text(`Reiniciado. URL: ${s.page.url()}`);
      }),
      tool("report_blocked", "Informa que no se puede completar un paso. Después de llamarla, termina.", { stepId: z.string(), reason: z.string() }, async (a) => {
        const file = `explore/blocked-${a.stepId}.jpg`;
        writeFileSync(job.path(file), await s.page.screenshot({ type: "jpeg", quality: 70 }));
        blocked = { sceneId: currentScene?.id ?? "?", stepId: a.stepId, reason: a.reason, screenshot: file };
        return text("Registrado. Termina ahora.");
      }),
    ],
  });

  const transcript: unknown[] = [];
  try {
    for (const scene of screens) {
      currentScene = scene;
      onProgress(`${scene.id}: explorando "${scene.goal}"`);
      const prompt = [
        `Escena: ${scene.id}`,
        `Objetivo: ${scene.goal}`,
        `Pasos a completar, en orden (usa estos ids en commit_step):`,
        ...scene.steps.map((st) => `- ${st.id}: ${st.objective}`),
        "",
        "Parte del estado actual del navegador (sesión iniciada, pasos anteriores ya ejecutados). Confirma cada paso con commit_step.",
      ].join("\n");
      const messages = query({
        prompt,
        options: {
          systemPrompt: SYSTEM_PROMPT,
          model: env.CLAUDE_EXPLORER_MODEL ?? env.CLAUDE_MODEL,
          tools: [],
          mcpServers: { erp: server },
          allowedTools: ["mcp__erp__*"],
          permissionMode: "dontAsk",
          settingSources: [],
          maxTurns: 120,
          env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "integrator-video-studio/0.1" },
        },
      });
      for await (const msg of messages) {
        if (msg.type === "assistant") {
          transcript.push({ role: "assistant", content: msg.message.content });
          for (const b of msg.message.content) {
            if (b.type === "tool_use") log.info(`  · ${b.name.replace("mcp__erp__", "")} ${redact(JSON.stringify(b.input)).slice(0, 140)}`);
          }
        } else if (msg.type === "result") {
          transcript.push({ result: msg.subtype, cost_usd: msg.total_cost_usd, turns: msg.num_turns });
        }
      }
      if (blocked) break;
      const done = new Set(committed.filter((c) => c.sceneId === scene.id).map((c) => c.step.id));
      const missing = scene.steps.filter((st) => !done.has(st.id));
      if (missing.length) {
        blocked = { sceneId: scene.id, stepId: missing[0]!.id, reason: `El agente terminó sin confirmar: ${missing.map((m) => m.id).join(", ")}` };
        break;
      }
    }
  } finally {
    job.writeJson("logs/explore.transcript.json", transcript);
    await browser.close();
  }

  return {
    erpHost: target.host,
    company: target.company,
    createdAt: new Date().toISOString(),
    scenes: screens.map((sc) => ({ sceneId: sc.id, steps: committed.filter((c) => c.sceneId === sc.id).map((c) => c.step) })),
    blocked,
  };
}
