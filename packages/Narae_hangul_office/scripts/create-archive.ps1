param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Compress-Archive -Path (Join-Path $Source '*') -DestinationPath $Destination -Force
