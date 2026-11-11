// Logo de Mira para la esquina de las ventanas de la app.
import logoUrl from '../../../resources/brand/mira-icon-64.png'

export const LOGO_URL = logoUrl

/** <img> del icono de Mira (22 px por defecto). */
export function logoImg(extraClass = ''): string {
  return `<img class="app-logo ${extraClass}" src="${logoUrl}" alt="Mira" title="Mira" draggable="false" />`
}
