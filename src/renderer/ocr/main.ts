import { $, api } from '../shared/api'
import { icons } from '../shared/icons'

type State =
  | { status: 'loading' }
  | { status: 'done'; text: string; lang?: string; copied: boolean; qr?: string | null }
  | { status: 'error'; error: string }

const card = $('#card')
const status = $('#status')
const loading = $('#loading')
const text = $<HTMLTextAreaElement>('#text')
const copyBtn = $<HTMLButtonElement>('#copy')

$('#ico').innerHTML = icons.textScan
$('#close').innerHTML = icons.close

function close(): void {
  card.classList.remove('in')
  setTimeout(() => api.send('ocr:close'), 160)
}

function setStatus(msg: string, kind: '' | 'ok' | 'err' = ''): void {
  status.textContent = msg
  status.className = kind
}

function render(s: State): void {
  requestAnimationFrame(() => card.classList.add('in'))
  loading.hidden = s.status !== 'loading'
  const qr = s.status === 'done' ? s.qr : null
  $('#qr').hidden = !qr
  if (qr) {
    $('#qr-text').textContent = qr
    $('#qr-text').title = qr
    $('#qr-open').hidden = !/^https?:\/\//i.test(qr)
  }
  text.hidden = s.status === 'loading'
  copyBtn.disabled = s.status !== 'done' || !s.text
  if (s.status === 'loading') {
    setStatus('')
  } else if (s.status === 'error') {
    text.value = ''
    text.hidden = true
    setStatus(s.error, 'err')
  } else {
    text.value = s.text
    if (!s.text && s.qr) {
      text.hidden = true
      setStatus('✓ Contenido del QR copiado al portapapeles', 'ok')
    } else if (!s.text) {
      text.placeholder = 'No se ha encontrado texto en la zona seleccionada.'
      setStatus('Sin texto', 'err')
    } else {
      const lines = s.text.split('\n').length
      setStatus(`✓ Copiado al portapapeles · ${lines} ${lines === 1 ? 'línea' : 'líneas'}${s.lang ? ` · ${s.lang}` : ''}`, 'ok')
      text.focus()
      text.setSelectionRange(0, 0)
    }
  }
}

copyBtn.addEventListener('click', async () => {
  // Si hay una parte seleccionada, se copia solo esa
  const sel = text.value.slice(text.selectionStart, text.selectionEnd)
  await api.invoke('ocr:copy', sel || text.value)
  setStatus(sel ? '✓ Selección copiada' : '✓ Copiado al portapapeles', 'ok')
})
$('#qr-copy').addEventListener('click', async () => {
  await api.invoke('ocr:copy', $('#qr-text').textContent ?? '')
  setStatus('✓ Contenido del QR copiado', 'ok')
})
$('#qr-open').addEventListener('click', () => api.send('ocr:open-url', $('#qr-text').textContent ?? ''))
$('#close').addEventListener('click', close)
$('#close2').addEventListener('click', close)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close()
})

api.on('ocr:state', (s: State) => render(s))
