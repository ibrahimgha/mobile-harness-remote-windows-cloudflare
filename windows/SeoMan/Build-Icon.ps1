Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PngPath = Join-Path $AppDir "seo-man.png"
$IcoPath = Join-Path $AppDir "seo-man.ico"

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
$outerPath = New-RoundedRectPath -Rect $outerRect -Radius 48
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $outerRect,
  [System.Drawing.ColorTranslator]::FromHtml("#064e3b"),
  [System.Drawing.ColorTranslator]::FromHtml("#f59e0b"),
  42
)
$graphics.FillPath($gradient, $outerPath)

$outerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(235, 255, 255, 255), 10)
$outerPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($outerPen, $outerPath)

$pathPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(190, 255, 255, 255), 8)
$pathPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pathPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($pathPen, 50, 54, 156, 148, 205, 292)
$graphics.DrawLine($pathPen, 68, 171, 190, 72)

$dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#dcfce7"))
$graphics.FillEllipse($dotBrush, 55, 162, 26, 26)
$graphics.FillEllipse($dotBrush, 178, 59, 26, 26)

$fontFamily = [System.Drawing.FontFamily]::new("Segoe UI")
$font = [System.Drawing.Font]::new($fontFamily, 58, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$graphics.DrawString("SM", $font, $textBrush, [System.Drawing.RectangleF]::new(38, 58, 180, 132), $format)

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
$dotBrush.Dispose()
$pathPen.Dispose()
$outerPen.Dispose()
$gradient.Dispose()
$outerPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Wrote $PngPath"
Write-Host "Wrote $IcoPath"
