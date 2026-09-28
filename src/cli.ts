import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Job, STAGES, type Stage } from "./jobs/store";
import { log } from "./log";
import { run } from "./pipeline";
import { reviewLatest, summarize } from "./stages/review";
import { visualReviewLatest } from "./stages/visual-review";
import { FORMATS, type Format } from "./schemas/storyboard";

const HELP = `Integrator Video Studio

Uso:
  npm run video -- "promo: sin costos ocultos, 30 s, vertical"
  npm run video -- "tutorial: emitir una factura electrónica" --until storyboard
  npm run video -- --job <id> --from render --formats all
  npm run video -- --batch pedidos.txt            (un pedido por línea)
  npm run video -- "promo: ..." --storyboard archivo.json
  npm run video -- --job <id> --review            (revisa la última versión renderizada)
  npm run video -- --job <id> --review-visual     (además, revisión visual con Claude; tiene costo)

Opciones:
  --job <id>            Reanudar/regenerar un job existente (jobs/<id>)
  --from <etapa>        Rehacer desde: ${STAGES.join(", ")}
  --until <etapa>       Detenerse después de esa etapa
  --formats <lista>     16x9,9x16,1x1 o "all" (por defecto 16x9; si el contenido no cambió,
                        solo se generan los formatos que falten en la última versión)
  --storyboard <file>   Usar un storyboard JSON (salta la generación con Claude)
  --batch <file>        Procesar varios pedidos en secuencia
  --tts <proveedor>     elevenlabs (por defecto, TTS_PROVIDER) o silent (prueba sin red)
  --no-voice            Video sin locución ni subtítulos
  --draft               Borrador rápido a media resolución (no crea versión)
  --review              Solo revisar el último render (guion vs. grabación, cuadros negros, audio…)
  --review-visual       Revisión visual con Claude del último render (un cuadro por paso)
`;

function parseFormats(v?: string): Format[] | undefined {
  if (!v) return undefined;
  if (v === "all") return [...FORMATS];
  const list = v.split(",").map((s) => s.trim()) as Format[];
  for (const f of list) if (!FORMATS.includes(f)) throw new Error(`Formato desconocido: ${f}`);
  return list;
}

function parseStage(v?: string): Stage | undefined {
  if (!v) return undefined;
  if (!STAGES.includes(v as Stage)) throw new Error(`Etapa desconocida: ${v}`);
  return v as Stage;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      job: { type: "string" },
      from: { type: "string" },
      until: { type: "string" },
      formats: { type: "string" },
      storyboard: { type: "string" },
      batch: { type: "string" },
      tts: { type: "string" },
      "no-voice": { type: "boolean" },
      draft: { type: "boolean" },
      review: { type: "boolean" },
      "review-visual": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || (!positionals.length && !values.job && !values.batch)) {
    console.log(HELP);
    return;
  }
  const common = {
    from: parseStage(values.from),
    until: parseStage(values.until),
    formats: parseFormats(values.formats),
    storyboardFile: values.storyboard,
    tts: values["no-voice"] ? (false as const) : values.tts,
    draft: values.draft,
  };

  const requests = values.batch
    ? readFileSync(values.batch, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : positionals.length
      ? [positionals.join(" ")]
      : [];

  if (values.job && (values.review || values["review-visual"])) {
    const job = Job.open(values.job);
    const reviews = values["review-visual"] ? await visualReviewLatest(job) : reviewLatest(job);
    if (!reviews.length) throw new Error("Ese job todavía no tiene renders.");
    for (const r of reviews) {
      const { errors, warnings } = summarize(r);
      const cost = r.visual?.costUsd !== undefined && values["review-visual"] ? ` · revisión visual: US$ ${r.visual.costUsd.toFixed(2)}` : "";
      log.info(`\n${r.file}: ${errors} error(es), ${warnings} aviso(s)${cost}`);
      for (const f of r.findings) {
        const at = f.at !== undefined ? `${f.at.toFixed(1)} s` : "";
        const icon = f.level === "error" ? "✖" : f.level === "warning" ? "▲" : "·";
        log.info(`  ${icon} ${at.padStart(7)} ${f.check === "visual" ? "(Claude) " : ""}${f.scene ? `[${f.scene}${f.step ? `/${f.step}` : ""}] ` : ""}${f.message}`);
      }
    }
    if (reviews.some((r) => summarize(r).errors)) process.exitCode = 1;
    return;
  }

  if (values.job) {
    const job = await run({ ...common, jobId: values.job });
    summary(job.dir, job.manifest.renders.slice(-3).map((r) => r.file));
    return;
  }

  let failures = 0;
  for (const request of requests) {
    try {
      const job = await run({ ...common, request });
      const latest = job.manifest.renders.filter((r) => r.version === job.nextRenderVersion() - 1).map((r) => r.file);
      summary(job.dir, latest);
    } catch (e) {
      failures++;
      log.error(`"${request}": ${(e as Error).message}`);
    }
  }
  if (failures) process.exitCode = 1;
}

function summary(dir: string, files: string[]) {
  log.info(`\n✔ ${dir}`);
  for (const f of files) log.info(`   ${f}`);
}

main().catch((e) => {
  log.error((e as Error).message);
  process.exit(1);
});
