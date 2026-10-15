param([int]$Port = 8765, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) { $pythonCommand = $bundledPython }
else { $pythonCommand = (Get-Command python -ErrorAction Stop).Source }
$serverReady = $false
for ($candidatePort = $Port; $candidatePort -lt ($Port + 16); $candidatePort++) {
    $serverUrl = 'http://127.0.0.1:' + $candidatePort
    $occupied = Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue
    if ($occupied) {
        try {
            $identity = Invoke-RestMethod -Uri ($serverUrl + '/api/identity') -TimeoutSec 2
            if ($identity.application -eq 'narae-gyomu-classtime' -and $identity.root -eq $runtimeRoot) { $serverReady = $true; break }
        } catch { }
        continue
    }
    $launchArguments = '-X utf8 "{0}" serve --port {1}' -f (Join-Path $PSScriptRoot 'timetable.py'), $candidatePort
    Start-Process -FilePath $pythonCommand -ArgumentList $launchArguments -WindowStyle Hidden -WorkingDirectory $runtimeRoot
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 150
        try {
            $identity = Invoke-RestMethod -Uri ($serverUrl + '/api/identity') -TimeoutSec 1
            if ($identity.application -eq 'narae-gyomu-classtime' -and $identity.root -eq $runtimeRoot) { $serverReady = $true; break }
        } catch { }
    }
    if ($serverReady) { break }
}
if (-not $serverReady) { throw 'Could not start the local timetable server.' }
if (-not $NoBrowser) { Start-Process $serverUrl }
Write-Output $serverUrl
