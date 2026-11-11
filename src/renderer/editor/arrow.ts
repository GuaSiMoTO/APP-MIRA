// Flecha de Mira: la línea no se ve dentro de la punta.
// Konva.Arrow dibuja la línea hasta el vértice y encima la punta; con la punta hueca la línea se veía
// dentro. Aquí se dibuja la línea recortando el triángulo de cada punta y después las puntas.
// Es una subclase (no se toca Konva.Arrow); clone() conserva la clase, así que el historial también.
import Konva from 'konva'

export class MiraArrow extends Konva.Arrow {
  _sceneFunc(ctx: Konva.Context): void {
    const pts = this.points()
    const n = pts.length
    const len = this.pointerLength()
    const half = this.pointerWidth() / 2
    const w = this.strokeWidth()
    const heads: [number, number, number][] = []
    if (n >= 4) {
      if (this.pointerAtEnding()) heads.push([pts[n - 2], pts[n - 1], this._getPointerAngle(false)])
      if (this.pointerAtBeginning()) heads.push([pts[0], pts[1], this._getPointerAngle(true)])
    }
    const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
    c.save()
    if (heads.length) {
      c.beginPath()
      c.rect(-1e6, -1e6, 2e6, 2e6)
      for (const [x, y, a] of heads) {
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        const at = (u: number, v: number): [number, number] => [x + u * cos - v * sin, y + u * sin + v * cos]
        // Un poco más allá del vértice para tapar también el remate redondo de la línea
        c.moveTo(...at(w, 0))
        c.lineTo(...at(-len, half))
        c.lineTo(...at(-len, -half))
        c.closePath()
      }
      c.clip('evenodd')
    }
    Konva.Line.prototype._sceneFunc.call(this, ctx)
    c.restore()
    for (const [x, y, a] of heads) {
      ctx.save()
      ctx.beginPath()
      ctx.translate(x, y)
      ctx.rotate(a)
      ctx.moveTo(0, 0)
      ctx.lineTo(-len, half)
      ctx.lineTo(-len, -half)
      ctx.closePath()
      ctx.restore()
      this.__fillStroke(ctx)
    }
  }
}
