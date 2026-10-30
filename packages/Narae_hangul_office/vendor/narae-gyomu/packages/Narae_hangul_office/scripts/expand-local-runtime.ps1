param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\'
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
    foreach($entry in $zip.Entries){
        $target=[IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
        if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path escapes runtime folder'}
    }
} finally {$zip.Dispose()}
Expand-Archive -LiteralPath $Archive -DestinationPath $Destination
