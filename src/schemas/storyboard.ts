import { z } from "zod";
import {
  ChecklistProps,
  ComparisonProps,
  CounterProps,
  DashboardProps,
  KineticTitleProps,
  TimelineProps,
} from "./templates";

export const FORMATS = ["16x9", "9x16", "1x1"] as const;
export const Format = z.enum(FORMATS);
export type Format = z.infer<typeof Format>;

const sceneId = z.string().regex(/^[a-z0-9-]+$/).describe('Id estable en kebab-case, p. ej. "s1-gancho"');

const sceneBase = {
  id: sceneId,
  onScreenText: z.string().describe("Texto principal en pantalla (titular de la escena, máx. ~60 caracteres)"),
  narration: z.string().describe("Locución en español latino neutro, natural, 2,5 palabras/segundo aprox."),
  estDurationSec: z.number().min(1.5).max(60).describe("Duración estimada de la escena en segundos"),
};

const motion = <T extends string, P extends z.ZodTypeAny>(template: T, props: P) =>
  z.object({ type: z.literal("motion"), template: z.literal(template), ...sceneBase, props });

export const MotionScene = z.discriminatedUnion("template", [
  motion("kinetic-title", KineticTitleProps),
  motion("counter", CounterProps),
  motion("dashboard", DashboardProps),
  motion("checklist", ChecklistProps),
  motion("comparison", ComparisonProps),
  motion("timeline", TimelineProps),
]);
export type MotionScene = z.infer<typeof MotionScene>;

export const ScreenStep = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  objective: z.string().describe('Qué debe lograrse en el ERP en este paso, p. ej. "Abrir Ventas > Facturación"'),
  callout: z.string().describe("Texto breve que aparece junto al elemento resaltado (máx. ~40 caracteres)"),
  narration: z
    .string()
    .describe("Locución de este paso (1-2 frases), se dice mientras se ve el paso en pantalla")
    .optional(),
});

export const ScreenScene = z.object({
  type: z.literal("screen"),
  ...sceneBase,
  goal: z.string().describe("Objetivo de la escena dentro del ERP"),
  steps: z.array(ScreenStep).min(1).max(12),
});
export type ScreenScene = z.infer<typeof ScreenScene>;

export const Scene = z.union([MotionScene, ScreenScene]);
export type Scene = z.infer<typeof Scene>;

export const Storyboard = z.object({
  kind: z.enum(["promo", "tutorial"]),
  title: z.string(),
  targetDurationSec: z.number().min(10).max(600).describe("Duración total objetivo, incluidos intro (3 s) y cierre (4 s)"),
  formats: z.array(Format).min(1),
  music: z.boolean().describe("Usar música de fondo"),
  sources: z.array(z.string()).describe("URLs de manuales consultadas").optional(),
  scenes: z.array(Scene).min(1).max(30),
});
export type Storyboard = z.infer<typeof Storyboard>;

/** Validaciones que no caben en el esquema JSON enviado al modelo. Devuelve errores legibles. */
export function checkStoryboard(sb: Storyboard): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of sb.scenes) {
    if (ids.has(s.id)) errors.push(`Id de escena duplicado: ${s.id}`);
    ids.add(s.id);
    if (s.type === "motion" && s.template === "dashboard" && s.props.chart.labels.length !== s.props.chart.values.length) {
      errors.push(`${s.id}: chart.labels y chart.values deben tener la misma longitud`);
    }
    if (s.type === "screen" && sb.kind === "promo") {
      // permitido, pero requiere Fase 3; no es error.
    }
  }
  return errors;
}

export const INTRO_SEC = 3;
export const OUTRO_SEC = 4;
