import { mkdirSync, writeFileSync } from "node:fs";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";
import { env } from "../config";
import { erpNotesBlock } from "../knowledge";
import type { Job } from "../jobs/store";
import { log, redact } from "../log";
import { Action, LocatorSpec, type PlanStep, type RecordingPlan } from "../schemas/recording-plan";
import type { ScreenScene, Storyboard } from "../schemas/storyboard";
import { VIEWPORT, assertTestEnvironment, describeSpec, erpTarget, installGuard, launchBrowser, login, resolve } from "./erp/browser";
import { Executor } from "./erp/executor";

const sample = process.env.ERP_SAMPLE_CUSTOMER ?? "";
const SYSTEM_PROMPT = `Eres un agente que explora el ERP Integrator (entorno web de PRUEBA) para descubrir cómo completar pasos de un tutorial y dejar un "recording plan" que luego se grabará sin IA.

Reglas de seguridad (obligatorias):
- Ya iniciaste sesión en la empresa de prueba. Nunca cambies de empresa, ni de usuario, ni cierres sesión.
- No entres a Sistemas, usuarios, permisos ni configuración general, salvo que el paso lo pida explícitamente.
- No elimines, anules ni modifiques registros existentes. Solo crea lo que el tutorial necesita.
${
  sample
    ? `- Cliente: usa EXCLUSIVAMENTE el cliente "${sample}" (búscalo escribiendo ese texto/RUC en el campo Cliente). Si no aparece, llama report_blocked; no elijas otro.`
    : `- El video será público: no muestres datos de personas reales. Para el cliente, busca uno genérico o de prueba (p. ej. "CLIENTES VARIOS", "DEMO", "PRUEBA"). Si solo hay clientes con nombre de persona o empresa real, llama report_blocked pidiendo que se cree un cliente de prueba.`
}
- Representante de Venta (o vendedor): elige el primero de la lista. No crees representantes ni otros datos maestros.
- Usa productos y almacenes que ya existan en el entorno de prueba. Si debes escribir datos nuevos, usa valores ficticios evidentes (p. ej. "Cliente Demo", RUC 20000000001).
- Solo puedes navegar dentro del ERP; las herramientas bloquean cualquier otro dominio.
- Si no logras completar un paso tras intentos razonables, llama report_blocked explicando exactamente dónde te trabaste y detente.

Método de trabajo:
- Usa snapshot (árbol de accesibilidad) para leer la página; screenshot solo cuando el árbol no alcance.
- Selectores: prefiere {role, name} (p. ej. role "button", name "Guardar"), luego label, placeholder o text. Usa css solo como último recurso. Si hay varias coincidencias, usa "within" o "nth".
- Cada acción exitosa (click, fill, select, press, wait, goto) queda registrada como pendiente. Cuando el objetivo de un paso se cumpla, llama commit_step con su id y el elemento a resaltar: esas acciones pasan al plan.
- El plan se re-ejecutará tal cual desde el inicio de sesión y se verá en el video: no debe incluir búsquedas fallidas ni clics de prueba. Si exploraste de más, pasa en commit_step la lista limpia de acciones (se verifica sola) o usa restart y repite solo lo necesario.
- Asegúrate de que cada paso deja el formulario en un estado válido para los siguientes (campos obligatorios como "Representante de Venta", tipo de documento del cliente compatible con el comprobante, etc.).
- Cumple el objetivo de la escena de verdad, aunque los pasos no lo digan: si agregas una línea, confírmala (botón "Agregar", Enter) y comprueba que aparece en la tabla. Si el ERP muestra otro nombre para un botón del tutorial (p. ej. "Actualizar" en vez de "Grabar y Continuar" porque el documento ya se registró), usa el equivalente.
- Después de elegir una opción en un combo, comprueba que el desplegable se cerró antes de escribir en otro campo.
- Al terminar cada escena, el plan se re-ejecuta de corrido desde cero y se te pide revisar el resultado. Si una escena anterior dejó un estado que no sirve, llama report_blocked con previousScene: true explicando qué debe corregirse allí.
- Para esperar a que algo aparezca, agrega una acción wait con el elemento esperado; no uses esperas fijas largas. En buscadores/autocompletar, después de escribir agrega un wait de la opción esperada y luego haz clic en ella (la grabación escribe más lento que tú).
- Evita selectores css por posición (p. ej. "primera fila"); identifica filas por su texto (número de documento, cliente).
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
  /** El agente culpa a la escena anterior del bloqueo (su estado final no sirve). */
  let blamePrevious = false;
  let currentScene: ScreenScene | undefined;
  /** La escena pasó la revisión tras re-ejecutar el plan; `dirty` = hubo cambios desde esa re-ejecución. */
  let verified = false;
  let dirty = true;
  let shot = 0;

  const dropScenes = (ids: string[]) => {
    for (let i = committed.length - 1; i >= 0; i--) if (ids.includes(committed[i]!.sceneId)) committed.splice(i, 1);
  };

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
        {
          stepId: z.string(),
          highlight: (LocatorSpec as z.ZodType<LocatorSpec>).optional().describe("Elemento que nombra el callout del paso, visible al terminarlo. Indícalo cuando el último clic del paso no sea sobre ese elemento (p. ej. callout «Cliente» y el paso termina eligiendo una fecha: resalta el campo Cliente). Si el paso termina con un clic en el elemento del callout, no hace falta."),
          actions: z
            .array(Action)
            .optional()
            .describe("Opcional: lista final y limpia de acciones del paso (sin búsquedas fallidas ni clics de prueba). Se verifica re-ejecutándola desde el último paso confirmado."),
        },
        async (a) => {
          const step = currentScene?.steps.find((st) => st.id === a.stepId);
          if (!currentScene || !step) return text(`El paso ${a.stepId} no pertenece a la escena actual.`);
          if (committed.some((c) => c.step.id === a.stepId && c.sceneId === currentScene!.id)) return text(`El paso ${a.stepId} ya estaba confirmado.`);
          if (a.actions) {
            // Verifica la versión limpia desde cero antes de aceptarla.
            await s.context.close();
            s = await newSession();
            pending = [];
            for (const [i, action] of a.actions.entries()) {
              try {
                await s.exec.run(action);
                await assertTestEnvironment(s.page);
              } catch (e) {
                return text(`La lista limpia falló en la acción ${i + 1} (${action.type}): ${(e as Error).message.split("\n")[0]}. El navegador quedó en ese punto; corrige y vuelve a intentar.`);
              }
              pending.push(action);
            }
          }
          if (a.highlight) {
            const visible = await resolve(s.page, a.highlight).first().isVisible().catch(() => false);
            if (!visible) return text(`El elemento a resaltar (${describeSpec(a.highlight)}) no está visible ahora. Elige otro o no lo indiques.`);
          }
          committed.push({ sceneId: currentScene.id, step: { id: step.id, objective: step.objective, callout: step.callout, actions: pending, highlight: a.highlight } });
          onProgress(`${currentScene.id}/${step.id}: ${pending.length} acción(es) confirmadas`);
          pending = [];
          dirty = true;
          return text(`Paso ${a.stepId} confirmado.`);
        },
      ),
      tool("restart", "Descarta las acciones pendientes y vuelve a iniciar desde el último paso confirmado.", {}, async () => {
        await s.context.close();
        pending = [];
        s = await newSession();
        return text(`Reiniciado. URL: ${s.page.url()}`);
      }),
      tool("reset_scene", "Descarta todos los pasos confirmados de la escena actual y vuelve al estado en que empezó, para rehacerlos.", {}, async () => {
        if (!currentScene) return text("No hay escena en curso.");
        dropScenes([currentScene.id]);
        await s.context.close();
        pending = [];
        dirty = true;
        s = await newSession();
        return text(`Escena ${currentScene.id} reiniciada: vuelve a confirmar sus pasos. URL: ${s.page.url()}`);
      }),
      tool("scene_ok", "Tras la re-ejecución del plan, confirma que el estado final cumple el objetivo de la escena y sirve para la siguiente.", {}, async () => {
        if (dirty) return text("Hubo cambios desde la última re-ejecución: termina tu turno y el plan se volverá a verificar.");
        verified = true;
        return text("Escena verificada. Termina ahora.");
      }),
      tool(
        "report_blocked",
        "Informa que no se puede completar un paso. Después de llamarla, termina.",
        {
          stepId: z.string(),
          reason: z.string(),
          previousScene: z.boolean().optional().describe("true si el problema es el estado que dejó la escena anterior (en reason, explica qué debe corregirse allí)"),
        },
        async (a) => {
          const file = `explore/blocked-${a.stepId}.jpg`;
          writeFileSync(job.path(file), await s.page.screenshot({ type: "jpeg", quality: 70 }));
          blocked = { sceneId: currentScene?.id ?? "?", stepId: a.stepId, reason: a.reason, screenshot: file };
          blamePrevious = a.previousScene === true;
          return text("Registrado. Termina ahora.");
        },
      ),
    ],
  });

  const transcript: unknown[] = [];
  /** Corre (o retoma, con `resume`) la conversación del agente; devuelve el id de sesión para retomarla. */
  const runAgent = async (prompt: string, resume?: string) => {
    let sessionId = resume;
    const messages = query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT + erpNotesBlock(),
        model: env.CLAUDE_EXPLORER_MODEL ?? env.CLAUDE_MODEL,
        tools: [],
        mcpServers: { erp: server },
        allowedTools: ["mcp__erp__*"],
        permissionMode: "dontAsk",
        settingSources: [],
        maxTurns: 120,
        resume,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "integrator-video-studio/0.1" },
      },
    });
    for await (const msg of messages) {
      sessionId = msg.session_id ?? sessionId;
      if (msg.type === "assistant") {
        transcript.push({ role: "assistant", content: msg.message.content });
        for (const b of msg.message.content) {
          if (b.type === "tool_use") log.info(`  · ${b.name.replace("mcp__erp__", "")} ${redact(JSON.stringify(b.input)).slice(0, 140)}`);
        }
      } else if (msg.type === "result") {
        transcript.push({ result: msg.subtype, cost_usd: msg.total_cost_usd, turns: msg.num_turns });
      }
    }
    return sessionId;
  };
  const missingSteps = (scene: ScreenScene) => {
    const done = new Set(committed.filter((c) => c.sceneId === scene.id).map((c) => c.step.id));
    return scene.steps.filter((st) => !done.has(st.id));
  };

  /** Correcciones que pidió la escena siguiente, por escena. Cada escena se rehace como máximo una vez por esto. */
  const fixes = new Map<string, string>();
  try {
    for (let i = 0; i < screens.length; ) {
      const scene = screens[i]!;
      currentScene = scene;
      onProgress(`${scene.id}: explorando "${scene.goal}"`);
      const fix = fixes.get(scene.id);
      const prompt = [
        `Escena: ${scene.id}`,
        `Objetivo: ${scene.goal}`,
        `Pasos a completar, en orden (usa estos ids en commit_step):`,
        ...scene.steps.map((st) => `- ${st.id}: ${st.objective} (callout del video: «${st.callout}»)`),
        ...(fix ? ["", `IMPORTANTE: esta escena ya se exploró una vez, pero la escena siguiente no pudo continuar por el estado que dejó. Motivo: ${fix}`] : []),
        "",
        "Parte del estado actual del navegador (sesión iniciada, pasos anteriores ya ejecutados). Confirma cada paso con commit_step.",
      ].join("\n");
      dirty = true;
      verified = false;
      let sessionId = await runAgent(prompt);

      // Verificación: re-ejecutar el plan de corrido desde cero (como la grabación) y que el agente revise el resultado.
      for (let round = 0; round < 3 && !blocked && !verified && !missingSteps(scene).length; round++) {
        onProgress(`${scene.id}: verificando el plan desde cero`);
        await s.context.close();
        pending = [];
        s = await newSession();
        dirty = false;
        sessionId = await runAgent(
          [
            `Re-ejecuté el plan completo desde el inicio de sesión, de corrido, como se hará en la grabación. El navegador quedó al final de la escena ${scene.id}.`,
            `Revisa con snapshot/screenshot que el estado cumple el objetivo ("${scene.goal}") y sirve para la escena siguiente (campos con los valores esperados, desplegables cerrados, líneas agregadas a la tabla, sin mensajes de error).`,
            "- Si está bien, llama scene_ok y termina.",
            "- Si no, llama reset_scene, rehaz los pasos de esta escena corrigiendo el problema (commit_step) y termina: se volverá a verificar.",
          ].join("\n"),
          sessionId,
        );
      }

      if (blocked && blamePrevious && i > 0 && !fixes.has(screens[i - 1]!.id)) {
        // La escena anterior dejó un estado inservible: se rehace con el motivo y luego se reintenta esta.
        const prev = screens[i - 1]!;
        onProgress(`${scene.id}: la escena anterior dejó un estado que no sirve; se rehace ${prev.id}`);
        fixes.set(prev.id, blocked.reason);
        dropScenes([prev.id, scene.id]);
        blocked = undefined;
        blamePrevious = false;
        await s.context.close();
        pending = [];
        s = await newSession();
        i--;
        continue;
      }
      if (blocked) break;
      const missing = missingSteps(scene);
      if (missing.length) {
        blocked = { sceneId: scene.id, stepId: missing[0]!.id, reason: `El agente terminó sin confirmar: ${missing.map((m) => m.id).join(", ")}` };
        break;
      }
      if (!verified) {
        blocked = { sceneId: scene.id, stepId: scene.steps.at(-1)!.id, reason: "Al re-ejecutar el plan desde cero, el agente no confirmó que la escena quedara bien (scene_ok)." };
        break;
      }
      i++;
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
