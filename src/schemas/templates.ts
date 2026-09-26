import { z } from "zod";

/**
 * Esquemas de props de las plantillas motion. Son la fuente de verdad compartida por:
 *  - el generador de guiones (se envían a Claude como parte del esquema de salida),
 *  - la validación del storyboard editado a mano,
 *  - los componentes de Remotion (remotion/registry.tsx).
 * El título de cada escena NO va aquí: es `onScreenText` de la escena.
 */

export const KineticTitleProps = z.object({
  subline: z.string().describe("Frase corta de apoyo bajo el titular (máx. ~60 caracteres)").optional(),
  emphasis: z
    .array(z.string())
    .describe("Palabras del titular que se resaltan en verde (deben aparecer tal cual en onScreenText)")
    .optional(),
});

export const CounterProps = z.object({
  items: z
    .array(
      z.object({
        value: z.number().describe("Valor final del contador"),
        prefix: z.string().describe('Texto antes del número, p. ej. "S/ "').optional(),
        suffix: z.string().describe('Texto después del número, p. ej. "%" o " h"').optional(),
        decimals: z.number().int().min(0).max(2).optional(),
        label: z.string().describe("Qué mide el número (máx. ~40 caracteres)"),
      }),
    )
    .min(1)
    .max(3),
});

export const DashboardProps = z.object({
  kpis: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().describe('Valor ya formateado, p. ej. "S/ 125,400"'),
        delta: z.string().describe('Variación, p. ej. "+12%"').optional(),
      }),
    )
    .min(2)
    .max(4),
  chart: z.object({
    kind: z.enum(["bar", "line"]),
    labels: z.array(z.string()).min(3).max(12),
    values: z.array(z.number()).min(3).max(12),
  }),
});

export const ChecklistProps = z.object({
  items: z.array(z.string().describe("Ítem breve (máx. ~45 caracteres)")).min(2).max(6),
});

export const ComparisonProps = z.object({
  left: z.object({
    label: z.string().describe('Columna "antes"/competencia, p. ej. "Otros ERP"'),
    points: z.array(z.string()).min(2).max(5),
  }),
  right: z.object({
    label: z.string().describe('Columna de Integrator, p. ej. "Integrator"'),
    points: z.array(z.string()).min(2).max(5),
  }),
});

export const TimelineProps = z.object({
  milestones: z
    .array(
      z.object({
        label: z.string().describe("Etiqueta corta del hito (máx. ~20 caracteres)"),
        detail: z.string().describe("Detalle opcional (máx. ~40 caracteres)").optional(),
      }),
    )
    .min(2)
    .max(6),
});

export const TEMPLATE_IDS = ["kinetic-title", "counter", "dashboard", "checklist", "comparison", "timeline"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATE_DOCS: Record<TemplateId, string> = {
  "kinetic-title": "Titular grande animado palabra por palabra. Ideal para ganchos y mensajes clave.",
  counter: "1 a 3 números que cuentan hasta su valor final con etiqueta. Para cifras de impacto.",
  dashboard: "Panel con 2-4 KPIs y un gráfico de barras o líneas que se dibuja. Para mostrar control/visibilidad.",
  checklist: "Lista de 2-6 ítems que se marcan uno a uno. Para beneficios o lo que incluye.",
  comparison: "Dos columnas lado a lado (antes/competencia vs Integrator). Para contrastes.",
  timeline: "Línea de tiempo con 2-6 hitos. Para procesos, implementación o pasos.",
};
