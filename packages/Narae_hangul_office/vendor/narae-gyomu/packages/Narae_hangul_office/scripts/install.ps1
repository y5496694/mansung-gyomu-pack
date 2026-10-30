param([string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'Programs\NaraeHangulOffice'),[switch]$NoShortcut)
$ErrorActionPreference='Stop'
$OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
$env:PYTHONUTF8='1';$env:PYTHONNOUSERSITE='1'
foreach($name in @('PYTHONHOME','PYTHONPATH','PYTHONUSERBASE','NODE_PATH','NODE_OPTIONS')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){throw 'Windows x64 환경이 필요합니다.'}
$sourceRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\')){throw '드라이브 루트에는 설치할 수 없습니다.'}
$running=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallRoot+'\',[StringComparison]::OrdinalIgnoreCase)})
if($running.Count){throw '트레이의 나래 한글 오피스 아이콘에서 완전히 종료를 선택한 뒤 다시 설치하세요.'}
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
if($sourceRoot -ne $InstallRoot){
    foreach($name in @('src','ui','vendor','skills','scripts','docs','resources','package.json','package-lock.json','requirements.txt','LICENSE','README.md','THIRD_PARTY_NOTICES.md','narae-office.cmd')){
        $source=Join-Path $sourceRoot $name
        if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination $InstallRoot -Recurse -Force}
    }
}
Push-Location $InstallRoot
try {
    $cache=Join-Path $InstallRoot 'cache';New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $env:TEMP=$cache;$env:TMP=$cache
    $runtime=& (Join-Path $InstallRoot 'scripts\bootstrap-runtime.ps1') -AppRoot $InstallRoot
    $node=$runtime.node;$npm=$runtime.npm;$python=$runtime.python
    $env:PATH=$runtime.nodeRoot+';'+$env:PATH
    $env:npm_config_cache=Join-Path $cache 'npm';$env:PIP_CACHE_DIR=Join-Path $cache 'pip';$env:ELECTRON_CACHE=Join-Path $cache 'electron'
    Write-Output '한컴오피스 한글 설치 확인 중...'
    & $node -e "if(!require('./src/hancom.cjs').discoverHancom().hangul){console.error('한컴오피스 한글을 먼저 설치하고 한 번 실행하세요.');process.exit(1)}"
    if($LASTEXITCODE -ne 0){throw '한컴오피스 한글 사전 설치가 필요합니다.'}
    Write-Output '데스크톱 런타임 설치 중...'
    & $npm ci --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Electron 설치 실패'}
    & $node (Join-Path $InstallRoot 'node_modules\electron\install.js');if($LASTEXITCODE -ne 0){throw 'Electron 실행 파일 다운로드 실패'}
    Write-Output '나래한글 엔진 의존성 설치 중...'
    & $python -I -m pip install --only-binary=:all: --no-warn-script-location --disable-pip-version-check -r (Join-Path $InstallRoot 'requirements.txt');if($LASTEXITCODE -ne 0){throw 'Python 라이브러리 설치 실패'}
    & (Join-Path $InstallRoot 'scripts\install-ant.ps1') -AppRoot $InstallRoot
    & $python -I -c "import pythoncom,win32crypt,PySide6,pypdfium2,lxml;print('Python 의존성 확인 완료')";if($LASTEXITCODE -ne 0){throw 'Python 환경 확인 실패'}
    & $node (Join-Path $InstallRoot 'src\local-runtime.cjs');if($LASTEXITCODE -ne 0){throw '로컬 AI 실행기 설치 실패'}
    & $node (Join-Path $InstallRoot 'scripts\install-skills.cjs');if($LASTEXITCODE -ne 0){throw '에이전트 스킬 설치 실패'}
    $executable=Join-Path $InstallRoot 'node_modules\electron\dist\electron.exe'
    if(-not (Test-Path -LiteralPath $executable)){throw 'Electron 실행 파일 누락'}
    $vbs='Set shell = CreateObject("WScript.Shell")'+"`r`n"+'shell.CurrentDirectory = "'+$InstallRoot.Replace('"','""')+'"'+"`r`n"+'shell.Run Chr(34) & "'+$executable.Replace('"','""')+'" & Chr(34) & " " & Chr(34) & "'+$InstallRoot.Replace('"','""')+'" & Chr(34), 1, False'
    [IO.File]::WriteAllText((Join-Path $InstallRoot '나래 한글 오피스.vbs'),$vbs,[Text.Encoding]::Unicode)
    if(-not $NoShortcut){
        $shortcutShell=New-Object -ComObject WScript.Shell
        foreach($directory in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
            $shortcut=$shortcutShell.CreateShortcut((Join-Path $directory '나래 한글 오피스.lnk'))
            $shortcut.TargetPath=$executable;$shortcut.Arguments='"'+$InstallRoot+'"';$shortcut.WorkingDirectory=$InstallRoot;$shortcut.Description='나래한글 엔진 기반 · 한컴오피스 한글 연동';$shortcut.IconLocation=(Join-Path $InstallRoot 'ui\assets\narae-office.ico')+',0';$shortcut.Save()
        }
    }
    [ordered]@{version=(Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version;installedAt=(Get-Date).ToString('o');root=$InstallRoot;python=$python;runtime=$executable;managedNode=$runtime.nodeVersion;managedPython=$runtime.pythonVersion;systemDependenciesRequired=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'installation.json') -Encoding UTF8
    Write-Output "설치 완료: $InstallRoot"
    Write-Output '바탕화면의 나래 한글 오피스를 실행하세요. Node.js와 Python은 별도로 설치하지 않아도 됩니다.'
} finally {Pop-Location}
