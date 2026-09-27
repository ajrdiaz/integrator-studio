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
| 2 | Voz (ElevenLabs), subtítulos quemados, música con ducking, 16:9 / 9:16 / 1:1 | ✅ (falta probar con la clave de ElevenLabs) |
| 3 | Agente explorador del ERP (Claude Agent SDK + Playwright) y grabación determinista | ✅ |
| 4 | Interfaz web: edición del storyboard, regeneración por etapa, versiones | ✅ |

## Requisitos

- Node.js ≥ 20
- Claude Code con sesión iniciada (`claude` → `/login`), o `ANTHROPIC_API_KEY`
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
| `ANTHROPIC_API_KEY` | Opcional. Sin ella, el Claude Agent SDK usa la sesión de Claude Code de la máquina (`claude` → `/login`) |
| `CLAUDE_MODEL` | Modelo del guionista (vacío = modelo por defecto de Claude Code) |
| `CLAUDE_EXPLORER_MODEL` | Modelo del agente explorador (Fase 3; por defecto = `CLAUDE_MODEL`) |
| `ERP_URL`, `ERP_USER`, `ERP_PASSWORD` | Entorno **demo** del ERP (Fase 3) |
| `ERP_ENV` | Debe ser `demo` para permitir exploración/grabación |
| `ERP_PROD_HOSTS` | Hosts de producción que nunca se tocan |
| `TTS_PROVIDER`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Voz en off (Fase 2) |
| `JOBS_DIR` | Carpeta de trabajos (por defecto `./jobs`) |
| `REMOTION_BROWSER_EXECUTABLE` | Ruta a Chrome Headless Shell (opcional) |

Los secretos nunca se escriben en código ni en logs: `src/log.ts` enmascara sus valores en toda salida y en los
JSON que se guardan en `jobs/`.

## Interfaz web (local)

```bash
npm run web          # compila la interfaz y abre el servidor en http://localhost:3000
npm run web:dev      # desarrollo: API en :3000 + Vite con recarga en :5173
```

- **Nuevo video**: escribe el pedido; Claude escribe solo el guion para que lo revises antes de producir.
- **Escenas / JSON**: edita textos, narración y duración por escena, o el JSON completo (validado con el mismo
  esquema zod que usa el pipeline). Los errores se muestran antes de guardar.
- **Vista previa instantánea** con el Player de Remotion en 16:9, 9:16 y 1:1: se compone en el navegador con los
  cambios sin guardar y reutiliza la voz de las escenas cuya narración no cambió.
- **Producir**: formatos, voz (automática, ElevenLabs, Kokoro, silencio o sin voz), "Solo render" y "Reescribir guion".
  Al cambiar una frase, solo se regenera la voz de esa escena, la composición y el render.
- **Regenerar voz** por escena, **progreso en vivo** y **versiones** del guion (restaurables) y de los renders.
- El servidor escucha solo en `127.0.0.1` (cámbialo con `HOST`/`PORT`). Los trabajos se procesan en fila, uno a la vez.

## Editor de clips (escenas de pantalla)

En la pestaña "Escenas", cada escena de pantalla tiene **Editar clip**. Todo se aplica en la composición, sin volver a
grabar el ERP, y se ve al instante en la vista previa:

- **Por paso**: recorte al inicio y al final (s), velocidad (automática o fija 0,75x–2x), zoom (automático, sin zoom o
  zona fija dibujada sobre el fotograma), resaltado activado/desactivado, callout y narración, y "Voz ↻" para
  regenerar solo la voz de ese paso.
- **Por escena**: zonas a difuminar (p. ej. nombre o RUC del cliente) dibujadas sobre un fotograma de la grabación.
- **Pantallas de carga**: la grabación marca los tramos en que el ERP estaba cargando y se saltan automáticamente
  (casilla "Saltar pantallas de carga").
- **Escenas**: subir/bajar, eliminar y agregar escenas nuevas desde cualquier plantilla.
- **Borrador rápido**: media resolución para revisar (no crea versión). `--draft` en la terminal.

Las ediciones se guardan en el storyboard (`steps[].clip`, `clip.blur`, `skipLoading`), así que quedan en el
historial de versiones.

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

## Voz, subtítulos y música

- **Voz**: un audio por escena en `jobs/<id>/audio/`. Se mide la duración real (ffprobe) y la escena se alarga si la
  locución no cabe. Solo se vuelve a sintetizar la escena cuya narración cambió (hash en `audio/<escena>.json`).
- **Proveedores** (`--tts` o `TTS_PROVIDER`):
  - `elevenlabs`: usa `/with-timestamps` para tiempos por palabra exactos.
  - `kokoro`: local y gratis (voces `em_alex`, `em_santa`, `ef_dora`; `KOKORO_VOICE`). Instalar con
    `npm run setup:kokoro` (Python 3 + ~350 MB desde GitHub). Se sintetiza por oración y los tiempos por palabra se
    reparten dentro de cada oración. Si faltan las claves de ElevenLabs, se usa Kokoro automáticamente.
  - `silent`: silencio con tiempos estimados, para probar sin voz. Para agregar otro (p. ej. Azure),
  implementa `TtsProvider` (`src/stages/tts/types.ts`) y regístralo en `src/stages/tts/index.ts`.
- **Pronunciación**: `src/stages/tts/pronunciation.ts` (SUNAT, IGV, RUC…). Los subtítulos muestran el texto escrito.
- **Subtítulos**: quemados, en páginas cortas, con la palabra actual resaltada en verde.
- **Música**: si el storyboard tiene `"music": true`, se usa la primera pista de `assets/music/` (orden alfabético),
  con fade y ducking bajo la voz. `zz-placeholder-pad.mp3` es una pista sintética de prueba: agrega la tuya (con
  licencia) y borra esa.
- **Formatos**: por defecto solo 16:9. Los demás se agregan después (`--formats 9x16,1x1` o los botones "+ 9:16" / "+ 1:1" de la interfaz): si el contenido no cambió, se renderiza solo lo que falta dentro de la misma versión. 9:16 incluye zona segura para Reels/TikTok.

## Tutoriales: exploración y grabación del ERP

1. **Exploración (agente)** — `src/stages/explore.ts`. Para cada escena `screen`, un agente del Claude Agent SDK
   controla Chrome con herramientas propias (`snapshot` del árbol de accesibilidad, `screenshot`, `click`, `fill`,
   `select`, `press`, `wait`, `goto`, `commit_step`, `restart`, `report_blocked`). Cada acción exitosa queda
   pendiente y `commit_step` la asigna al paso; `restart` vuelve al último paso confirmado. Resultado:
   `recording-plan.json` con selectores robustos (rol + nombre preferidos), valores y elemento a resaltar.
   Si se traba, se detiene y explica dónde (`blocked`, con captura en `explore/`).
2. **Grabación (sin IA)** — `src/stages/record.ts`. Reproduce el plan en 1920x1080 con cursor visible y animado,
   efecto de clic, tipeo natural con semilla fija y una pausa al final de cada paso. Graba con el screencast de
   Chrome (JPEG de alta calidad) y ensambla `recordings/tutorial.mp4` a 30 fps. Guarda tiempos por paso,
   clics y cajas de los elementos en `recordings/recording.json`. Si cambia la interfaz del ERP: "Re-explorar";
   si solo quieres otra toma idéntica: "Regrabar".
3. **Composición** — `remotion/scenes/screen/ScreenScene.tsx`: cámara que sigue al elemento activo (zoom suave en
   16:9, reencuadre en 9:16 y 1:1), resaltado con callout en la pausa de cada paso y chip de progreso. Si la
   grabación es más larga que la voz se acelera hasta 1,35x; si es más corta, se congela el último cuadro.

**Seguridad**: solo `ERP_ENV=demo`; navegación limitada al host de `ERP_URL` (otros dominios solo GET de recursos);
`ERP_PROD_HOSTS` como lista negra; empresa fija `ERP_COMPANY`; antes de cada paso se verifica el aviso
"Ambiente de Prueba" y si no aparece se detiene; el login usa `.env` y el agente nunca ve la contraseña.
Opcional: `ERP_SAMPLE_CUSTOMER` = cliente ficticio que el agente debe usar en los videos.

## Estructura de un job

```
jobs/<id>/
  job.json                 # pedido, estado y hash de entradas de cada etapa, versiones de render
  storyboard.json          # guion vigente (editable)
  history/storyboard.vN.json
  logs/storyboard.transcript.json
  audio/<escena>.mp3|.json  # locución + duración real + tiempos por palabra
  recording-plan.json      # plan del agente (acciones, selectores, resaltados)
  explore/                 # capturas del agente (y del bloqueo, si lo hubo)
  recordings/tutorial.mp4  # grabación del ERP + recording.json (tiempos por paso)
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
  stages/storyboard.ts   Claude Agent SDK: salida estructurada + WebSearch/WebFetch limitados a manuales.integrator.pe
  stages/compose.ts      storyboard (+ audios) → timeline en frames
  stages/render.ts       bundle de Remotion + render por formato
  jobs/store.ts          carpeta del job, versiones, hashes
  server/                API HTTP + SSE de progreso para la interfaz web
web/                     interfaz (React + Vite + @remotion/player)
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
- `assets/logo.svg`: logo oficial tomado del login de Integrator, recoloreado a `#009b72`.
- Intro (3 s) y cierre con CTA "Asesoría gratuita · WhatsApp +51 941 427 296 · integrator.pe" (4 s) son fijos.

## Licencia de Remotion

Remotion es gratuito para personas y empresas de hasta 3 empleados; empresas más grandes necesitan una
[licencia de empresa](https://www.remotion.dev/license).
