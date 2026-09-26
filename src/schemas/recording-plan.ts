import { z } from "zod";

/**
 * Selector robusto. Preferencia: role+name > label > placeholder > text > testId > css (último recurso).
 * `within` limita la búsqueda a un contenedor; `nth` elige entre varias coincidencias.
 */
export type LocatorSpec = {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  testId?: string;
  css?: string;
  exact?: boolean;
  nth?: number;
  within?: LocatorSpec;
};

export const LocatorSpec: z.ZodType<LocatorSpec> = z.lazy(() =>
  z
    .object({
      role: z.string().describe('Rol ARIA: button, link, textbox, combobox, option, menuitem, tab, row, cell…').optional(),
      name: z.string().describe("Nombre accesible (texto visible o etiqueta) para usar con role").optional(),
      label: z.string().optional(),
      placeholder: z.string().optional(),
      text: z.string().optional(),
      testId: z.string().optional(),
      css: z.string().describe("Solo si no hay alternativa semántica").optional(),
      exact: z.boolean().optional(),
      nth: z.number().int().min(0).optional(),
      within: LocatorSpec.optional(),
    })
    .refine((s) => !!(s.role || s.label || s.placeholder || s.text || s.testId || s.css), "El selector necesita role, label, placeholder, text, testId o css"),
);

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), path: z.string().describe("Ruta dentro del ERP, p. ej. /comercial/ventas") }),
  z.object({ type: z.literal("click"), target: LocatorSpec }),
  z.object({ type: z.literal("fill"), target: LocatorSpec, value: z.string() }),
  z.object({ type: z.literal("select"), target: LocatorSpec, option: z.string() }),
  z.object({ type: z.literal("press"), key: z.string(), target: LocatorSpec.optional() }),
  z.object({ type: z.literal("wait"), target: LocatorSpec.optional(), ms: z.number().int().min(0).max(15000).optional() }),
]);
export type Action = z.infer<typeof Action>;

export const PlanStep = z.object({
  id: z.string(),
  objective: z.string(),
  callout: z.string(),
  actions: z.array(Action),
  /** Elemento a resaltar al final del paso (para zoom, anillo y callout). */
  highlight: LocatorSpec.optional(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanScene = z.object({
  sceneId: z.string(),
  steps: z.array(PlanStep),
});

export const RecordingPlan = z.object({
  erpHost: z.string(),
  company: z.string(),
  createdAt: z.string(),
  scenes: z.array(PlanScene),
  blocked: z
    .object({ sceneId: z.string(), stepId: z.string(), reason: z.string(), screenshot: z.string().optional() })
    .optional(),
});
export type RecordingPlan = z.infer<typeof RecordingPlan>;

/** Resultado de la grabación: tiempos por paso para sincronizar zoom, resaltados y voz. */
export interface RecordedStep {
  sceneId: string;
  stepId: string;
  callout: string;
  /** Segundos desde el inicio del video grabado. */
  start: number;
  end: number;
  /** Momentos de clic (para el efecto de pulsación). */
  clicks: { t: number; x: number; y: number }[];
  /** Elementos con los que se interactúa, en orden (la cámara los sigue). */
  focus: { t: number; box: { x: number; y: number; width: number; height: number } }[];
  /** Momento en que empieza la pausa final con el resultado visible (se muestra el resaltado). */
  holdAt: number;
  /** Caja del elemento resaltado en píxeles de la grabación (1920x1080). */
  box?: { x: number; y: number; width: number; height: number };
}

export interface Recording {
  file: string;
  width: number;
  height: number;
  durationSec: number;
  scenes: { sceneId: string; start: number; end: number }[];
  steps: RecordedStep[];
}
