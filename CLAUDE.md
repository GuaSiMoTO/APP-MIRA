# CLAUDE.md

Guía para trabajar en este repositorio. El usuario escribe en español: responde en español y mantén la interfaz y los
comentarios del código en español.

## Qué es

**Mira** (antes «Capturas»): app de bandeja para Windows de capturas de pantalla, grabación de vídeo y OCR, con editor de anotaciones y
editor de vídeo. Electron 45 + TypeScript + electron-vite; el editor usa Konva. Es una app **original** inspirada en el
flujo de la Herramienta Recortes y en CleanShot X: no se descompilan ni se copian código, iconos ni recursos de esas apps.

## Comandos

```bash
npm run dev        # desarrollo (la app vive en la bandeja; atajo Ctrl+Mayús+S)
npm run build      # compila a out/
npm run typecheck  # tsc --noEmit (también comprueba tests/)
npm test           # tests unitarios con Vitest (tests/*.test.ts)
npm run dist       # instalador NSIS en dist/ — lo ejecuta el usuario; NO generarlo salvo que lo pida
```

La configuración del instalador está en `electron-builder.config.cjs` (no en `package.json`): pone en las propiedades
del `.exe` el autor (Javier Barroso), la versión y la fecha en que se genera. El aviso de Windows «editor desconocido»
solo desaparece firmando el instalador con un certificado de firma de código.

Tests unitarios (Vitest, en `tests/`) para la lógica sin pantalla: censura automática (`sensitive.ts`), unión de la
captura con desplazamiento (`stitch.ts`), geometría del fondo y de las transformaciones, rangos del protocolo y
validación de ajustes, nombres de archivo sin sobrescribir, limpieza de temporales, ffmpeg (con un vídeo real) e historial con
operaciones a la vez. Los módulos del proceso principal se prueban simulando `electron` con `vi.mock`. Lo que
depende de la pantalla o de Windows se valida con pruebas de humo dentro de la app (ver más abajo).

Robustez del proceso principal: los JSON se leen y escriben con `store.ts` (escritura atómica; un archivo dañado se
aparta como `.corrupt-<fecha>.bak`), los datos que llegan por IPC se validan con `validate.ts` / `pickSettings`, y los
errores se registran con `logError` (`log.ts`) en `userData/mira.log`. En el proceso principal hay manejadores globales
(`unhandledRejection`, `uncaughtException`, `render-process-gone`). Las ventanas envían sus errores sin capturar por
`app:error` (`reportError` en `shared/api.ts`).

- Archivos nuevos: con `writeNewFile` (`files.ts`), que nunca sobrescribe (si el nombre existe, usa «Nombre (2)»…).
  En «Guardar como», el nombre propuesto sale de `freeName`.
- ffmpeg: siempre con `runFfmpeg` / `spawnFfmpeg`, que lo detienen si deja de informar de progreso.
- Limpieza: `housekeeping()` (`index.ts`) poda el historial y borra los temporales de más de 24 h, salvo los que tenga
  abiertos alguna ventana (`previewFiles`, `editorFiles`, `pinFiles` y `playerFiles`).
- Grabación: el vídeo llega en trozos por `recorder:chunk` y se va añadiendo al archivo; no hay ninguna grabación
  entera en memoria.

## Arquitectura

### Proceso principal (`src/main/`)

| Archivo | Responsabilidad |
| --- | --- |
| `index.ts` | Instancia única, bandeja, tres atajos globales (capturar / repetir región / texto), IPC de ajustes, notificación de inicio |
| `capture.ts` | Superposición por pantalla (captura congelada), `repeatLastRegion` |
| `output.ts` | `finishImage`: qué se hace con una captura terminada (copiar, guardar, historial, vista previa) |
| `preview.ts` | Vista previa flotante: pila de hasta 4 tarjetas, recuperar la cerrada, posición/tamaño/cierre desde ajustes |
| `editor.ts` | Ventana del editor e IPC de guardar, copiar, OCR y anclar |
| `recorder.ts` | Grabación: marco + barra (`regionui.ts`), webcam (se abre **antes** de grabar), clics/teclas vía `inputhook.ts` |
| `scroll.ts` | Captura con desplazamiento: rueda con `winapi.ts`; la unión se hace en el renderer (`scroll/stitch.ts`) |
| `ocr.ts` | Proceso PowerShell persistente con `resources/ocr.ps1` (`Windows.Media.Ocr`); una ruta por línea en stdin |
| `textcard.ts` | Tarjeta con el texto reconocido y lectura de QR (`jsqr`) |
| `pin.ts` | Capturas ancladas (ventanas siempre encima) |
| `player.ts` | Editor de vídeo: recorte y exportación |
| `history.ts` | Datos del historial de 30 días en `userData/historial` (`index.json` + `items/` + `thumbs/`); sin ventanas |
| `historywin.ts` | Ventana del historial y su IPC (abre editores, ancladas y el reproductor) |
| `files.ts` | Carpeta temporal, nombres sin sobrescribir, guardar y «Guardar como», portapapeles, imágenes en bytes |
| `protocol.ts` | Protocolo `capturas://` (rangos 206 + CORS) y sus URL (`mediaUrl`, `historyUrl`) |
| `ffmpeg.ts` | ffmpeg: `runFfmpeg`/`spawnFfmpeg` (con vigilante), `probeMedia`, `exportVideo`, `convertVideo`, `fixWebm` |
| `winapi.ts` | koffi + user32/dwmapi: enumerar ventanas, `SetCursorPos`, rueda, `GetAsyncKeyState` |
| `regionui.ts` | Marco de región y barras de control (excluidos de la captura con `setContentProtection`) |
| `settings.ts` | Ajustes en `userData/settings.json` (+ migración desde la antigua carpeta «Capturas») |
| `welcome.ts` | Aviso de inicio propio (logo + «MIRA» + atajo); sustituye a la notificación de Windows |

**Logo:** el original del usuario (icono + letras «MIRA», fondo transparente) está en `resources/brand/mira-logo.png`.
`npm run brand` (`scripts/make-brand.cjs`, con Electron) lo separa en `resources/icon.png` (icono cuadrado 512 px: app,
bandeja e instalador), `resources/brand/mira-icon-1024.png`, `mira-wordmark.png` y `mira-wordmark-white.png`.
Si el usuario cambia el logo, se sustituye `mira-logo.png` y se vuelve a ejecutar `npm run brand`. Lema: «capture more».

### Renderer (`src/renderer/`)

- Una página por ventana: `<página>.html` + `<página>/main.ts`. **Toda página nueva** debe añadirse a `pages` en
  `electron.vite.config.ts` y su prefijo de canal a la lista blanca de `src/preload/index.ts`.
- Comunicación tipada: **todo canal nuevo se declara en `src/shared/ipc.ts`** (`InvokeChannels` para `api.invoke` ↔
  `handle`, `SendChannels` para `api.send` ↔ `on`, `EventChannels` para `sendTo` ↔ `api.on`). En las ventanas los
  argumentos y respuestas salen del mapa (no pongas genéricos a mano); en el proceso principal se usan `handle`/`on`/
  `sendTo` de `src/main/ipc.ts`, los argumentos llegan como `unknown` y se validan, y el compilador comprueba lo que se devuelve.
- Las imágenes viajan como **bytes** (`Uint8Array`), no como data URL: en la ventana `canvasBytes()` / `bytesUrl()`
  (`shared/bytes.ts`); en el proceso principal `imageFromBytes()` (comprueba la firma PNG/JPEG). Las páginas que muestran
  un `blob:` necesitan `img-src … blob:` en su CSP.
- `shared/`: `api.ts`, `icons.ts` (SVG propios), `theme.css` (variables y estilos base), `desktop.ts` (stream de pantalla).
- Editor (`editor/`): `main.ts` es el núcleo con estado (Konva, eventos, selección, historial, qué barra contextual se
  muestra en `ctxBarHtml`). El resto son módulos sin estado:
  `config.ts` (herramientas, `TOOLBAR`, paletas y tipos), `ctxbar.ts` (HTML de la barra contextual), `analysis.ts`
  (ajuste a bordes del recorte, resaltador inteligente, Mayús, suavizado del lápiz), `magnifier.ts` (lupa),
  `storage.ts` (fondo y favoritos en `localStorage`), `arrow.ts` (`MiraArrow`, subclase de `Konva.Arrow`: la línea no se ve dentro de la punta hueca),
  `inpaint.ts` + `inpaint.worker.ts` (relleno por parches, se carga con `?worker&inline`), `effects.ts` (fondo,
  pixelado, desenfoque seguro, quitar objeto), `transform.ts` (rotar/voltear/redimensionar), `sensitive.ts` (censura
  automática). Lo que no depende del estado va a un módulo y recibe por parámetro lo que necesite (p. ej. el lienzo base).
- Tipos compartidos entre procesos: `src/shared/types.ts`.

### Convenciones del editor

- Las anotaciones viven en el grupo `ann` y se identifican por `name()`: `arrow`, `line`, `pen`, `highlighter`, `rect`,
  `ellipse`, `text`, `label`, `counter`, `effect`, `spotlight`, `magnifier`.
- Historial: `pushHistory()` guarda clones de los nodos y la referencia al lienzo base. **El lienzo base es inmutable**:
  cada operación (recortar, quitar objeto, rotar…) crea uno nuevo y llama a `setBase()`.
- Herramientas agrupadas en `TOOLBAR`; las opciones de cada herramienta van en la barra contextual (`renderCtxBar`).
- El fondo decorativo usa `bgLayout`/`composeBackground` para la vista y para la exportación (misma geometría).

## Trampas conocidas

- La Mira instalada y `npm run dev` comparten carpeta de datos y bloqueo de instancia única. Al arrancar en desarrollo,
  si `Mira.exe` está abierta se le pide que se cierre (o se termina su proceso) y se avisa (`src/main/instance.ts`).
  Una segunda copia de desarrollo sigue funcionando como antes: avisa a la primera (abre la captura) y termina.
  Con `--user-data-dir` no se intenta nunca el relevo (no comparte bloqueo con la instalada).
- Un `display` propio en CSS anula el atributo `hidden`: hay una regla global `[hidden] { display: none !important }` en `theme.css`.
- Electron 45: el portapapeles es asíncrono (`clipboard.write([new ClipboardItem(...)])`, `clipboard.writeText` devuelve promesa).
- Las grabaciones tienen huecos de tiempo con la pantalla quieta (el codificador no emite fotogramas iguales). Para
  recortar o exportar usa `fps` + `tpad` + `trim` en el filtro (ver `exportVideo`), **nunca** `-ss`/`-t` sobre la entrada.
- Abrir la webcam bloquea un momento la captura: se abre y se espera a `webcam:ready` antes de empezar a grabar.
- El protocolo `capturas://` necesita soporte de rangos (206) y `Access-Control-Allow-Origin` para poder saltar en el vídeo
  y generar miniaturas en canvas.
- npm 11+ bloquea los scripts de instalación: los permitidos están en `allowScripts` de `package.json`. El binario de
  Electron se descarga en el primer uso (`node node_modules/electron/install.js`).
- El OCR de Windows puede saltarse líneas muy repetitivas (p. ej. `1111 1111…`); en palabras numéricas se normalizan O→0 y l/I→1.
- Al crear plantillas de código con `node -e` o literales de plantilla se pierden las barras invertidas de las expresiones
  regulares: revisa los regex tras parchear (o usa la herramienta de edición).

## Pruebas de humo

- Se ejecutan dentro de la app compilada: `npm run build` y luego
  `NODE_OPTIONS="--require <script.cjs>" node_modules/electron/dist/electron.exe . --user-data-dir=<carpeta temporal>`
  El script carga `electron` dentro de `setImmediate` y espera a `app.whenReady()`. Crea antes en esa carpeta un
  `settings.json` con `saveDir` (evita la migración y no guarda en la carpeta del usuario).
- **Usa siempre `--user-data-dir`** (también en la segunda instancia): así la prueba no comparte bloqueo con la Mira
  instalada del usuario y no la cierra. `app.setPath('userData')` en `setImmediate` llega tarde para el bloqueo.
- Para abrir la superposición se lanza una segunda instancia **sin** `NODE_OPTIONS` (evento `second-instance`); después se
  simula con `ipcMain.emit('overlay:state' | 'overlay:done', …)` y se revisan las ventanas con `capturePage()`.
- Dibujar en el editor: `window.Konva.stages[0]` y `PointerEvent` sobre `stage.content` (tecla de la herramienta antes).
- Interacciones reales con el ratón: `SetCursorPos`/`mouse_event` con koffi, teniendo en cuenta la barra de título de la ventana.
- Cierra `npm run dev` antes de probar (instancia única) y no guardes en la carpeta de capturas del usuario.
- Al terminar, limpia los datos de prueba: `lastState`/`lastRegion` en `settings.json`, `userData/historial`,
  `localStorage` (`editor-bg`, `editor-bg-presets`) y `%TEMP%/capturas`.
