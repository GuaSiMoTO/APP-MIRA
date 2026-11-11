# OCR con el motor de Windows (Windows.Media.Ocr), sin dependencias ni internet.
# Modo servidor: lee una ruta de imagen por línea en stdin y escribe una línea JSON por petición:
#   { ok, lang, lines: [ { text, words: [ { text, x, y, w, h } ] } ] }   o   { ok: false, error }
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
[Console]::Out.WriteLine((@{ ready = $true; ok = [bool]$engine } | ConvertTo-Json -Compress))
[Console]::Out.Flush()

while ($true) {
  $path = [Console]::In.ReadLine()
  if ($null -eq $path) { break }
  $path = $path.Trim()
  if (-not $path) { continue }
  try {
    if (-not $engine) { throw 'no-language' }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @()
    foreach ($line in $result.Lines) {
      $words = @()
      foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        $words += @{ text = $w.Text; x = [math]::Round($r.X, 1); y = [math]::Round($r.Y, 1); w = [math]::Round($r.Width, 1); h = [math]::Round($r.Height, 1) }
      }
      $lines += @{ text = $line.Text; words = $words }
    }
    $bitmap.Dispose()
    $stream.Dispose()
    $out = @{ ok = $true; lang = $engine.RecognizerLanguage.LanguageTag; lines = $lines } | ConvertTo-Json -Depth 6 -Compress
  }
  catch {
    $inner = $_.Exception; while ($inner.InnerException) { $inner = $inner.InnerException }; $out = @{ ok = $false; error = "$($inner.Message)"; path = $path } | ConvertTo-Json -Compress
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
