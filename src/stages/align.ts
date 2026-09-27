import type { RecordingPlan } from "../schemas/recording-plan";
import type { Storyboard } from "../schemas/storyboard";
import { clickedNames, found, mentions, norm, targetTexts } from "./review";

/**
 * Ajusta el guion a los nombres reales de la interfaz después de explorar el ERP.
 *
 * El guion se escribe antes de ver el ERP y puede nombrar botones que no existen ("Nueva Factura" cuando el botón
 * dice "Nuevo Registro"). Para cada nombre que la narración pide tocar y que no aparece en la grabación, si el paso
 * hizo clic en un único botón/enlace candidato, se reemplaza en la narración y, si dice lo mismo, en el callout.
 * Si hay varios candidatos no se adivina: queda para la revisión automática del render.
 */
export interface Alignment {
  sceneId: string;
  stepId: string;
  from: string;
  to: string;
}

const words = (s: string) => new Set(norm(s).trim().split(" ").filter((w) => w.length > 2));

/** El botón al que se refiere la mención: el único clic con nombre, o el único que comparte alguna palabra con ella. */
function candidate(mention: string, clicks: string[]): string | undefined {
  const unique = [...new Map(clicks.map((c) => [norm(c), c])).values()];
  if (unique.length === 1) return unique[0];
  const m = words(mention);
  const sharing = unique.filter((c) => [...words(c)].some((w) => m.has(w)));
  return sharing.length === 1 ? sharing[0] : undefined;
}

/** Nombre para la narración: "REGISTRAR" → "Registrar" (en mayúsculas la voz lo leería como sigla). */
const spoken = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 3 && w === w.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");

export function alignScript(sb: Storyboard, plan: RecordingPlan): { storyboard: Storyboard; changes: Alignment[] } {
  const storyboard = structuredClone(sb);
  const changes: Alignment[] = [];
  for (const scene of storyboard.scenes) {
    if (scene.type !== "screen") continue;
    const planScene = plan.scenes.find((p) => p.sceneId === scene.id);
    if (!planScene) continue;
    const sceneTexts = planScene.steps.flatMap(targetTexts);
    for (const st of scene.steps) {
      const planStep = planScene.steps.find((p) => p.id === st.id);
      if (!planStep || !st.narration) continue;
      const own = targetTexts(planStep);
      for (const m of mentions(st.narration)) {
        if (found(m, own) || found(m, sceneTexts)) continue;
        const to = candidate(m, clickedNames(planStep));
        if (!to || norm(to) === norm(m)) continue;
        st.narration = st.narration.replace(m, spoken(to));
        if (st.callout && norm(st.callout) === norm(m)) st.callout = to;
        changes.push({ sceneId: scene.id, stepId: st.id, from: m, to });
      }
    }
  }
  return { storyboard, changes };
}
