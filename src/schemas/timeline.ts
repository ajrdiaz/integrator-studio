import type { Format, Scene } from "./storyboard";

/** Palabra con tiempos relativos al inicio de su escena (frames). */
export interface CaptionWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface TimelineScene {
  scene: Scene;
  from: number;
  durationInFrames: number;
  /** Ruta relativa al directorio del job (se sirve por HTTP durante el render). */
  audio?: { src: string; durationInFrames: number; offsetFrames: number };
  captions?: CaptionWord[];
}

/** Entrada completa de la composición de Remotion. Se guarda como jobs/<id>/timeline.json. */
export interface Timeline {
  fps: number;
  title: string;
  introFrames: number;
  outroFrames: number;
  scenes: TimelineScene[];
  totalFrames: number;
  music?: { src: string; volume: number };
  /** Rellenado en el render: URL base desde la que se sirven los archivos del job. */
  assetBaseUrl?: string;
}

export interface VideoProps extends Record<string, unknown> {
  timeline: Timeline;
  format: Format;
}
