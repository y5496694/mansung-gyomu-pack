param(
    [Parameter(Mandatory = $true)]
    [string] $ImagePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$stream = $null
$bitmap = $null
$exitCode = 0

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime]

    $script:asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
        $_.GetGenericArguments().Length -eq 1 -and $_.GetParameters().Length -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    if ($null -eq $script:asTaskGeneric) { throw 'WinRT AsTask<T> bridge is unavailable.' }

    function Await-WinRT($Operation, [Type] $ResultType) {
        $task = $script:asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
        return $task.GetAwaiter().GetResult()
    }

    $engine = $null
    $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
    $korean = @($languages | Where-Object { $_.LanguageTag -like 'ko*' })
    if ($korean.Count -gt 0) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($korean[0])
    }
    if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if ($null -eq $engine -and $languages.Count -gt 0) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($languages[0])
    }
    if ($null -eq $engine) { throw 'No installed Windows OCR recognizer is available; no language pack was installed.' }

    $file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $maximum = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    if ($decoder.PixelWidth -gt $maximum -or $decoder.PixelHeight -gt $maximum) {
        throw "Image exceeds Windows OCR maximum dimension ($maximum pixels)."
    }
    $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync(
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
    )) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $recognized = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @(
        foreach ($line in $recognized.Lines) {
            $words = @(
                foreach ($word in $line.Words) {
                    $rectangle = $word.BoundingRect
                    [ordered]@{
                        text = [string]$word.Text
                        x = [double]$rectangle.X
                        y = [double]$rectangle.Y
                        width = [double]$rectangle.Width
                        height = [double]$rectangle.Height
                    }
                }
            )
            [ordered]@{ text = [string]$line.Text; words = $words }
        }
    )
    $result = [ordered]@{
        text = [string]$recognized.Text
        lines = $lines
        language = [string]$engine.RecognizerLanguage.LanguageTag
        width = [int]$decoder.PixelWidth
        height = [int]$decoder.PixelHeight
    }
}
catch {
    $result = [ordered]@{ error = [ordered]@{ code = 'ocr_failed'; message = [string]$_.Exception.Message } }
    $exitCode = 1
}
finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
}

[Console]::WriteLine(($result | ConvertTo-Json -Depth 8 -Compress))
exit $exitCode
