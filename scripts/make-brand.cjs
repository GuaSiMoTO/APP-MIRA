// Separa el logo de Mira (icono + letras) a partir de resources/brand/mira-logo.png.
// Se ejecuta con Electron (usa nativeImage para leer y escribir PNG): `npm run brand`.
//
// Genera:
//   resources/icon.png                       icono cuadrado 512 px (app, bandeja, instalador)
//   resources/brand/mira-icon-1024.png       icono cuadrado 1024 px
//   resources/brand/mira-icon-64.png         icono pequeño para la esquina de las ventanas
//   resources/brand/mira-wordmark.png        letras "MIRA" (color original, fondo transparente)
//   resources/brand/mira-wordmark-white.png  letras "MIRA" en blanco (para fondos de color)
//
// La imagen de origen debe tener fondo transparente, con el icono a la izquierda y las letras a la derecha.
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const brand = path.join(root, 'resources', 'brand')

/** Tramos de columnas con contenido (alfa > 20). */
function columnRuns(bmp, W, H) {
  const has = (x) => {
    for (let y = 0; y < H; y += 2) if (bmp[(y * W + x) * 4 + 3] > 20) return true
    return false
  }
  const runs = []
  let s = -1
  for (let x = 0; x <= W; x++) {
    const ink = x < W && has(x)
    if (ink && s < 0) s = x
    if (!ink && s >= 0) {
      runs.push([s, x - 1])
      s = -1
    }
  }
  return runs
}

function rowsBox(bmp, W, H, x0, x1) {
  let y0 = H
  let y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = x0; x <= x1; x++)
      if (bmp[(y * W + x) * 4 + 3] > 20) {
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
        break
      }
  return [y0, y1]
}

/** Recorta una zona y la centra en un lienzo cuadrado transparente (con un pequeño margen). */
function squareOf(img, box, padRatio = 0.02) {
  const crop = img.crop(box)
  const side = Math.round(Math.max(box.width, box.height) * (1 + padRatio * 2))
  const out = Buffer.alloc(side * side * 4)
  const src = crop.toBitmap()
  const ox = Math.round((side - box.width) / 2)
  const oy = Math.round((side - box.height) / 2)
  for (let y = 0; y < box.height; y++) src.copy(out, ((oy + y) * side + ox) * 4, y * box.width * 4, (y + 1) * box.width * 4)
  return nativeImage.createFromBitmap(out, { width: side, height: side })
}

/** Misma forma en blanco (el mapa de bits es premultiplicado: blanco = alfa en cada canal). */
function whiteOf(img) {
  const b = Buffer.from(img.toBitmap())
  for (let i = 0; i < b.length; i += 4) b[i] = b[i + 1] = b[i + 2] = b[i + 3]
  const s = img.getSize()
  return nativeImage.createFromBitmap(b, { width: s.width, height: s.height })
}

app.whenReady().then(() => {
  const src = path.join(brand, 'mira-logo.png')
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) throw new Error(`No se pudo leer ${src}`)
  const { width: W, height: H } = img.getSize()
  const bmp = img.toBitmap()
  const runs = columnRuns(bmp, W, H).filter(([a, b]) => b - a > 3)
  if (runs.length < 2) throw new Error('No se distinguen el icono y las letras')

  // Primer tramo = icono; el resto = letras
  const [ix0, ix1] = runs[0]
  const [iy0, iy1] = rowsBox(bmp, W, H, ix0, ix1)
  const iconBox = { x: ix0, y: iy0, width: ix1 - ix0 + 1, height: iy1 - iy0 + 1 }
  const wx0 = runs[1][0]
  const wx1 = runs[runs.length - 1][1]
  const [wy0, wy1] = rowsBox(bmp, W, H, wx0, wx1)
  const pad = 4
  const wordBox = { x: wx0 - pad, y: wy0 - pad, width: wx1 - wx0 + 1 + pad * 2, height: wy1 - wy0 + 1 + pad * 2 }

  const icon = squareOf(img, iconBox)
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), icon.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  fs.writeFileSync(path.join(brand, 'mira-icon-1024.png'), icon.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG())
  // Versión pequeña para la esquina de las ventanas de la app
  fs.writeFileSync(path.join(brand, 'mira-icon-64.png'), icon.resize({ width: 64, height: 64, quality: 'best' }).toPNG())
  const word = img.crop(wordBox)
  fs.writeFileSync(path.join(brand, 'mira-wordmark.png'), word.toPNG())
  fs.writeFileSync(path.join(brand, 'mira-wordmark-white.png'), whiteOf(word).toPNG())

  console.log('icono', JSON.stringify(iconBox), '· letras', JSON.stringify(wordBox))
  console.log('Generados: resources/icon.png, resources/brand/mira-icon-1024.png, mira-wordmark.png, mira-wordmark-white.png')
  app.exit(0)
})
