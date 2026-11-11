import type { PreviewData } from '../../shared/types'
import { $, api } from '../shared/api'
import { icons } from '../shared/icons'

const card = $('#card')
const media = $('#media')
const actions = $('#actions')
const center = $('.center')
const status = $('#status')

type Data = PreviewData & { info?: string; autoClose?: number }
let data: Data | null = null
let timer: number | undefined
let statusTimer: number | undefined

$('#close').innerHTML = icons.close
$('#folder').innerHTML = icons.folder

function close(direction = 0): void {
  card.classList.remove('in')
  if (direction) card.style.transform = `translateX(${direction * 120}%)`
  setTimeout(() => api.send('preview:close'), 160)
}

function armTimer(): void {
  clearTimeout(timer)
  // Los vídeos no se cierran solos (se perderían si no se guardan); las imágenes, según Ajustes
  if (data?.kind === 'image' && data.autoClose) timer = window.setTimeout(close, data.autoClose * 1000)
}

function flash(text: string): void {
  status.textContent = text
  status.classList.add('show')
  clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => status.classList.remove('show'), 1800)
}

function render(d: Data): void {
  data = d
  $('#info').textContent = d.info ?? ''
  if (d.kind === 'image') {
    media.innerHTML = `<img src="${d.src}" alt="Captura" />`
    center.innerHTML = `
      <button class="btn" data-act="edit">Editar</button>
      <button class="btn" data-act="copy">Copiar</button>
      <button class="btn" data-act="save">Guardar</button>
      <button class="btn" data-act="pin" title="Deja la captura flotando encima de todo">Anclar</button>`
  } else {
    media.innerHTML = `<video src="${d.src}" autoplay muted loop playsinline></video>`
    center.innerHTML = `<button class="btn" data-act="play">Editar y recortar</button>
      <button class="btn" data-act="save">Guardar vídeo…</button>`
  }
  card.classList.remove('in')
  requestAnimationFrame(() => card.classList.add('in'))
  armTimer()
}

card.addEventListener('mouseenter', () => clearTimeout(timer))
card.addEventListener('mouseleave', armTimer)

$('#close').addEventListener('click', () => close())

// Deslizar a un lado (rueda horizontal o gesto del panel táctil) para cerrar
let swipe = 0
window.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    swipe += e.deltaX
    if (Math.abs(swipe) > 120) close(Math.sign(swipe))
  },
  { passive: true }
)
$('#folder').addEventListener('click', () => api.send('preview:folder'))

center.addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act
  if (act === 'edit') api.send('preview:edit')
  else if (act === 'pin') api.send('preview:pin')
  else if (act === 'play') {
    clearTimeout(timer)
    api.send('preview:play')
  }
  else if (act === 'copy') {
    await api.invoke('preview:copy')
    flash('Copiada al portapapeles')
  } else if (act === 'save') {
    const file = await api.invoke('preview:save')
    if (file) {
      flash('Guardado')
      setTimeout(close, 900)
    }
  }
})

// Doble clic: abrir el vídeo en el reproductor (o la imagen en el editor)
actions.addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('button')) return
  clearTimeout(timer)
  api.send('preview:open')
})

// Arrastrar la captura a otra aplicación (correo, chat, carpeta…)
actions.addEventListener('dragstart', (e) => {
  e.preventDefault()
  api.send('preview:drag')
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close()
  else if (e.key.toLowerCase() === 'z' && e.ctrlKey) api.send('preview:restore')
})

api.on('preview:data', (d: Data) => render(d))
