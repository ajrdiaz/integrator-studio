# AGENTS.md — Integrator Video Studio

Guía para agentes de código que trabajan en este repositorio. El README explica el producto para personas; aquí va lo
que necesitas para cambiar el código sin romper nada.

## Qué es

Pipeline que produce videos de Integrator (ERP peruano): un pedido en texto ("tutorial: emitir una factura
electrónica") pasa por etapas reanudables y termina en un MP4 renderizado con Remotion.

```
storyboard → explore → record → tts → compose → render (+ revisión automática)
```

- **storyboard**: Claude (Agent SDK) escribe el guion; solo puede leer manuales.integrator.pe.
- **explore**: un agente (Agent SDK + herramientas MCP propias sobre Playwright) usa el **ERP de prueba** y deja un
  `recording-plan.json` (acciones y selectores). Al terminar, `align.ts` ajusta el guion a los nombres reales de la UI.
- **record**: reproduce el plan sin IA (cursor animado, tipeo natural) y graba la pantalla.
- **tts** (ElevenLabs o Kokoro local) → **compose** (timeline en frames) → **render** (Remotion, audio normalizado a
  -14 LUFS) → **review** (`review.ts`: guion vs. grabación, cuadros negros, audio, timeline; y revisión visual con
  Claude bajo demanda).

Cada etapa guarda un hash de sus entradas en `jobs/<id>/job.json` y se salta si no cambió. `--from <etapa>` la fuerza.

## Comandos

```bash
npm run typecheck          # tsc --noEmit (cubre src, remotion, web/src, tests, scripts)
npm test                   # vitest
npm run web:build          # compila la interfaz (vite)
./run.sh                   # compila la web y levanta el servidor (puerto libre si 3000 está ocupado)
npm run video -- --job <id> [--from <etapa>] [--review]
npm run setup:kokoro       # voz local: Python 3.10–3.13 en models/kokoro/venv
```

Antes de terminar un cambio: `npm run typecheck && npm test`, y `npm run web:build` si tocaste `web/` o `remotion/`.
El servidor no recarga código: después de cambios hay que reiniciarlo (y el bundle de Remotion se cachea por proceso).

## Mapa del código

```
src/pipeline/index.ts   orquestador de etapas (hashes, reutilización, versiones de render)
src/stages/             storyboard, explore, record, tts/, compose, render, review, align
src/stages/erp/         browser.ts (login, guardas de seguridad, selectores), executor.ts (acciones del plan)
src/schemas/            zod: storyboard, recording-plan, timeline, plantillas
src/jobs/store.ts       carpeta del job, manifest, versiones
src/server/             API HTTP + SSE para la web; runner.ts encola los jobs (uno a la vez)
src/media.ts            ffmpeg/ffprobe de Remotion, normalización de audio
src/knowledge.ts        carga knowledge/erp.md en los prompts
knowledge/erp.md        cómo funciona realmente el ERP (lo leen el guionista y el explorador)
remotion/               composición del video (ScreenScene, plantillas motion, cámara)
web/src/                interfaz React (editor de guion y clips, vista previa con @remotion/player)
jobs/<id>/              datos generados (ignorado por git)
```

## Reglas del ERP (importante)

- **Solo el ambiente de prueba.** `ERP_ENV=demo` y el aviso "Ambiente de Prueba" se verifican en cada paso;
  `installGuard` bloquea otros dominios. No debilites estas guardas.
- **Explorar y grabar tiene efectos reales**: cada exploración, verificación de escena y grabación crea (y a veces
  cierra) facturas en el ERP de prueba. No re-explores ni re-grabes "para probar" sin que el usuario lo pida o lo
  acepte. Para cambiar solo textos del guion, edita callout/narración y renderiza: la exploración se reutiliza mientras
  no cambien los `goal`/`objective`/ids de las escenas de pantalla (ese es el `exploreHash`).
- El agente explorador sigue instrucciones del prompt (`SYSTEM_PROMPT` en `explore.ts`): no crea datos maestros,
  elige el primer Representante de Venta, usa el cliente de `ERP_SAMPLE_CUSTOMER` o uno genérico. El usuario decidió
  que basten las instrucciones (sin bloqueo técnico por módulo), porque otros videos pueden necesitar otros módulos.
- Lo que se aprende del ERP va a `knowledge/erp.md`, no al prompt. Ejemplos: "Registrar" guarda la cabecera y pasa a
  "Actualizar"; cada ítem del detalle se agrega con Enter; en facturas la serie está en el campo "Documento".
- Nunca muestres ni registres credenciales: usa `redact()` de `src/log.ts` en todo lo que vaya a logs o transcripts.

## Cosas no obvias

- **ffmpeg de Remotion** (`@remotion/compositor-*`): es el que usa el proyecto (no dependas del ffmpeg del sistema).
  Necesita `DYLD_LIBRARY_PATH` en macOS (ya lo pone `media.ts`). No trae `blackdetect`, `freezedetect`,
  `volumedetect` ni `ebur128`: por eso `review.ts` analiza cuadros en TypeScript y el audio con `silencedetect` y
  `loudnorm`. Encoders útiles: libx264, aac, pcm_s16le, rawvideo (con `-f image2pipe`).
- **Exploración vs. grabación**: `Executor` corre en modo rápido (explorar) y cinemático (grabar). Deben comportarse
  igual: `fill` hace clic real y escribe tecla por tecla en ambos; en grabación el clic va a coordenadas y espera a que
  nada tape el elemento (avisos flotantes). Si cambias uno, revisa el otro.
- **Verificación de escenas**: al terminar cada escena, el plan se re-ejecuta desde cero y el agente confirma
  (`scene_ok`) o rehace (`reset_scene`). Una escena puede culpar a la anterior (`report_blocked` con `previousScene`).
- **Vista previa ≠ render**: el Player del navegador arma el video en vivo (tramos pre-montados con `premountFor`);
  el render final es cuadro por cuadro. Un problema visto en la vista previa puede no estar en el MP4.
- `callout` del storyboard prevalece sobre el del plan. Los callouts deben ser el texto exacto visible en pantalla.
- `writeStoryboard` crea una versión nueva en `history/`; el editor web recarga el guion al terminar un proceso si no
  hay cambios locales sin guardar.
- `recordings/screen-text.json` (textos visibles por paso) existe solo en grabaciones hechas desde que se agregó;
  sin él, la revisión no puede comprobar callouts de campos.

## Convenciones

- Todo en **español**: interfaz, mensajes de error y progreso, comentarios, README y mensajes de commit.
  Errores pensados para el usuario final: qué pasó y qué hacer ("revisa ERP_USER… en .env").
- TypeScript estricto, ESM, zod para todo lo que entra desde fuera (storyboard, plan, cuerpos de la API).
- Comentarios breves en JSDoc (`/** … */`) que explican el porqué; sigue la densidad del código alrededor.
- Tests en `tests/*.test.ts` (vitest), con datos pequeños construidos en el propio test.
- Commits: asunto en español, conciso, en infinitivo o presente ("Normaliza el audio…"), cuerpo con el porqué.
  Commitea o sube solo cuando el usuario lo pida.
- `.env` nunca se commitea; si agregas una variable, súmala a `.env.example` (con su valor por defecto) y al esquema
  de `src/config.ts` si corresponde.
