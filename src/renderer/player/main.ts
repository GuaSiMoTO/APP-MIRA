import type { ExportOptions } from '../../shared/types'
import { $, api } from '../shared/api'
import { logoImg } from '../shared/brand'
import { icons } from '../shared/icons'

type Format = 'mp4' | 'gif' | 'webm'

const video = $<HTMLVideoElement>('#video')
const timeline = $('#timeline')
const range = $('#range')
const shadeL = $('#shade-l')
const shadeR = $('#shade-r')
const playhead = $('#playhead')
const note = $('#note')

$('#bar').insertAdjacentHTML('afterbegin', logoImg())
$('#close').innerHTML = icons.close
$('#big-play').innerHTML = icons.play
$('#play').innerHTML = icons.play

let duration = 0
let start = 0
let end = 0
let format: Format = 'mp4'
let exporting = false

const fmtTime = (s: number, ms = false) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${(ms ? sec.toFixed(1) : Math.floor(sec).toString()).padStart(ms ? 4 : 2, '0')}`
}

// ---------- Línea de tiempo ----------

function render(): void {
  if (!duration) return
  const a = (start / duration) * 100
  const b = (end / duration) * 100
  range.style.left = `${a}%`
  range.style.width = `${b - a}%`
  shadeL.style.width = `${a}%`
  shadeR.style.width = `${100 - b}%`
  playhead.style.left = `${(video.currentTime / duration) * 100}%`
  $('#time').textContent = `${fmtTime(video.currentTime)} / ${fmtTime(duration)}`
  const trimmed = start > 0.05 || end < duration - 0.05
  $('#trim-info').textContent = trimmed ? `Fragmento: ${fmtTime(start, true)} – ${fmtTime(end, true)} (${(end - start).toFixed(1)} s)` : 'Sin recortar'
  $<HTMLButtonElement>('#reset-trim').disabled = !trimmed
}

function timeAt(clientX: number): number {
  const r = timeline.getBoundingClientRect()
  return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
}

let dragging: 'start' | 'end' | 'seek' | null = null
timeline.addEventListener('pointerdown', (e) => {
  if (!duration) return
  const t = e.target as HTMLElement
  dragging = t.id === 'h-start' ? 'start' : t.id === 'h-end' ? 'end' : 'seek'
  timeline.setPointerCapture(e.pointerId)
  move(e.clientX)
})
timeline.addEventListener('pointermove', (e) => dragging && move(e.clientX))
timeline.addEventListener('pointerup', () => (dragging = null))

function move(x: number): void {
  const t = timeAt(x)
  const MIN = 0.2
  if (dragging === 'start') {
    start = Math.min(t, end - MIN)
    video.currentTime = start
  } else if (dragging === 'end') {
    end = Math.max(t, start + MIN)
    video.currentTime = end
  } else {
    video.currentTime = t
  }
  render()
}

/** Miniaturas a lo largo de la línea de tiempo (con un segundo vídeo para no mover el principal). */
async function buildStrip(src: string): Promise<void> {
  const n = Math.max(4, Math.floor(timeline.clientWidth / 90))
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous' // para poder leer los fotogramas en un canvas
  v.muted = true
  v.preload = 'auto'
  v.src = src
  v.load()
  await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }))
  const c = document.createElement('canvas')
  c.height = 90
  c.width = Math.round((90 * v.videoWidth) / Math.max(1, v.videoHeight))
  const ctx = c.getContext('2d')!
  const strip = $('#strip')
  strip.innerHTML = ''
  for (let i = 0; i < n; i++) {
    v.currentTime = ((i + 0.5) / n) * duration
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
    ctx.drawImage(v, 0, 0, c.width, c.height)
    const img = document.createElement('img')
    img.src = c.toDataURL('image/jpeg', 0.7)
    strip.appendChild(img)
  }
  v.removeAttribute('src')
}

// ---------- Reproducción (en bucle dentro del fragmento) ----------

function togglePlay(): void {
  if (video.paused) {
    if (video.currentTime < start || video.currentTime >= end - 0.05) video.currentTime = start
    void video.play()
  } else video.pause()
}

function tick(): void {
  if (!video.paused && video.currentTime >= end) video.currentTime = start
  render()
  if (!video.paused) requestAnimationFrame(tick)
}

video.addEventListener('play', () => {
  document.body.classList.add('playing')
  $('#play').innerHTML = icons.pause
  requestAnimationFrame(tick)
})
video.addEventListener('pause', () => {
  document.body.classList.remove('playing')
  $('#play').innerHTML = icons.play
  render()
})
video.addEventListener('seeked', render)
video.addEventListener('click', togglePlay)
$('#play').addEventListener('click', togglePlay)
$('#big-play').addEventListener('click', togglePlay)

$('#set-start').addEventListener('click', () => {
  start = Math.min(video.currentTime, end - 0.2)
  render()
})
$('#set-end').addEventListener('click', () => {
  end = Math.max(video.currentTime, start + 0.2)
  render()
})
$('#reset-trim').addEventListener('click', () => {
  start = 0
  end = duration
  render()
})

// ---------- Opciones de exportación ----------

function fillSelects(): void {
  const h = video.videoHeight
  const res = $<HTMLSelectElement>('#res')
  res.innerHTML =
    `<option value="">Original (${video.videoWidth}×${h})</option>` +
    [1080, 720, 480, 360].filter((v) => v < h).map((v) => `<option value="${v}">${v}p</option>`).join('')
  const fps = $<HTMLSelectElement>('#fps')
  fps.innerHTML =
    format === 'gif'
      ? '<option value="20">20</option><option value="15" selected>15</option><option value="10">10</option>'
      : '<option value="">Original</option><option value="30">30</option><option value="24">24</option><option value="15">15</option>'
  if (format === 'gif' && !res.value && h > 720) res.value = '720' // los GIF grandes pesan muchísimo
}

$('#fmt').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]')
  if (!b) return
  format = b.dataset.fmt as Format
  for (const x of document.querySelectorAll('#fmt button')) x.classList.toggle('active', x === b)
  fillSelects()
})

api.on('player:progress', (p: number) => {
  $('#progress-bar').style.width = `${Math.round(p * 100)}%`
  $('#progress-text').textContent = `Exportando… ${Math.round(p * 100)} %`
})

$('#do-export').addEventListener('click', async () => {
  if (exporting) return
  exporting = true
  video.pause()
  const btn = $<HTMLButtonElement>('#do-export')
  btn.disabled = true
  $('#progress').hidden = false
  $('#progress-bar').style.width = '0%'
  $('#progress-text').textContent = 'Exportando…'
  note.textContent = ''
  note.className = ''
  const res = $<HTMLSelectElement>('#res').value
  const fps = $<HTMLSelectElement>('#fps').value
  try {
    const file = await api.invoke('player:export', {
      format,
      start,
      end,
      height: res ? Number(res) : null,
      fps: fps ? Number(fps) : null,
      quality: $<HTMLSelectElement>('#quality').value as ExportOptions['quality']
    })
    if (file) {
      note.textContent = `✓ Guardado: ${file}`
      note.className = 'ok'
    }
  } finally {
    exporting = false
    btn.disabled = false
    $('#progress').hidden = true
  }
})

// ---------- Ventana y teclado ----------

$('#close').addEventListener('click', () => api.send('player:close'))
$('#bar').addEventListener('dblclick', (e) => {
  if (!(e.target as HTMLElement).closest('button')) api.send('player:maximize')
})
window.addEventListener('keydown', (e) => {
  const target = e.target
  if (target instanceof HTMLElement && target.closest('select, input')) return
  const k = e.key.toLowerCase()
  if (e.key === 'Escape') api.send('player:close')
  else if (e.key === ' ') {
    e.preventDefault()
    togglePlay()
  } else if (k === 'i') $('#set-start').click()
  else if (k === 'o') $('#set-end').click()
  else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 5 : 1 / 30))
  else if (e.key === 'ArrowRight') video.currentTime = Math.min(duration, video.currentTime + (e.shiftKey ? 5 : 1 / 30))
})

// ---------- Arranque ----------

void api.invoke('player:get').then(async (d) => {
  if (!d) return
  $('#name').textContent = d.name
  document.title = d.name
  video.src = d.src
  await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }))
  // Los WebM sin duración en la cabecera se resuelven saltando al final
  if (!isFinite(video.duration)) {
    video.currentTime = 1e9
    await new Promise((r) => video.addEventListener('durationchange', r, { once: true }))
    video.currentTime = 0
  }
  duration = video.duration
  end = duration
  $('#meta').textContent = `${video.videoWidth}×${video.videoHeight} · ${fmtTime(duration, true)} s`
  fillSelects()
  render()
  if (!d.ffmpeg) {
    $<HTMLButtonElement>('#do-export').disabled = true
    note.textContent = 'La exportación necesita ffmpeg, que no está disponible en esta instalación.'
  }
  void buildStrip(d.src)
})
