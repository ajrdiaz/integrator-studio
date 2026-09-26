# Integrator Video Studio

Genera videos promocionales y mini tutoriales de **Integrator ERP** a partir de un pedido en texto:

```bash
npm run video -- "promo: sin costos ocultos, 30 s, vertical"
npm run video -- "tutorial: emitir una factura electrónica"
```

Cada video es una carpeta reproducible en `jobs/<id>/` y cada etapa se puede reanudar o regenerar por separado.

## Estado por fase

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Storyboard (Claude) + render de promos motion en 16:9 | ✅ |
| 2 | Voz (ElevenLabs), subtítulos quemados, música con ducking, 16:9 / 9:16 / 1:1 | pendiente |
| 3 | Agente explorador del ERP (Claude Agent SDK + Playwright) y grabación determinista | pendiente |
| 4 | Interfaz web: edición del storyboard, regeneración por etapa, versiones | pendiente |

## Requisitos

- Node.js ≥ 20
- Chrome Headless Shell para Remotion. Si no se define `REMOTION_BROWSER_EXECUTABLE`, se usa el de Playwright
  (`$PLAYWRIGHT_BROWSERS_PATH`) o Remotion lo descarga la primera vez.
- ffmpeg/ffprobe: vienen incluidos en `@remotion/compositor-*`; no hace falta instalarlos.

## Instalación

```bash
npm install
cp .env.example .env   # completa las claves
npm test               # pruebas unitarias
npm run studio         # Remotion Studio para previsualizar plantillas
```

## Variables de entorno

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Generar el guion con Claude |
| `CLAUDE_MODEL` | Modelo del guionista (por defecto `claude-opus-5`) |
| `CLAUDE_EXPLORER_MODEL` | Modelo del agente explorador (Fase 3; por defecto = `CLAUDE_MODEL`) |
| `CLAUDE_FALLBACKS` | `default` (reintento en servidor con otro modelo si hay rechazo) u `off` |
| `ERP_URL`, `ERP_USER`, `ERP_PASSWORD` | Entorno **demo** del ERP (Fase 3) |
| `ERP_ENV` | Debe ser `demo` para permitir exploración/grabación |
| `ERP_PROD_HOSTS` | Hosts de producción que nunca se tocan |
| `TTS_PROVIDER`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Voz en off (Fase 2) |
| `JOBS_DIR` | Carpeta de trabajos (por defecto `./jobs`) |
| `REMOTION_BROWSER_EXECUTABLE` | Ruta a Chrome Headless Shell (opcional) |

Los secretos nunca se escriben en código ni en logs: `src/log.ts` enmascara sus valores en toda salida y en los
JSON que se guardan en `jobs/`.

## Uso desde la terminal

```bash
# Pedido nuevo (genera guion con Claude y renderiza)
npm run video -- "promo: sin costos ocultos, 30 s"

# Solo el guion, para revisarlo/editarlo antes de renderizar
npm run video -- "tutorial: emitir una factura electrónica" --until storyboard
# …editar jobs/<id>/storyboard.json y luego:
npm run video -- --job <id> --from compose

# Usar un storyboard propio (sin llamar a Claude)
npm run video -- "promo: sin costos ocultos" --storyboard fixtures/promo-sin-costos-ocultos.storyboard.json

# Varios formatos / lote
npm run video -- --job <id> --formats all
npm run video -- --batch pedidos.txt   # un pedido por línea, '#' para comentarios
```

Formato del pedido: `promo:` o `tutorial:` + tema, y opcionalmente duración (`30 s`, `1.5 min`) y formato
(`vertical`, `cuadrado`, `horizontal`, `todos los formatos`).

## Estructura de un job

```
jobs/<id>/
  job.json                 # pedido, estado y hash de entradas de cada etapa, versiones de render
  storyboard.json          # guion vigente (editable)
  history/storyboard.vN.json
  logs/storyboard.transcript.json
  timeline.json            # escenas en frames, lo que recibe Remotion
  renders/vN/16x9.mp4      # cada render crea una versión nueva
```

Una etapa se salta si ya está hecha con el mismo hash de entradas; `--from <etapa>` fuerza rehacerla junto con las
siguientes. Etapas: `storyboard → explore → record → tts → compose → render`.

## Arquitectura

```
src/
  cli.ts                 CLI (npm run video)
  pipeline/index.ts      orquestador de etapas reanudables
  request.ts             interpreta el pedido (tipo, tema, duración, formatos)
  schemas/               zod: storyboard, plantillas, timeline
  stages/storyboard.ts   Claude: salida estructurada + web_search/web_fetch limitados a manuales.integrator.pe
  stages/compose.ts      storyboard (+ audios) → timeline en frames
  stages/render.ts       bundle de Remotion + render por formato
  jobs/store.ts          carpeta del job, versiones, hashes
remotion/
  Root.tsx               composiciones Video-16x9 / Video-9x16 / Video-1x1
  Video.tsx              intro + escenas + cierre CTA
  brand.ts               colores, Poppins local (assets/fonts), CTA
  registry.tsx           registro de plantillas motion
  components/            Intro, Outro, Background, SceneShell…
  scenes/motion/         KineticTitle, Counter, Dashboard, Checklist, Comparison, Timeline
assets/                  logo.svg, fonts/, music/ (publicDir de Remotion)
fixtures/                storyboards de ejemplo (y sus timelines para Remotion Studio)
```

## Cómo agregar una plantilla motion

1. **Esquema**: en `src/schemas/templates.ts` define `MiPlantillaProps` con zod (usa `.describe()`: esas
   descripciones las lee Claude), agrega el id a `TEMPLATE_IDS` y una línea a `TEMPLATE_DOCS`.
2. **Storyboard**: agrega `motion("mi-plantilla", MiPlantillaProps)` a `MotionScene` en `src/schemas/storyboard.ts`.
3. **Componente**: crea `remotion/scenes/motion/MiPlantilla.tsx` que reciba `{ title, props }`. Usa `SceneShell`
   para el titular, `useLayout()` para dimensionar en unidades `u` (se adapta a 16:9, 9:16 y 1:1) y los helpers de
   `remotion/anim.ts`.
4. **Registro**: agrégalo a `MOTION_TEMPLATES` en `remotion/registry.tsx`.
5. Añade una escena de ejemplo a `fixtures/plantillas.storyboard.json`, ejecuta `npm run fixtures` y revísala en
   `npm run studio`.

## Marca

- Verde principal `#009b72`, tipografía Poppins (archivos locales en `assets/fonts`, licencia OFL).
- `assets/logo.svg` es un **placeholder**: reemplázalo por el logo oficial con el mismo nombre.
- Intro (3 s) y cierre con CTA "Asesoría gratuita · WhatsApp +51 941 427 296 · integrator.pe" (4 s) son fijos.
