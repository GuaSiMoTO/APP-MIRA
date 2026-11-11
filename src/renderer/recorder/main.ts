import type { InputEvent, RecorderInit } from '../../shared/types'
import { $, api } from '../shared/api'
import { desktopStream } from '../shared/desktop'
import { icons } from '../shared/icons'

const bar = $('#bar')
const time = $('#time')
const pauseBtn = $<HTMLButtonElement>('#pause')
const audioInfo = $('#audio')

pauseBtn.innerHTML = icons.pause
$('#discard').innerHTML = icons.trash
$('#stop').innerHTML = icons.stop

const FPS = 30
let recorder: MediaRecorder | null = null
let sending: Promise<void> = Promise.resolve()
let streams: MediaStream[] = []
let audioCtx: AudioContext | null = null
let stopDrawing = () => {}
let discarded = false
let elapsed = 0
let lastTick = 0
let tickTimer: number | undefined

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function tick(): void {
  if (recorder?.state === 'recording') {
    const now = performance.now()
    elapsed += now - lastTick
    lastTick = now
  }
  time.textContent = fmt(elapsed)
}

// ---------- Clics y teclas dibujados en el vídeo ----------

interface Click {
  x: number
  y: number
  button: string
  t: number
}
const clicks: Click[] = []
let keyLabel = ''
let keyTime = 0
let typing = '' // letras escritas seguidas (se muestran como texto)

const CLICK_MS = 550
const KEY_MS = 1400

api.on('recorder:input', (ev: InputEvent) => {
  const now = performance.now()
  if (ev.type === 'click') {
    clicks.push({ x: ev.x, y: ev.y, button: ev.button, t: now })
  } else if (ev.combo) {
    typing = ''
    keyLabel = ev.label
    keyTime = now
  } else {
    // Si se sigue escribiendo, se acumula (como mucho los últimos 24 caracteres)
    typing = now - keyTime < KEY_MS && !keyLabel.includes('+') ? (typing + ev.label).slice(-24) : ev.label
    keyLabel = typing
    keyTime = now
  }
})

function drawOverlays(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const now = performance.now()
  const unit = Math.max(1, Math.min(w, h) / 700)
  // Clics: círculo que se expande y se desvanece (amarillo = izquierdo, azul = derecho)
  for (let i = clicks.length - 1; i >= 0; i--) {
    const c = clicks[i]
    const p = (now - c.t) / CLICK_MS
    if (p >= 1) {
      clicks.splice(i, 1)
      continue
    }
    const rgb = c.button === 'right' ? '91,124,250' : c.button === 'middle' ? '47,211,107' : '255,200,0'
    ctx.save()
    ctx.beginPath()
    ctx.arc(c.x, c.y, (10 + 26 * p) * unit, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${rgb},${0.35 * (1 - p)})`
    ctx.fill()
    ctx.lineWidth = 3 * unit
    ctx.strokeStyle = `rgba(${rgb},${0.95 * (1 - p)})`
    ctx.stroke()
    ctx.restore()
  }
  // Teclas: etiqueta abajo en el centro
  const age = now - keyTime
  if (keyLabel && age < KEY_MS) {
    const alpha = age > KEY_MS - 300 ? (KEY_MS - age) / 300 : 1
    const fs = Math.round(Math.max(16, Math.min(34, h * 0.045)))
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`
    const tw = ctx.measureText(keyLabel).width
    const padX = fs * 0.8
    const bw = tw + padX * 2
    const bh = fs * 1.9
    const bx = (w - bw) / 2
    const by = h - bh - fs * 1.2
    ctx.fillStyle = 'rgba(20,20,24,0.82)'
    ctx.beginPath()
    ctx.roundRect(bx, by, bw, bh, fs * 0.5)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(keyLabel, bx + padX, by + bh / 2)
    ctx.restore()
  }
}

// ---------- Vídeo ----------

/** Recorta la pantalla a la región y dibuja encima clics/teclas, a FPS constantes. */
async function composedVideo(screen: MediaStream, init: RecorderInit): Promise<MediaStreamTrack> {
  const { crop } = init
  const full = crop.x === 0 && crop.y === 0 && crop.width >= init.screenWidth - 1 && crop.height >= init.screenHeight - 1
  const overlays = init.clicks || init.keys
  if (full && !overlays) return screen.getVideoTracks()[0]

  const video = document.createElement('video')
  video.muted = true
  video.srcObject = new MediaStream(screen.getVideoTracks())
  await video.play()

  const canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d', { alpha: false })!
  const paint = () => {
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    if (overlays) drawOverlays(ctx, crop.width, crop.height)
  }

  // Generador de pista: cada fotograma se crea con su marca de tiempo exacta, sin depender del
  // compositor (canvas.captureStream pierde fotogramas si la ventana está ocupada o la pantalla quieta)
  type Generator = MediaStreamTrack & { writable: WritableStream<VideoFrame> }
  const Gen = (window as unknown as { MediaStreamTrackGenerator?: new (o: { kind: 'video' }) => Generator }).MediaStreamTrackGenerator
  let track: MediaStreamTrack
  let draw: () => void
  if (Gen && typeof VideoFrame !== 'undefined') {
    const gen = new Gen({ kind: 'video' })
    const writer = gen.writable.getWriter()
    const t0 = performance.now()
    draw = () => {
      paint()
      // Si el codificador va atrasado se descarta este fotograma en lugar de acumularlos
      if ((writer.desiredSize ?? 1) <= 0) return
      const frame = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - t0) * 1000) })
      writer.write(frame).catch(() => frame.close())
    }
    track = gen
  } else {
    const t = canvas.captureStream(0).getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
    let n = 0
    draw = () => {
      paint()
      // Con la pantalla quieta Chromium no emite fotogramas: se cambia un píxel de forma imperceptible
      ctx.fillStyle = `rgba(0,0,0,${(n++ % 2) * 0.004})`
      ctx.fillRect(0, 0, 1, 1)
      t.requestFrame?.()
    }
    track = t
  }
  // Un intervalo fijo (y no solo "cuando cambia la pantalla") para que las animaciones de
  // clics y teclas se vean fluidas aunque la pantalla esté quieta
  const id = window.setInterval(draw, 1000 / FPS)
  stopDrawing = () => {
    clearInterval(id)
    video.srcObject = null
  }
  draw()
  return track
}

function mixAudio(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  if (tracks.length === 0) return null
  if (tracks.length === 1) return tracks[0]
  audioCtx = new AudioContext()
  const dest = audioCtx.createMediaStreamDestination()
  for (const t of tracks) audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest)
  return dest.stream.getAudioTracks()[0]
}

function pickMime(hasAudio: boolean): string {
  // VP8 primero: es mucho más ligero que VP9 y no pierde fotogramas aunque el equipo esté cargado
  const candidates = hasAudio
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
}

function releaseAll(): void {
  stopDrawing()
  for (const s of streams) for (const t of s.getTracks()) t.stop()
  streams = []
  void audioCtx?.close()
  clearInterval(tickTimer)
}

async function start(): Promise<void> {
  const init = await api.invoke('recorder:init')
  if (!init) return api.send('recorder:cancel')

  const screen = await desktopStream(init.sourceId, init.screenWidth, init.screenHeight, { audio: init.sysAudio, fps: FPS })
  streams.push(screen)
  const audioTracks = [...screen.getAudioTracks()]

  if (init.mic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streams.push(mic)
      audioTracks.push(...mic.getAudioTracks())
    } catch (err) {
      console.warn('Sin micrófono', err)
    }
  }
  audioInfo.innerHTML =
    (init.mic ? icons.mic : '') + (init.sysAudio ? icons.speaker : '') + (init.clicks ? icons.cursorClick : '') + (init.keys ? icons.keyboard : '')

  const videoTrack = await composedVideo(screen, init)
  const audioTrack = mixAudio(audioTracks)
  const out = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack])

  const pixels = init.crop.width * init.crop.height
  recorder = new MediaRecorder(out, {
    mimeType: pickMime(!!audioTrack),
    videoBitsPerSecond: Math.min(25_000_000, Math.max(4_000_000, Math.round(pixels * FPS * 0.12)))
  })
  // Cada segundo se envía el trozo grabado y el proceso principal lo añade al archivo: así la
  // grabación no se acumula en memoria. La cadena mantiene el orden de los trozos.
  recorder.ondataavailable = (e) => {
    if (!e.data.size || discarded) return
    const blob = e.data
    sending = sending.then(async () => api.send('recorder:chunk', new Uint8Array(await blob.arrayBuffer())))
  }
  recorder.onstop = async () => {
    releaseAll()
    if (discarded) return api.send('recorder:cancel')
    try {
      await sending
      await api.invoke('recorder:done')
    } catch (err) {
      api.send('recorder:error', `No se pudo guardar la grabación: ${String((err as Error)?.message ?? err)}`)
    }
  }
  recorder.start(1000)
  bar.classList.remove('starting')
  lastTick = performance.now()
  tickTimer = window.setInterval(tick, 250)
}

// Tras pulsar «Detener» el grabador pasa a «inactive» al instante, pero el vídeo aún se está
// guardando: una segunda pulsación (o el atajo) no debe tomarse como «cancelar»
let stopping = false

function stop(): void {
  if (stopping) return
  if (!recorder || recorder.state === 'inactive') {
    releaseAll()
    api.send('recorder:cancel')
    return
  }
  stopping = true
  bar.classList.add('saving')
  tick()
  recorder.stop()
}

pauseBtn.addEventListener('click', () => {
  if (!recorder) return
  if (recorder.state === 'recording') {
    tick()
    recorder.pause()
    bar.classList.add('paused')
    pauseBtn.innerHTML = icons.play
    pauseBtn.title = 'Reanudar'
  } else if (recorder.state === 'paused') {
    recorder.resume()
    lastTick = performance.now()
    bar.classList.remove('paused')
    pauseBtn.innerHTML = icons.pause
    pauseBtn.title = 'Pausar'
  }
})

$('#stop').addEventListener('click', stop)
$('#discard').addEventListener('click', () => {
  if (stopping) return // ya se está guardando
  discarded = true
  stop()
})

api.on('recorder:stop', stop)

start().catch((err) => {
  releaseAll()
  api.send('recorder:error', String(err?.message ?? err))
})
