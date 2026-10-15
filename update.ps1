param([string]$SkillsDirectory)
$ErrorActionPreference = 'Stop'
& python (Join-Path $PSScriptRoot 'scripts\sync.py')
if ($LASTEXITCODE -ne 0) { throw 'Source synchronization failed.' }
$installArguments = @{}
if ($SkillsDirectory) { $installArguments.SkillsDirectory = $SkillsDirectory }
& (Join-Path $PSScriptRoot 'install.ps1') @installArguments
