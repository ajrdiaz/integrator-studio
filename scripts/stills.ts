// Renderiza fotogramas clave de un timeline para revisión visual rápida.
// Uso: tsx scripts/stills.ts <timeline.json> <outDir> [formato] [frames separados por coma]
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Format } from "../src/schemas/storyboard";
import type { Timeline } from "../src/schemas/timeline";
import { renderFrame } from "../src/stages/render";

const [file, outDir, format = "16x9", framesArg] = process.argv.slice(2);
if (!file || !outDir) throw new Error("Uso: tsx scripts/stills.ts <timeline.json> <outDir> [formato] [frames]");
const timeline = JSON.parse(readFileSync(file, "utf8")) as Timeline;
const frames = framesArg
  ? framesArg.split(",").map(Number)
  : [45, ...timeline.scenes.map((s) => s.from + Math.round(s.durationInFrames * 0.8)), timeline.totalFrames - 30];
for (const frame of frames) {
  const out = path.join(outDir, `${format}-f${String(frame).padStart(4, "0")}.png`);
  await renderFrame({ timeline, format: format as Format, frame, outFile: out, assetsDir: path.dirname(file) });
  console.log(out);
}
