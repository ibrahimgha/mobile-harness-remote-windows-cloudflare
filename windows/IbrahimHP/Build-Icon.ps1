Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PngPath = Join-Path $AppDir "ibrahim-hp.png"
$IcoPath = Join-Path $AppDir "ibrahim-hp.ico"

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2

  $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  return $path
}

$bitmap = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$outerRect = [System.Drawing.RectangleF]::new(18, 18, 220, 220)
$outerPath = New-RoundedRectPath -Rect $outerRect -Radius 52
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $outerRect,
  [System.Drawing.ColorTranslator]::FromHtml("#0f766e"),
  [System.Drawing.ColorTranslator]::FromHtml("#4f46e5"),
  38
)
$graphics.FillPath($gradient, $outerPath)

$ringPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(228, 255, 255, 255), 10)
$ringPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($ringPen, $outerPath)

$innerRect = [System.Drawing.RectangleF]::new(48, 48, 160, 160)
$innerPath = New-RoundedRectPath -Rect $innerRect -Radius 36
$innerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(170, 255, 255, 255), 8)
$innerPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($innerPen, $innerPath)

$accentPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#c8fff4"), 16)
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($accentPen, 74, 76, 74, 180)
$graphics.DrawLine($accentPen, 74, 128, 182, 128)
$graphics.DrawLine($accentPen, 182, 76, 182, 180)

$fontFamily = [System.Drawing.FontFamily]::new("Segoe UI")
$font = [System.Drawing.Font]::new($fontFamily, 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$graphics.DrawString("HP", $font, $textBrush, [System.Drawing.RectangleF]::new(50, 52, 156, 152), $format)

$bitmap.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
[System.IO.File]::WriteAllBytes($IcoPath, $stream.ToArray())

$writer.Dispose()
$stream.Dispose()
$textBrush.Dispose()
$font.Dispose()
$format.Dispose()
$fontFamily.Dispose()
$accentPen.Dispose()
$innerPen.Dispose()
$ringPen.Dispose()
$gradient.Dispose()
$outerPath.Dispose()
$innerPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Wrote $PngPath"
Write-Host "Wrote $IcoPath"
