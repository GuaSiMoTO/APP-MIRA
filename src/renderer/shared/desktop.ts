// Stream de una pantalla completa a resolución nativa (restricciones propias de Chromium/Electron).
export async function desktopStream(
  sourceId: string,
  width: number,
  height: number,
  opts: { audio?: boolean; fps?: number } = {}
): Promise<MediaStream> {
  const constraints = {
    audio: opts.audio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        minWidth: width,
        maxWidth: width,
        minHeight: height,
        maxHeight: height,
        maxFrameRate: opts.fps ?? 30
      }
    }
  }
  return navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints)
}

/** Espera al siguiente fotograma real del vídeo. */
export function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => resolve())
    else setTimeout(resolve, 50)
  })
}
