param([string]$SkillsDirectory)
$ErrorActionPreference = 'Stop'
$installArguments = @((Join-Path $PSScriptRoot 'scripts\install.py'))
if ($SkillsDirectory) { $installArguments += @('--skills-directory', $SkillsDirectory) }
& python @installArguments
if ($LASTEXITCODE -ne 0) { throw 'Installation failed.' }
