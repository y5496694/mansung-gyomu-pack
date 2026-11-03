param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
Add-Type -AssemblyName System.IO.Compression.FileSystem
function LongPath([string]$value){if($value.StartsWith('\\')){return '\\?\UNC\'+$value.Substring(2)};return '\\?\'+$value}
$root=[IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\'
[IO.Directory]::CreateDirectory((LongPath $root)) | Out-Null
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
    foreach($entry in $zip.Entries){
        $relative=$entry.FullName.Replace('/','\')
        if([IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw '지원하지 않는 압축 경로입니다.'}
        $target=[IO.Path]::GetFullPath((Join-Path $root $relative))
        if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw '압축 파일이 설치 폴더를 벗어납니다.'}
        if($relative.EndsWith('\')){[IO.Directory]::CreateDirectory((LongPath $target)) | Out-Null;continue}
        [IO.Directory]::CreateDirectory((LongPath ([IO.Path]::GetDirectoryName($target)))) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(LongPath $target),$false)
    }
} finally {$zip.Dispose()}
