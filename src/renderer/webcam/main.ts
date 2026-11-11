import { $, api } from '../shared/api'

const video = $<HTMLVideoElement>('#video')

$('#sizes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-size]')
  const size = b?.dataset.size
  if (size === 's' || size === 'm' || size === 'l') api.send('webcam:size', size)
})

navigator.mediaDevices
  .getUserMedia({ video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false })
  .then(async (stream) => {
    video.srcObject = stream
    window.addEventListener('beforeunload', () => stream.getTracks().forEach((t) => t.stop()))
    await video.play().catch(() => {})
    api.send('webcam:ready', true)
  })
  .catch(() => api.send('webcam:ready', false))
