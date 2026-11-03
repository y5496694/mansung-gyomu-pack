param([string]$InstallDirectory = $PSScriptRoot,[string]$BinDirectory = 'D:\Codex\bin',[string]$SkillsDirectory = 'D:\Codex\skills',[switch]$NoSkillLink)
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath($InstallDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'NaraeGyomu.exe'))) { throw '나래교무 실행 파일이 있는 폴더를 지정하세요.' }
New-Item -ItemType Directory -Path $BinDirectory,$SkillsDirectory -Force | Out-Null
$wrapper = "@echo off`r`ncall `"$appRoot\narae-gyomu.cmd`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $BinDirectory 'narae-gyomu.cmd'),$wrapper,[Text.Encoding]::Default)
$skillSource = Join-Path $appRoot 'resources\app\skills\narae-gyomu'
$skillTarget = Join-Path $SkillsDirectory 'narae-gyomu'
if (Test-Path -LiteralPath $skillTarget) {
  $backupRoot = 'D:\Codex\skill-backups'
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $backup = Join-Path $backupRoot ('narae-gyomu-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
  Copy-Item -LiteralPath $skillTarget -Destination $backup -Recurse
}
New-Item -ItemType Directory -Path $skillTarget -Force | Out-Null
Copy-Item -Path (Join-Path $skillSource '*') -Destination $skillTarget -Recurse -Force
if (-not $NoSkillLink) {
  $codexSkills = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex\skills' }
  New-Item -ItemType Directory -Path $codexSkills -Force | Out-Null
  $link = Join-Path $codexSkills 'narae-gyomu'
  if (-not (Test-Path -LiteralPath $link)) { New-Item -ItemType Junction -Path $link -Target $skillTarget | Out-Null }
  elseif ([IO.Path]::GetFullPath($link) -ne [IO.Path]::GetFullPath($skillTarget)) {
    $existing = Get-Item -LiteralPath $link
    if ($existing.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath([string]$existing.Target) -ne [IO.Path]::GetFullPath($skillTarget)) {
      Write-Warning "기존 $link 를 보존했습니다. 새 스킬은 $skillTarget 에 있습니다."
    }
  }
}
$currentPath = [string][Environment]::GetEnvironmentVariable('Path','User')
if (($currentPath -split ';') -notcontains $BinDirectory) { [Environment]::SetEnvironmentVariable('Path',($currentPath.TrimEnd(';')+';'+$BinDirectory),'User') }
Write-Output "나래교무 CLI: $(Join-Path $BinDirectory 'narae-gyomu.cmd')"
Write-Output "AI 스킬: $skillTarget"
Write-Output '새 터미널·새 AI 대화에서 narae-gyomu를 사용할 수 있습니다.'
