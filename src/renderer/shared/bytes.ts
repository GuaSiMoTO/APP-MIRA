// Imágenes en bytes para el IPC (sin data URL en base64: menos memoria y sin codificar/decodificar texto).

/** Lienzo → PNG (o JPEG) en bytes. */
export async function canvasBytes(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality))
  if (!blob) throw new Error('No se pudo codificar la imagen')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Bytes de una imagen → URL utilizable en <img> (revócala con URL.revokeObjectURL cuando ya no haga falta). */
export function bytesUrl(bytes: Uint8Array, type = 'image/png'): string {
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
}
