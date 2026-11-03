param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
if(-not (Test-Path -LiteralPath $Source -PathType Container)){throw 'Source directory missing'}
# Windows PowerShell Copy-Item cannot handle the nested vendor paths in GitHub archives.
& robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if($LASTEXITCODE -ge 8){throw ('Source copy failed: '+$LASTEXITCODE)}
