import type { HistoryItem } from '../../shared/types'
import { $, api } from '../shared/api'
import { logoImg } from '../shared/brand'
import { icons } from '../shared/icons'

type Item = HistoryItem & { thumbUrl: string; fileUrl: string }

document.querySelector('header')!.insertAdjacentHTML('afterbegin', logoImg())
const list = $('#list')
let items: Item[] = []
let filter: 'all' | Item['kind'] = 'all'
let query = ''
let toastTimer: number | undefined

const KIND: Record<Item['kind'], [string, string]> = {
  image: ['Imagen', icons.camera],
  video: ['Vídeo', icons.video],
  text: ['Texto', icons.textScan]
}

function toast(msg: string): void {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (t.hidden = true), 1800)
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Ayer'
  const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function render(): void {
  const q = query.trim().toLowerCase()
  const shown = items.filter((i) => (filter === 'all' || i.kind === filter) && (!q || (i.text ?? '').toLowerCase().includes(q)))
  $('#count').textContent = `${items.length} ${items.length === 1 ? 'elemento' : 'elementos'} · se guardan 30 días`
  if (!shown.length) {
    list.innerHTML = `<div id="empty">${
      items.length ? 'No hay nada que coincida con el filtro.' : 'Aún no hay capturas.<br>Todo lo que captures, grabes o copies como texto aparecerá aquí durante 30 días.'
    }</div>`
    return
  }
  const groups = new Map<string, Item[]>()
  for (const i of shown) {
    const k = dayLabel(i.date)
    groups.set(k, [...(groups.get(k) ?? []), i])
  }
  list.innerHTML = [...groups]
    .map(
      ([day, its]) => `<h2>${day}</h2><div class="grid">${its
        .map((i) => {
          const time = new Date(i.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          const dims = i.width ? `${i.width}×${i.height}` : ''
          const canCopy = i.kind !== 'video'
          return `<div class="card" data-id="${i.id}" title="Doble clic para abrir">
            <div class="thumb">${i.thumbUrl ? `<img src="${i.thumbUrl}" alt="" loading="lazy" />` : KIND[i.kind][1]}</div>
            <span class="badge">${KIND[i.kind][1]}${i.source !== KIND[i.kind][0] ? esc(i.source) : KIND[i.kind][0]}</span>
            <div class="actions">
              <button data-act="open" title="${i.kind === 'video' ? 'Abrir en el editor de vídeo' : 'Abrir en el editor'}">${icons.edit}</button>
              ${canCopy ? `<button data-act="copy" title="${i.kind === 'text' ? 'Copiar el texto' : 'Copiar la imagen'}">${icons.copy}</button>` : ''}
              <button data-act="save" title="Guardar como…">${icons.save}</button>
              ${i.kind === 'image' ? `<button data-act="pin" title="Anclar en la pantalla">${icons.pin}</button>` : ''}
              <button data-act="reveal" title="Mostrar en la carpeta">${icons.folder}</button>
              <button data-act="delete" class="del" title="Borrar del historial">${icons.trash}</button>
            </div>
            ${i.text ? `<div class="snippet">${esc(i.text.split('\n')[0])}</div>` : ''}
            <div class="info"><span>${time}${dims ? ` · ${dims}` : ''}</span><span>${i.kind === 'text' ? `${i.text?.length ?? 0} caract.` : size(i.bytes)}</span></div>
          </div>`
        })
        .join('')}</div>`
    )
    .join('')
}

async function reload(): Promise<void> {
  items = await api.invoke('history:list')
  render()
}

list.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]')
  const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
  if (!b || !card) return
  const id = card.dataset.id!
  const act = b.dataset.act
  if (act === 'open') api.send('history:open', id)
  else if (act === 'copy') {
    if (await api.invoke('history:copy', id)) toast('Copiado al portapapeles')
  } else if (act === 'save') {
    const f = await api.invoke('history:save', id)
    if (f) toast('Guardado')
  } else if (act === 'pin') api.send('history:pin', id)
  else if (act === 'reveal') api.send('history:reveal', id)
  else if (act === 'delete') {
    await api.invoke('history:delete', [id])
    await reload()
    toast('Borrado del historial')
  }
})
list.addEventListener('dblclick', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
  if (card?.dataset.id && !(e.target as HTMLElement).closest('[data-act]')) api.send('history:open', card.dataset.id)
})

$('#filter').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-f]')
  if (!b) return
  filter = b.dataset.f as typeof filter
  for (const x of document.querySelectorAll('#filter button')) x.classList.toggle('active', x === b)
  render()
})
$<HTMLInputElement>('#search').addEventListener('input', (e) => {
  query = (e.target as HTMLInputElement).value
  render()
})
$('#clear').addEventListener('click', async () => {
  if (await api.invoke('history:clear')) {
    await reload()
    toast('Historial vaciado')
  }
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})

api.on('history:changed', () => void reload())
void reload()
