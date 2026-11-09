$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'build'
$logoPath = Join-Path $root 'client/public/numora-wordmark.png'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-Graphics([System.Drawing.Bitmap]$bitmap) {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    return $graphics
}

function Save-24BitBmp([System.Drawing.Bitmap]$bitmap, [string]$path) {
    $converted = [System.Drawing.Bitmap]::new($bitmap.Width, $bitmap.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = New-Graphics $converted
    $graphics.DrawImage($bitmap, 0, 0, $bitmap.Width, $bitmap.Height)
    $graphics.Dispose()
    $converted.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $converted.Dispose()
}

$logo = [System.Drawing.Image]::FromFile($logoPath)

# App icon: dark teal glass, rounded silhouette, and the supplied Numora mark.
$icon = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-Graphics $icon
$g.Clear([System.Drawing.Color]::Transparent)
$clip = New-RoundedPath 3 3 250 250 54
$g.SetClip($clip)
$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 256, 256), [System.Drawing.Color]::FromArgb(255, 9, 64, 72), [System.Drawing.Color]::FromArgb(255, 5, 22, 31), 48)
$g.FillRectangle($background, 0, 0, 256, 256)
$g.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(38, 84, 255, 231)), 118, -58, 180, 180)
$g.DrawImage($logo, 19, 31, 218, 196)
$g.ResetClip()
$border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(92, 116, 245, 223), 2)
$g.DrawPath($border, $clip)
$icon.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# Windows can scale a PNG-backed 256px icon cleanly when electron-builder packages it.
$stream = [System.IO.MemoryStream]::new()
$icon.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
$icoStream = [System.IO.File]::Create((Join-Path $assets 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($icoStream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$png.Length)
$writer.Write([UInt32]22)
$writer.Write($png)
$writer.Dispose()
$icoStream.Dispose()
$stream.Dispose()
$g.Dispose()
$background.Dispose()
$border.Dispose()
$clip.Dispose()
$icon.Dispose()

# Assisted NSIS wizard header, 150 x 57 px, 24-bit RGB.
$header = [System.Drawing.Bitmap]::new(150, 57, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = New-Graphics $header
$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 150, 57), [System.Drawing.Color]::FromArgb(255, 9, 49, 56), [System.Drawing.Color]::FromArgb(255, 8, 30, 39), 0)
$g.FillRectangle($brush, 0, 0, 150, 57)
$accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 63, 222, 214))
$g.FillRectangle($accent, 0, 0, 3, 57)
$brandFont = [System.Drawing.Font]::new('Segoe UI Semibold', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$tagFont = [System.Drawing.Font]::new('Segoe UI', 7.4, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 235, 255, 251))
$mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 137, 191, 191))
$g.DrawString('Numora', $brandFont, $whiteBrush, 13, 12)
$g.DrawString('PRIVATE EXPENSE LEDGER', $tagFont, $mutedBrush, 14, 33)
Save-24BitBmp $header (Join-Path $assets 'installerHeader.bmp')
$g.Dispose()
$brush.Dispose()
$accent.Dispose()
$brandFont.Dispose()
$tagFont.Dispose()
$whiteBrush.Dispose()
$mutedBrush.Dispose()
$header.Dispose()

# NSIS sidebar, 164 x 314 px: logo, calm copy, and a restrained cyan field.
$side = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = New-Graphics $side
$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 164, 314), [System.Drawing.Color]::FromArgb(255, 8, 58, 66), [System.Drawing.Color]::FromArgb(255, 6, 25, 34), 32)
$g.FillRectangle($brush, 0, 0, 164, 314)
for ($y = 12; $y -lt 314; $y += 22) {
    for ($x = 10; $x -lt 164; $x += 22) {
        $dot = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(20, 117, 239, 224))
        $g.FillEllipse($dot, $x, $y, 1.3, 1.3)
        $dot.Dispose()
    }
}
$halo = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(36, 24, 219, 206))
$g.FillEllipse($halo, -66, -46, 240, 178)
$g.DrawImage($logo, 11, 16, 142, 128)
$linePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(78, 135, 236, 221), 1)
$g.DrawLine($linePen, 16, 163, 148, 163)
$head = [System.Drawing.Font]::new('Segoe UI Semibold', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$body = [System.Drawing.Font]::new('Segoe UI', 10.2, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$micro = [System.Drawing.Font]::new('Segoe UI Semibold', 8, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 236, 255, 251))
$mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 151, 193, 191))
$mintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 110, 227, 210))
$g.DrawString('Your money.', $head, $whiteBrush, 16, 182)
$g.DrawString('Your control.', $head, $mintBrush, 16, 201)
$g.DrawString('A private place to track', $body, $mutedBrush, 16, 236)
$g.DrawString('everyday spending and', $body, $mutedBrush, 16, 251)
$g.DrawString('see where it goes.', $body, $mutedBrush, 16, 266)
$g.DrawString('OFFLINE BY DESIGN', $micro, $mintBrush, 16, 291)
Save-24BitBmp $side (Join-Path $assets 'installerSidebar.bmp')

$g.Dispose()
$brush.Dispose()
$halo.Dispose()
$linePen.Dispose()
$head.Dispose()
$body.Dispose()
$micro.Dispose()
$whiteBrush.Dispose()
$mutedBrush.Dispose()
$mintBrush.Dispose()
$side.Dispose()
$logo.Dispose()

Write-Output "Created Numora desktop icon and NSIS installer artwork in $assets"
