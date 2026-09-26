import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { env } from "../config";
import { log, redact } from "../log";
import type { ParsedRequest } from "../request";
import { INTRO_SEC, OUTRO_SEC, Storyboard, checkStoryboard } from "../schemas/storyboard";
import { TEMPLATE_DOCS, TEMPLATE_IDS } from "../schemas/templates";

const MANUALS = "https://manuales.integrator.pe";
const SOURCE_DOMAINS = ["manuales.integrator.pe", "integrator.pe"];

export const SYSTEM_PROMPT = `Eres guionista de videos de producto para Integrator (https://integrator.pe), un ERP peruano para empresas comerciales e industriales: ventas, producción, almacenes, tesorería, contabilidad, facturación electrónica SUNAT, detracciones, percepciones y guías de remisión. Los manuales oficiales están en ${MANUALS}.

Escribes storyboards para videos cortos dirigidos a gerentes, contadores y jefes de operaciones de empresas peruanas.

Estilo:
- Español latino neutro, tuteo, frases cortas y concretas. Nada de clichés vacíos.
- Narración natural para locución: ~2,5 palabras por segundo. estDurationSec de cada escena >= (palabras de la narración / 2,5) + 0,8.
- onScreenText es corto (máx. ~60 caracteres) y complementa la voz, no la repite palabra por palabra.

Estructura:
- La intro de marca (${INTRO_SEC} s) y el cierre con CTA (${OUTRO_SEC} s) se agregan automáticamente: NO los incluyas como escenas ni menciones el WhatsApp.
- La suma de estDurationSec debe ser ≈ targetDurationSec − ${INTRO_SEC + OUTRO_SEC} s.
- Promo: solo escenas "motion" (salvo que el pedido pida mostrar el sistema). 30 s ≈ 4-6 escenas. Empieza con un gancho y termina con un remate que conecte con el CTA.
- Tutorial: una escena kinetic-title que diga qué se va a lograr, luego escenas "screen" (una por tarea de la interfaz, con steps que describen cada objetivo en el ERP usando los nombres reales de menús y botones del manual) y una checklist final de resumen. Consulta el manual correspondiente antes de escribir los pasos y lista las URLs usadas en "sources".

Veracidad:
- No inventes precios, cantidad de clientes, porcentajes ni promesas sobre Integrator que no estén en el pedido o en las fuentes consultadas.
- Si una fuente no se pudo leer, no afirmes qué incluye el servicio, qué cuesta ni cómo se cobra: usa mensajes que no dependan de esos datos.
- Los valores de dashboards y ejemplos son datos ilustrativos de una empresa ficticia; que se vean realistas (soles, S/).

Plantillas motion disponibles (campo "template"):
${TEMPLATE_IDS.map((id) => `- ${id}: ${TEMPLATE_DOCS[id]}`).join("\n")}

Ids de escena: kebab-case, prefijados con el orden ("s1-gancho", "s2-...").
Solo puedes consultar ${SOURCE_DOMAINS.join(" y ")}. No uses ninguna otra herramienta.`;

function userPrompt(req: ParsedRequest): string {
  const duration = req.durationSec ?? (req.kind === "promo" ? 30 : 75);
  return [
    `Pedido original: "${req.raw}"`,
    `Tipo: ${req.kind}`,
    `Tema: ${req.topic}`,
    `Duración total objetivo: ${duration} s`,
    `Formatos: ${req.formats.join(", ")}`,
    req.kind === "tutorial"
      ? `Busca en ${MANUALS} la página que explica esta tarea y úsala como fuente para los pasos.`
      : `Si te ayuda a ser preciso sobre funcionalidades, puedes consultar ${MANUALS}.`,
    "Devuelve el storyboard completo.",
  ].join("\n");
}

/** Una consulta al Claude Agent SDK con salida estructurada. Solo búsqueda web / fetch en los dominios permitidos. */
async function ask(prompt: string, transcript: unknown[]): Promise<unknown> {
  const messages = query({
    prompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: env.CLAUDE_MODEL,
      tools: ["WebSearch", "WebFetch"],
      allowedTools: ["WebSearch", ...SOURCE_DOMAINS.map((d) => `WebFetch(domain:${d})`)],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 25,
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(Storyboard, { target: "draft-7" }) as Record<string, unknown> },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "integrator-video-studio/0.1" },
    },
  });

  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  for await (const msg of messages) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") log.info(`  · ${block.name} ${redact(JSON.stringify(block.input)).slice(0, 120)}`);
      }
      transcript.push({ role: "assistant", content: msg.message.content });
    } else if (msg.type === "user") {
      transcript.push({ role: "tool", content: msg.message.content });
    } else if (msg.type === "result") {
      result = msg;
    }
  }
  if (!result) throw new Error("El agente terminó sin resultado.");
  transcript.push({ result: result.subtype, cost_usd: result.total_cost_usd, turns: result.num_turns });
  if (result.subtype !== "success") {
    throw new Error(`El agente no completó el guion (${result.subtype}).`);
  }
  if (result.structured_output !== undefined) return result.structured_output;
  return JSON.parse(result.result);
}

/** Genera el storyboard con el Claude Agent SDK (usa tu sesión de Claude Code o ANTHROPIC_API_KEY si está definida). */
export async function generateStoryboard(req: ParsedRequest): Promise<{ storyboard: Storyboard; transcript: unknown[] }> {
  const transcript: unknown[] = [];
  let prompt = userPrompt(req);
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await ask(prompt, transcript);
    const parsed = Storyboard.safeParse(data);
    const problems = parsed.success
      ? checkStoryboard(parsed.data)
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    if (parsed.success && !problems.length) return { storyboard: parsed.data, transcript };
    log.warn(`Storyboard con errores, pidiendo corrección (${problems.length})`);
    prompt = `${userPrompt(req)}\n\nEste es un intento anterior:\n${JSON.stringify(data)}\n\nCorrige estos problemas y devuelve el storyboard completo:\n- ${problems.join("\n- ")}`;
  }
  throw new Error("No se obtuvo un storyboard válido tras varios intentos.");
}
