import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { STAGES, type Stage } from "./jobs/store";
import { log } from "./log";
import { run } from "./pipeline";
import { FORMATS, type Format } from "./schemas/storyboard";

const HELP = `Integrator Video Studio

Uso:
  npm run video -- "promo: sin costos ocultos, 30 s, vertical"
  npm run video -- "tutorial: emitir una factura electrónica" --until storyboard
  npm run video -- --job <id> --from render --formats all
  npm run video -- --batch pedidos.txt            (un pedido por línea)
  npm run video -- "promo: ..." --storyboard archivo.json

Opciones:
  --job <id>            Reanudar/regenerar un job existente (jobs/<id>)
  --from <etapa>        Rehacer desde: ${STAGES.join(", ")}
  --until <etapa>       Detenerse después de esa etapa
  --formats <lista>     16x9,9x16,1x1 o "all"
  --storyboard <file>   Usar un storyboard JSON (salta la generación con Claude)
  --batch <file>        Procesar varios pedidos en secuencia
  --tts <proveedor>     elevenlabs (por defecto, TTS_PROVIDER) o silent (prueba sin red)
  --no-voice            Video sin locución ni subtítulos
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
  };

  const requests = values.batch
    ? readFileSync(values.batch, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : positionals.length
      ? [positionals.join(" ")]
      : [];

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
