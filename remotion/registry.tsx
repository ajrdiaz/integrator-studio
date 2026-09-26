import React from "react";
import type { MotionScene, Scene } from "../src/schemas/storyboard";
import type { TemplateId } from "../src/schemas/templates";
import { Checklist } from "./scenes/motion/Checklist";
import { Comparison } from "./scenes/motion/Comparison";
import { Counter } from "./scenes/motion/Counter";
import { Dashboard } from "./scenes/motion/Dashboard";
import { KineticTitle } from "./scenes/motion/KineticTitle";
import { Timeline } from "./scenes/motion/Timeline";
import { SceneShell } from "./components/SceneShell";

type PropsOf<T extends TemplateId> = Extract<MotionScene, { template: T }>["props"];
type TemplateComponent<T extends TemplateId> = React.FC<{ title: string; props: PropsOf<T> }>;

/**
 * Registro de plantillas motion. Para agregar una plantilla:
 *  1. Define su esquema de props en src/schemas/templates.ts y agrega su id a TEMPLATE_IDS y TEMPLATE_DOCS.
 *  2. Agrega la variante en MotionScene (src/schemas/storyboard.ts).
 *  3. Crea el componente en remotion/scenes/motion/ y regístralo aquí.
 */
export const MOTION_TEMPLATES: { [K in TemplateId]: TemplateComponent<K> } = {
  "kinetic-title": KineticTitle,
  counter: Counter,
  dashboard: Dashboard,
  checklist: Checklist,
  comparison: Comparison,
  timeline: Timeline,
};

export const SceneRenderer: React.FC<{ scene: Scene }> = ({ scene }) => {
  if (scene.type === "motion") {
    const Component = MOTION_TEMPLATES[scene.template] as TemplateComponent<TemplateId>;
    return <Component title={scene.onScreenText} props={scene.props as never} />;
  }
  // Escenas de pantalla: se implementan en la Fase 3 (grabación del ERP).
  return (
    <SceneShell title={scene.onScreenText}>
      <div style={{ margin: "auto", fontSize: 40, opacity: 0.5 }}>[Grabación pendiente: {scene.goal}]</div>
    </SceneShell>
  );
};
