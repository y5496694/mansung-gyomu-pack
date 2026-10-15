param([string]$SkillsDirectory)
$ErrorActionPreference = 'Stop'
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) { $pythonCommand = $bundledPython }
else { $pythonCommand = (Get-Command python -ErrorAction Stop).Source }
$scriptArguments = @('-X', 'utf8', (Join-Path $PSScriptRoot 'scripts\install.py'))
if ($SkillsDirectory) { $scriptArguments += @('--skills-directory', $SkillsDirectory) }
& $pythonCommand @scriptArguments
if ($LASTEXITCODE -ne 0) { throw 'Skill installation failed.' }
