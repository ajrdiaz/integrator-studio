import { useVideoConfig } from "remotion";

/**
 * Métrica de diseño independiente del formato: `u` equivale a 1px en un lienzo de 1080 de lado corto.
 * Las plantillas dimensionan todo en `u` y cambian de fila a columna cuando el video es vertical.
 */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  const orientation = width > height ? "landscape" : width < height ? "portrait" : "square";
  return {
    width,
    height,
    u,
    orientation,
    isPortrait: orientation === "portrait",
    isLandscape: orientation === "landscape",
    /** Margen seguro alrededor del contenido. */
    pad: (orientation === "landscape" ? 110 : 80) * u,
  } as const;
}
