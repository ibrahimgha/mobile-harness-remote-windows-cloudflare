param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "icons")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$palette = @(
  @{ Number = 1; Accent = "#B9FF49" },
  @{ Number = 2; Accent = "#36D9FF" },
  @{ Number = 3; Accent = "#FFB547" },
  @{ Number = 4; Accent = "#FF55B8" },
  @{ Number = 5; Accent = "#A982FF" },
  @{ Number = 6; Accent = "#FF725E" }
)
$sizes = @(16, 24, 32, 48, 64, 128, 256)

function New-RoundedRectanglePath {
  param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconFrameBytes {
  param([int]$Size, [int]$Number, [System.Drawing.Color]$Accent)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $inset = [Math]::Max(1, [Math]::Round($Size * 0.055))
  $radius = [Math]::Max(2, [Math]::Round($Size * 0.20))
  $path = New-RoundedRectanglePath -X $inset -Y $inset -Width ($Size - 2 * $inset) -Height ($Size - 2 * $inset) -Radius $radius
  $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 13, 18, 21))
  $outlineWidth = [Math]::Max(1, $Size * 0.035)
  $outline = New-Object System.Drawing.Pen($Accent, $outlineWidth)
  $graphics.FillPath($background, $path)
  $graphics.DrawPath($outline, $path)

  $signalHeight = [Math]::Max(2, [Math]::Round($Size * 0.09))
  $signalX = [Math]::Round($Size * 0.23)
  $signalWidth = [Math]::Round($Size * 0.54)
  $signalBrush = New-Object System.Drawing.SolidBrush($Accent)
  $graphics.FillRectangle($signalBrush, $signalX, [Math]::Round($Size * 0.17), $signalWidth, $signalHeight)

  $fontSize = [Math]::Max(8, $Size * 0.49)
  $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 240, 244, 238))
  $textRect = New-Object System.Drawing.RectangleF(0, ($Size * 0.18), $Size, ($Size * 0.76))
  $graphics.DrawString([string]$Number, $font, $textBrush, $textRect, $format)

  $rectangle = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $bitmapData = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = [Math]::Abs($bitmapData.Stride)
  $pixels = New-Object byte[] ($stride * $Size)
  [System.Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $pixels, 0, $pixels.Length)
  $bitmap.UnlockBits($bitmapData)

  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  $pixelBytes = $Size * $Size * 4
  $writer.Write([UInt32]40)
  $writer.Write([Int32]$Size)
  $writer.Write([Int32]($Size * 2))
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]0)
  $writer.Write([UInt32]$pixelBytes)
  $writer.Write([Int32]0); $writer.Write([Int32]0)
  $writer.Write([UInt32]0); $writer.Write([UInt32]0)
  for ($row = $Size - 1; $row -ge 0; $row--) {
    $writer.Write($pixels, $row * $stride, $Size * 4)
  }
  $maskRowBytes = [Math]::Ceiling($Size / 32) * 4
  $writer.Write((New-Object byte[] ($maskRowBytes * $Size)))
  $bytes = $stream.ToArray()

  $writer.Dispose(); $stream.Dispose(); $textBrush.Dispose(); $format.Dispose(); $font.Dispose()
  $signalBrush.Dispose(); $outline.Dispose(); $background.Dispose(); $path.Dispose()
  $graphics.Dispose(); $bitmap.Dispose()
  Write-Output -NoEnumerate $bytes
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($variant in $palette) {
  $frames = foreach ($size in $sizes) {
    New-IconFrameBytes -Size $size -Number $variant.Number -Accent ([System.Drawing.ColorTranslator]::FromHtml($variant.Accent))
  }

  $iconPath = Join-Path $OutputDirectory "control-room-$($variant.Number).ico"
  $stream = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$frames.Count)
  $offset = 6 + (16 * $frames.Count)
  for ($index = 0; $index -lt $frames.Count; $index++) {
    $size = $sizes[$index]
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frames[$index].Length); $writer.Write([UInt32]$offset)
    $offset += $frames[$index].Length
  }
  foreach ($frame in $frames) { $writer.Write($frame) }
  $writer.Dispose(); $stream.Dispose()
  Write-Host "Created $iconPath"
}
