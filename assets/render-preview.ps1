param(
    [string]$Title = 'Juxtaposed',
    [string]$Subtitle = 'A little more room for your music.',
    [string]$Footer = 'Dynamic colour. A calmer Spotify.',
    [string]$Source = "$PSScriptRoot\spotify-screenshot.png",
    [string]$Output = "$PSScriptRoot\..\preview-square.png"
)
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Bitmap]::new(1024, 1024)
$graphics = [Drawing.Graphics]::FromImage($image)
$screenshot = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
$titleFont = [Drawing.Font]::new('Segoe UI', 78, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$bodyFont = [Drawing.Font]::new('Segoe UI', 30, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$labelFont = [Drawing.Font]::new('Segoe UI', 21, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$white = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f4f5f7'))
$muted = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#a8b1bc'))
$accent = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#77d8d1'))
try {
    $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#0c1420'))
    $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawString('SPICETIFY', $labelFont, $accent, 48, 44)
    $graphics.DrawString($Title, $titleFont, $white, 42, 93)
    $graphics.DrawString($Subtitle, $bodyFont, $muted, 48, 198)
    # Crop a real screenshot. Use a single scale factor to preserve proportions.
    $crop = [Drawing.RectangleF]::new(60, 0, 1190, $screenshot.Height)
    $width = 928.0
    $height = $width * $crop.Height / $crop.Width
    $target = [Drawing.RectangleF]::new(48, 298, $width, $height)
    $graphics.DrawImage($screenshot, $target, $crop, [Drawing.GraphicsUnit]::Pixel)
    $graphics.DrawString($Footer, $bodyFont, $white, 48, 878)
    $graphics.DrawString('Actual Spotify screenshot', $labelFont, $muted, 48, 940)
    $image.Save([IO.Path]::GetFullPath($Output), [Drawing.Imaging.ImageFormat]::Png)
} finally {
    $screenshot.Dispose(); $graphics.Dispose(); $image.Dispose()
    $titleFont.Dispose(); $bodyFont.Dispose(); $labelFont.Dispose()
    $white.Dispose(); $muted.Dispose(); $accent.Dispose()
}
