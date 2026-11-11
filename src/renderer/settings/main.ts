import { prettyAccelerator, type HotkeyId } from '../../shared/hotkeys'
import type { SettingsView } from '../../shared/ipc'
import type { Settings } from '../../shared/types'
import { $, api } from '../shared/api'
import { logoImg } from '../shared/brand'


document.querySelector('h1')!.insertAdjacentHTML('afterbegin', logoImg('big'))
const msg = $('#msg')
let settings: SettingsView
let listening: HotkeyId | null = null

const pretty = prettyAccelerator
const names: Record<HotkeyId, string> = { hotkey: 'Capturar', hotkeyRepeat: 'Repetir última región', hotkeyText: 'Copiar texto' }

function render(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.hk')) {
    const id = b.dataset.id as HotkeyId
    const value = settings[id]
    b.textContent = listening === id ? 'Pulsa la combinación…' : value ? pretty(value) : 'Sin atajo'
    b.classList.toggle('listening', listening === id)
    b.classList.toggle('off', !value)
  }
  $('#dir').textContent = settings.saveDir
  $('#dir').title = settings.saveDir
  $<HTMLSelectElement>('#format').value = settings.format
  for (const k of ['autoCopy', 'autoSave', 'launchAtLogin', 'previewEnabled'] as const) $<HTMLInputElement>(`#${k}`).checked = settings[k]
  $<HTMLSelectElement>('#previewPosition').value = settings.previewPosition
  $<HTMLSelectElement>('#previewSize').value = settings.previewSize
  $<HTMLSelectElement>('#previewAutoClose').value = String(settings.previewAutoClose)
  if (!listening) {
    const broken = (Object.keys(settings.hotkeyStatus) as HotkeyId[]).filter((id) => !settings.hotkeyStatus[id])
    msg.textContent = broken.length ? `No activo (otra aplicación lo usa): ${broken.map((id) => names[id]).join(', ')}` : ''
  }
}

async function update(patch: Partial<Settings>): Promise<boolean> {
  const res = await api.invoke('settings:set', patch)
  settings = res.settings
  render()
  return res.hotkeyOk
}

const keyMap: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
  Escape: 'Escape'
}

function stopListening(): void {
  listening = null
  api.send('settings:suspend-hotkey', false)
  render()
}

for (const b of document.querySelectorAll<HTMLButtonElement>('.hk')) {
  b.addEventListener('click', () => {
    listening = b.dataset.id as HotkeyId
    api.send('settings:suspend-hotkey', true)
    msg.textContent = 'Pulsa la combinación (por ejemplo Ctrl + Mayús + S). Esc para cancelar.'
    render()
  })
  b.addEventListener('blur', () => listening && stopListening())
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-clear]')) {
  b.addEventListener('click', () => update({ [b.dataset.clear as HotkeyId]: '' }))
}

window.addEventListener('keydown', async (e) => {
  if (!listening) return
  e.preventDefault()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
  if (e.key === 'Escape') return stopListening()
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[]
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const isFKey = /^F\d{1,2}$/.test(key)
  if (!mods.length && !isFKey && key !== 'PrintScreen') {
    msg.textContent = 'Usa al menos Ctrl o Alt (o una tecla F1–F12 / Impr Pant).'
    return
  }
  const acc = [...mods, key].join('+')
  const id = listening
  const other = (Object.keys(names) as HotkeyId[]).find((k) => k !== id && settings[k] === acc)
  if (other) {
    msg.textContent = `${pretty(acc)} ya se usa para «${names[other]}».`
    return
  }
  listening = null
  // Se reactivan los atajos actuales antes de intentar el nuevo
  api.send('settings:suspend-hotkey', false)
  const ok = await update({ [id]: acc })
  msg.textContent = ok ? '' : `No se pudo usar ${pretty(acc)}: otra aplicación lo tiene reservado.`
})

$('#choose').addEventListener('click', async () => {
  const dir = await api.invoke('settings:choose-dir')
  if (dir) await update({ saveDir: dir })
})
$('#format').addEventListener('change', (e) => update({ format: (e.target as HTMLSelectElement).value as 'png' | 'jpg' }))
$('#previewPosition').addEventListener('change', (e) => update({ previewPosition: (e.target as HTMLSelectElement).value as 'left' | 'right' }))
$('#previewSize').addEventListener('change', (e) => update({ previewSize: (e.target as HTMLSelectElement).value as 's' | 'm' | 'l' }))
$('#previewAutoClose').addEventListener('change', (e) => update({ previewAutoClose: Number((e.target as HTMLSelectElement).value) }))
for (const k of ['autoCopy', 'autoSave', 'launchAtLogin', 'previewEnabled'] as const)
  $(`#${k}`).addEventListener('change', (e) => update({ [k]: (e.target as HTMLInputElement).checked }))

void api.invoke('settings:get').then((s) => {
  settings = s
  render()
})
