// Atajos globales: lo que comparten el proceso principal y la ventana de Ajustes.

/** Clave de cada atajo en los ajustes. */
export type HotkeyId = 'hotkey' | 'hotkeyRepeat' | 'hotkeyText'

export const HOTKEYS: readonly HotkeyId[] = ['hotkey', 'hotkeyRepeat', 'hotkeyText']

/** "Control+Shift+S" → "Ctrl + Mayús + S" (nombres de teclas en español) */
export function prettyAccelerator(acc?: string): string {
  return (acc ?? '').replace('Control', 'Ctrl').replace('Shift', 'Mayús').replaceAll('+', ' + ')
}
