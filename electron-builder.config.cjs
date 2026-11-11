// Configuración del instalador (electron-builder). Está en un archivo .cjs en lugar de en
// package.json para poder poner la fecha del día en que se genera el .exe.
const fecha = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
const year = new Date().getFullYear()

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.javierbarroso.mira',
  productName: 'Mira',
  // Propiedades del .exe (clic derecho → Propiedades → Detalles): «Copyright» y «Marcas comerciales legales».
  // El «Organización» / «Compañía» sale del campo author de package.json.
  copyright: `© ${year} Javier Barroso · versión 0.1 · creado el ${fecha}`,
  directories: { output: 'dist' },
  files: ['out/**', 'package.json'],
  extraResources: [{ from: 'resources', to: 'resources' }],
  asarUnpack: ['node_modules/ffmpeg-static/**', 'node_modules/koffi/**'],
  win: {
    target: 'nsis',
    icon: 'resources/icon.png',
    legalTrademarks: `Mira 0.1 · Javier Barroso · ${fecha}`
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
}
