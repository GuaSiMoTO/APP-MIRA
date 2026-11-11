// «Quitar objeto»: relleno por parches en un worker (se crea al primer uso y se reinicia si falla).
import InpaintWorker from './inpaint.worker?worker&inline'
import type { InpaintRequest, InpaintResponse } from './inpaint.worker'

let worker: Worker | null = null

export function runInpaint(req: InpaintRequest): Promise<InpaintResponse> {
  worker ??= new InpaintWorker()
  const w = worker
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<InpaintResponse>) => resolve(e.data)
    w.onerror = (e) => {
      worker?.terminate()
      worker = null
      reject(new Error(e.message))
    }
    w.postMessage(req, [req.data.buffer, req.init.buffer, req.mask.buffer])
  })
}
