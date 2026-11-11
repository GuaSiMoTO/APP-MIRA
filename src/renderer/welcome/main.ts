import { $, api } from '../shared/api'
import { icons } from '../shared/icons'

const card = $('#card')
const SHOW_MS = 6000
let timer: number | undefined

$('#close').innerHTML = icons.close

function close(): void {
  card.classList.remove('in')
  setTimeout(() => api.send('welcome:close'), 220)
}

function arm(): void {
  clearTimeout(timer)
  timer = window.setTimeout(close, SHOW_MS)
}

api.on('welcome:data', (d: { icon: string; wordmark: string; hotkey: string }) => {
  $<HTMLImageElement>('#logo').src = d.icon
  $<HTMLImageElement>('#wordmark').src = d.wordmark
  // Solo el atajo: cada tecla en su recuadro ("Ctrl" + "Mayús" + "S")
  $('#keys').innerHTML = d.hotkey
    ? d.hotkey
        .split('+')
        .map((k) => `<kbd>${k.trim()}</kbd>`)
        .join('<span>+</span>')
    : '<span>Haz clic en el icono junto al reloj</span>'
  requestAnimationFrame(() => card.classList.add('in'))
  arm()
})

card.addEventListener('mouseenter', () => clearTimeout(timer))
card.addEventListener('mouseleave', arm)
card.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('#close')) return close()
  api.send('welcome:click')
})
