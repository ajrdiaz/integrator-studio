import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaContentBlock, BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env, requireEnv } from "../config";
import { log } from "../log";
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
- Los valores de dashboards y ejemplos son datos ilustrativos de una empresa ficticia; que se vean realistas (soles, S/).

Plantillas motion disponibles (campo "template"):
${TEMPLATE_IDS.map((id) => `- ${id}: ${TEMPLATE_DOCS[id]}`).join("\n")}

Ids de escena: kebab-case, prefijados con el orden ("s1-gancho", "s2-...").`;

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

function textOf(content: BetaContentBlock[]): string {
  return content
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Genera el storyboard con Claude (salida estructurada + búsqueda restringida a los manuales). */
export async function generateStoryboard(req: ParsedRequest): Promise<{ storyboard: Storyboard; transcript: unknown[] }> {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY", "para generar el guion con Claude") });
  const messages: BetaMessageParam[] = [{ role: "user", content: userPrompt(req) }];
  const transcript: unknown[] = [];

  const call = async (): Promise<BetaMessage> => {
    const stream = client.beta.messages.stream({
      model: env.CLAUDE_MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages,
      tools: [
        { type: "web_search_20260209", name: "web_search", allowed_domains: SOURCE_DOMAINS, max_uses: 4 },
        { type: "web_fetch_20260209", name: "web_fetch", allowed_domains: SOURCE_DOMAINS, max_uses: 6 },
      ],
      output_config: { format: zodOutputFormat(Storyboard), effort: "high" },
      ...(env.CLAUDE_FALLBACKS === "default"
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });
    const msg = await stream.finalMessage();
    transcript.push({ stop_reason: msg.stop_reason, model: msg.model, usage: msg.usage, content: msg.content });
    return msg;
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    const msg = await call();
    if (msg.stop_reason === "refusal") {
      throw new Error(`Claude rechazó generar el guion: ${JSON.stringify(msg.stop_details ?? {})}`);
    }
    if (msg.stop_reason === "pause_turn") {
      // Herramientas de servidor (búsqueda) todavía trabajando: continuar el turno.
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    if (msg.stop_reason === "max_tokens") throw new Error("El guion excedió max_tokens; pide un video más corto.");

    const raw = textOf(msg.content);
    let problems: string[];
    try {
      const parsed = Storyboard.safeParse(JSON.parse(raw));
      if (parsed.success) {
        problems = checkStoryboard(parsed.data);
        if (!problems.length) return { storyboard: parsed.data, transcript };
      } else {
        problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      }
    } catch (e) {
      problems = [`JSON inválido: ${(e as Error).message}`];
    }
    log.warn(`Storyboard con errores, pidiendo corrección (${problems.length})`);
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: `Corrige estos problemas y devuelve el storyboard completo:\n- ${problems.join("\n- ")}` });
  }
  throw new Error("No se obtuvo un storyboard válido tras varios intentos.");
}
