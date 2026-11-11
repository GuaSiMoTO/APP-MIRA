import { $, api } from '../shared/api'
import { desktopStream, nextFrame } from '../shared/desktop'
import { icons } from '../shared/icons'
import { Stitcher, type Frame } from './stitch'

const status = $('#status')
const sub = $('#sub')
const modeBtn = $<HTMLButtonElement>('#mode')
$('#ico').innerHTML = icons.scroll
$('#done').innerHTML = `${icons.check}<span>Terminar</span>`
$('#cancel').innerHTML = icons.close

const MAX_HEIGHT = 20000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let auto = true
let finished = false
let cancelled = false
let stream: MediaStream | null = null

function setMode(a: boolean): void {
  auto = a
  modeBtn.textContent = a ? 'Pausar auto' : 'Reanudar auto'
  sub.textContent = a ? 'Se desplaza sola · no toques el ratón' : 'Desplázate tú con la rueda'
}

async function run(): Promise<void> {
  const init = await api.invoke('scroll:init')
  if (!init) return api.send('scroll:cancel')
  const { crop } = init
  stream = await desktopStream(init.sourceId, init.screenWidth, init.screenHeight, { fps: 30 })
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  await video.play()
  const canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const grab = async (): Promise<Frame> => {
    await nextFrame(video)
    await nextFrame(video)
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const d = ctx.getImageData(0, 0, crop.width, crop.height)
    return { width: d.width, height: d.height, data: d.data }
  }

  const st = new Stitcher(crop.width, crop.height)
  st.add(await grab())
  // Se empieza con una muesca para medir cuántos píxeles mueve cada una
  let notches = 1
  let pxPerNotch = 0
  let still = 0
  let failures = 0

  while (!finished && !cancelled) {
    status.textContent = `Capturando… ${st.height.toLocaleString('es-ES')} px`
    if (auto) {
      await api.invoke('scroll:wheel', notches)
      await sleep(380) // dejar que termine el desplazamiento suave
    } else {
      await sleep(250)
    }
    const dy = st.add(await grab())
    if (dy > 0) {
      still = 0
      failures = 0
      // Ajustar la rueda para avanzar ~el 60 % de la región en cada paso (buen solapamiento)
      if (auto) {
        pxPerNotch = pxPerNotch ? pxPerNotch * 0.5 + (dy / notches) * 0.5 : dy / notches
        notches = Math.min(10, Math.max(1, Math.floor((crop.height * 0.6) / pxPerNotch)))
      }
    } else if (dy === 0) {
      // Sin cambios: en automático, dos seguidos = final de la página
      if (auto && ++still >= 2) break
    } else if (++failures >= 3) {
      sub.textContent = 'El contenido cambia demasiado para unirlo; se guarda lo capturado'
      break
    }
    if (st.height >= MAX_HEIGHT) {
      sub.textContent = 'Se alcanzó el máximo de 20 000 px'
      break
    }
  }

  stream.getTracks().forEach((t) => t.stop())
  if (cancelled) return
  status.textContent = 'Uniendo…'
  const out = st.result()
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
  if (!blob) return api.send('scroll:error', 'No se pudo generar la imagen.')
  await api.invoke('scroll:done', await blob.arrayBuffer())
}

modeBtn.addEventListener('click', () => setMode(!auto))
$('#done').addEventListener('click', () => (finished = true))
$('#cancel').addEventListener('click', () => {
  cancelled = true
  stream?.getTracks().forEach((t) => t.stop())
  api.send('scroll:cancel')
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#cancel').click()
  else if (e.key === 'Enter') finished = true
})
api.on('scroll:stop', () => (finished = true))

setMode(true)
run().catch((err) => {
  stream?.getTracks().forEach((t) => t.stop())
  api.send('scroll:error', String(err?.message ?? err))
})
