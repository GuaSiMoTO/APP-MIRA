import { $, api } from '../shared/api'
import { bytesUrl } from '../shared/bytes'
import { icons } from '../shared/icons'

const img = $<HTMLImageElement>('#img')
const badge = $('#badge')
$('#copy').innerHTML = icons.copy
$('#edit').innerHTML = icons.edit
$('#close').innerHTML = icons.close

let badgeTimer: number | undefined
function flash(text: string): void {
  badge.textContent = text
  badge.classList.add('show')
  clearTimeout(badgeTimer)
  badgeTimer = window.setTimeout(() => badge.classList.remove('show'), 1200)
}

// Arrastrar para mover (se mueve la ventana desde el proceso principal)
let drag: { x: number; y: number } | null = null
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
  drag = { x: e.screenX, y: e.screenY }
  document.body.setPointerCapture(e.pointerId)
  document.body.classList.add('dragging')
})
window.addEventListener('pointermove', (e) => {
  if (!drag) return
  const dx = e.screenX - drag.x
  const dy = e.screenY - drag.y
  if (dx || dy) {
    api.send('pin:move', dx, dy)
    drag = { x: e.screenX, y: e.screenY }
  }
})
window.addEventListener('pointerup', () => {
  drag = null
  document.body.classList.remove('dragging')
})

// Rueda: tamaño · Ctrl + rueda: opacidad
window.addEventListener(
  'wheel',
  async (e) => {
    e.preventDefault()
    if (e.ctrlKey) {
      const o = await api.invoke('pin:opacity', e.deltaY < 0 ? 0.1 : -0.1)
      flash(`Opacidad ${Math.round(o * 100)} %`)
    } else {
      api.send('pin:zoom', e.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
  },
  { passive: false }
)

window.addEventListener('dblclick', (e) => {
  if (!(e.target as HTMLElement).closest('button')) api.send('pin:edit')
})
window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  api.send('pin:menu')
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.send('pin:close')
  else if (e.key === '0' && e.ctrlKey) api.send('pin:reset')
  else if (e.key.toLowerCase() === 'c' && e.ctrlKey) {
    void api.invoke('pin:copy')
    flash('Copiada')
  }
})

$('#close').addEventListener('click', () => api.send('pin:close'))
$('#edit').addEventListener('click', () => api.send('pin:edit'))
$('#copy').addEventListener('click', async () => {
  await api.invoke('pin:copy')
  flash('Copiada')
})

void api.invoke('pin:get').then((bytes) => {
  if (bytes) img.src = bytesUrl(bytes)
  flash('Rueda: tamaño · Ctrl + rueda: opacidad')
})
