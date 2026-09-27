import type { RecordedStep } from "./recording-plan";
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
  /** Voz por paso en escenas de pantalla (clave "escena--paso"). */
  stepVoices?: { key: string; src: string; durationInFrames: number; offsetFrames: number }[];
  captions?: CaptionWord[];
  /** Escenas de pantalla: tramo de la grabación del ERP. Tiempos de `steps` relativos a `start`. */
  screen?: {
    src: string;
    width: number;
    height: number;
    start: number;
    end: number;
    /**
     * Tramos de reproducción (uno por paso, o uno para toda la escena). Cada tramo se reproduce a `rate`
     * (>1 si es mucho más largo que su voz) y, si la voz es más larga, se congela su último cuadro.
     * srcStart/srcEnd en segundos relativos a `start`; from/duration en frames relativos a la escena.
     */
    pieces: { srcStart: number; srcEnd: number; rate: number; from: number; duration: number }[];
    steps: RecordedStep[];
    /** Zonas difuminadas (coordenadas de la grabación). */
    blur?: { x: number; y: number; width: number; height: number }[];
  };
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
