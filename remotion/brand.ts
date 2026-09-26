import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const brand = {
  green: "#009b72",
  greenDark: "#006e51",
  greenDeep: "#063d2f",
  greenSoft: "#e3f5ee",
  ink: "#0d2621",
  muted: "#5b716b",
  bg: "#f5fbf8",
  white: "#ffffff",
  danger: "#d9534f",
  font: "Poppins",
  logo: "logo.svg",
  cta: {
    headline: "Asesoría gratuita",
    whatsapp: "WhatsApp +51 941 427 296",
    web: "integrator.pe",
  },
} as const;

let fontsLoaded: Promise<unknown> | null = null;

/** Carga Poppins desde /assets/fonts (sin depender de Google Fonts en el render). */
export function ensureFonts() {
  if (!fontsLoaded) {
    fontsLoaded = Promise.all(
      (["400", "500", "600", "700", "800"] as const).map((weight) =>
        loadFont({ family: brand.font, url: staticFile(`fonts/Poppins-${weight}.woff2`), weight }),
      ),
    );
  }
  return fontsLoaded;
}
