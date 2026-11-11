// HTML de la barra contextual. Funciones puras: reciben lo que necesitan y devuelven el HTML;
// qué bloque se muestra lo decide `ctxBarHtml` en main.ts.
import type { ArrowStyle, BubbleDir, CropRatio, Fillable, PaintMode, TextStyle } from './config'

export function paintIcon(m: PaintMode): string {
  const inner =
    m === 'stroke'
      ? '<rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>'
      : m === 'fill'
        ? '<rect x="4" y="5" width="16" height="14" rx="2.5" fill="currentColor" opacity=".85"/>'
        : '<rect x="4" y="5" width="16" height="14" rx="2.5" fill="currentColor" fill-opacity=".45" stroke="currentColor" stroke-width="2"/>'
  return `<svg viewBox="0 0 24 24">${inner}</svg>`
}

export const hintHtml = (hint: string) => `<span class="ctx-hint">${hint}</span>`

export const busyHtml = (text: string) => `<span class="ctx-hint"><span class="spin"></span>${text}</span>`

export function cropRatiosHtml(current: CropRatio): string {
  const opts: Array<[CropRatio, string]> = [
    ['free', 'Libre'],
    ['orig', 'Original'],
    ['1:1', '1:1'],
    ['4:3', '4:3'],
    ['16:9', '16:9'],
    ['9:16', '9:16']
  ]
  return `<span class="ctx-label">Proporción</span><div class="seg">${opts.map(([r, l]) => `<button data-cratio="${r}" class="${current === r ? 'active' : ''}">${l}</button>`).join('')}</div>`
}

export function cropToolHtml(current: CropRatio, hint: string): string {
  return `${cropRatiosHtml(current)}<span class="ctx-hint">${hint} · se pega a los bordes (Alt para soltarlo)</span>`
}

export function cropActiveHtml(current: CropRatio): string {
  return `${cropRatiosHtml(current)}<div class="sep"></div><span class="ctx-hint">Ajusta el área y pulsa Intro</span>
      <button class="btn primary" id="crop-apply">Aplicar recorte</button>
      <button class="btn" id="crop-cancel">Cancelar</button>`
}

/** Quitar objeto: rellenar con el entorno o con un color plano (null = automático). */
export function removeHtml(hint: string, mode: 'texture' | 'solid', solidColor: string | null): string {
  const solid = mode === 'solid'
  const colorPart = solidColor
    ? `<i class="chip solid" style="--c:${solidColor}"></i><button class="btn" data-solid-auto>Automático</button>`
    : '<span class="ctx-hint">automático (el del borde) · pulsa un color de la paleta para elegirlo</span>'
  return `
      <div class="seg">
        <button data-remove="texture" class="${!solid ? 'active' : ''}">Rellenar con el entorno</button>
        <button data-remove="solid" class="${solid ? 'active' : ''}">Color plano</button>
      </div>
      ${solid ? `<div class="sep"></div><span class="ctx-label">Color:</span>${colorPart}` : hintHtml(hint)}`
}

/** Estilos de texto y, en el bocadillo, hacia dónde apunta la colita. */
export function textHtml(hint: string, style: TextStyle, dir: BubbleDir): string {
  const styles: Array<[TextStyle, string]> = [
    ['plain', 'Simple'],
    ['outline', 'Contorno'],
    ['shadow', 'Sombra'],
    ['label', 'Fondo'],
    ['translucent', 'Translúcido'],
    ['bubble', 'Bocadillo'],
    ['pill', 'Píldora']
  ]
  const dirs: Array<[BubbleDir, string, string]> = [
    ['down', '↓', 'abajo'],
    ['up', '↑', 'arriba'],
    ['left', '←', 'izquierda'],
    ['right', '→', 'derecha']
  ]
  return `
      <div class="seg">${styles.map(([s, l]) => `<button data-tstyle="${s}" class="${style === s ? 'active' : ''}">${l}</button>`).join('')}</div>
      ${
        style === 'bubble'
          ? `<div class="sep"></div><span class="ctx-label">Colita:</span><div class="seg">${dirs
              .map(([d, a, l]) => `<button data-dir="${d}" class="${dir === d ? 'active' : ''}" title="Hacia ${l}">${a}</button>`)
              .join('')}</div>`
          : ''
      }
      ${hintHtml(hint)}`
}

export function spotlightHtml(hint: string, dim: number): string {
  return `
      <span class="ctx-label">Oscuridad</span>
      <input type="range" id="spot-dim" min="20" max="85" value="${Math.round(dim * 100)}" />
      ${hintHtml(hint)}`
}

export function magnifierHtml(hint: string, zoom: number): string {
  return `
      <span class="ctx-label">Aumento</span>
      <div class="seg">${[1.5, 2, 3].map((z) => `<button data-zoom="${z}" class="${zoom === z ? 'active' : ''}">×${String(z).replace('.', ',')}</button>`).join('')}</div>
      ${hintHtml(hint)}`
}

/** Qué colorea la paleta: si el modo deja una de las dos opciones sin sentido, se corrige. */
export function effectiveColorTarget(mode: PaintMode, target: 'stroke' | 'fill'): 'stroke' | 'fill' {
  return mode === 'stroke' ? 'stroke' : mode === 'fill' ? 'fill' : target
}

export interface ShapeBarState {
  kind: Fillable
  mode: PaintMode
  /** Ya corregido con `effectiveColorTarget` */
  colorTarget: 'stroke' | 'fill'
  color: string
  fillColor: string
  arrowStyle: ArrowStyle
}

/** Formas y flechas: estilo de flecha, borde/relleno y qué colorea la paleta. */
export function shapeHtml(s: ShapeBarState): string {
  const { kind, mode, colorTarget } = s
  const isArrow = kind === 'arrow'
  const modes: Array<[PaintMode, string]> = isArrow
    ? [
        ['stroke', 'Punta hueca'],
        ['both', 'Punta rellena']
      ]
    : [
        ['stroke', 'Solo borde'],
        ['fill', 'Solo relleno'],
        ['both', 'Borde y relleno']
      ]
  const styles: Array<[ArrowStyle, string, string]> = [
    ['standard', 'Normal', '<path d="M4 20 18 6M10 6h8v8" stroke-width="2"/>'],
    ['thin', 'Fina', '<path d="M4 20 18 6M11 6h7v7" stroke-width="1.2"/>'],
    ['bold', 'Gruesa', '<path d="M5 19 16 8" stroke-width="3.4"/><path d="M9 5h10v10z" fill="currentColor"/>'],
    ['double', 'Doble', '<path d="M6 18 18 6M12 6h6v6M6 12v6h6" stroke-width="2"/>']
  ]
  return `
    ${
      isArrow
        ? `<div class="seg">${styles
            .map(([st, l, d]) => `<button data-astyle="${st}" class="${s.arrowStyle === st ? 'active' : ''}" title="Flecha ${l.toLowerCase()}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round">${d}</svg><span>${l}</span></button>`)
            .join('')}</div><div class="sep"></div>`
        : ''
    }
    <div class="seg">${modes
      .map(([m, l]) => `<button data-paint="${m}" class="${mode === m ? 'active' : ''}">${paintIcon(m)}<span>${l}</span></button>`)
      .join('')}</div>
    <div class="sep"></div>
    <span class="ctx-label">Colorear:</span>
    <div class="seg">
      <button data-target="stroke" class="${colorTarget === 'stroke' ? 'active' : ''}" ${mode === 'fill' ? 'disabled' : ''}>
        <i class="chip ring" style="--c:${s.color}"></i><span>${isArrow ? 'Línea' : 'Borde'}</span></button>
      <button data-target="fill" class="${colorTarget === 'fill' ? 'active' : ''}" ${mode === 'stroke' ? 'disabled' : ''}>
        <i class="chip solid" style="--c:${s.fillColor}"></i><span>${isArrow ? 'Punta' : 'Relleno'}</span></button>
    </div>
    <span class="ctx-hint">${isArrow ? 'Arrastra el punto azul para curvarla' : 'Elige qué colorear y pulsa un color de la paleta'}</span>`
}
