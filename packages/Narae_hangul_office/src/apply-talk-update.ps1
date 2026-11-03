param([Parameter(Mandatory=$true)][string]$Job)
$ErrorActionPreference='Stop'
$jobData=Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json
$appRoot=[IO.Path]::GetFullPath($jobData.root).TrimEnd('\')
$source=[IO.Path]::GetFullPath($jobData.source).TrimEnd('\')
$backup=[IO.Path]::GetFullPath($jobData.backup).TrimEnd('\')
$stage=[IO.Path]::GetFullPath((Split-Path -Parent $Job)).TrimEnd('\')
if($appRoot -eq [IO.Path]::GetPathRoot($appRoot).TrimEnd('\') -or -not $source.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $backup.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase)){throw '업데이트 경로 확인 실패'}
$log=Join-Path $stage 'update.log'
Start-Transcript -LiteralPath $log | Out-Null
$names=@('src','ui','vendor','skills','scripts','docs','resources','experiments','package.json','package-lock.json','requirements.txt','LICENSE','README.md','THIRD_PARTY_NOTICES.md','narae-office.cmd','narae-talk.cmd')
$runtime=Join-Path $appRoot 'node_modules\electron\dist\electron.exe'
try {
    $old=Get-Process -Id $jobData.pid -ErrorAction SilentlyContinue
    if($old -and -not $old.WaitForExit(120000)){throw '앱이 종료되지 않아 업데이트를 중단했습니다.'}
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    function Dependency-Plan([string]$folder){
        $plan=& (Join-Path $appRoot 'runtime\node\node.exe') (Join-Path $source 'src\update-dependencies.cjs') (Join-Path $folder 'package-lock.json')
        if($LASTEXITCODE -ne 0){throw 'Dependency comparison failed'}
        return $plan
    }
    $same=(Dependency-Plan $appRoot) -eq (Dependency-Plan $source)
    foreach($name in @('requirements.txt','scripts/runtime-downloads.json')){if((Get-FileHash -LiteralPath (Join-Path $appRoot $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source $name)).Hash){$same=$false}}
    function Copy-Managed([string]$from,[string]$to){if(Test-Path -LiteralPath $from -PathType Container){& (Join-Path $source 'scripts\copy-tree.ps1') -Source $from -Destination $to}else{Copy-Item -LiteralPath $from -Destination $to -Force}}
    foreach($name in $names){$file=Join-Path $appRoot $name;if(Test-Path -LiteralPath $file){Copy-Managed $file (Join-Path $backup $name)}}
    try {
        $env:NARAE_SKILL_BACKUP_ROOT=Join-Path $backup 'skills'
        & (Join-Path $source 'scripts\install.ps1') -InstallRoot $appRoot -Product Talk -NoShortcut -ReuseRuntime:$same
        $metadata=Get-Content -LiteralPath (Join-Path $appRoot 'installation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $metadata | Add-Member -NotePropertyName sourceCommit -NotePropertyValue $jobData.commit -Force
        $metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'installation.json') -Encoding UTF8
        'complete' | Set-Content -LiteralPath (Join-Path $stage 'result.txt')
    } catch {
        foreach($name in $names){$file=Join-Path $backup $name;if(Test-Path -LiteralPath $file){Copy-Managed $file (Join-Path $appRoot $name)}}
        'failed: '+$_.Exception.Message | Set-Content -LiteralPath (Join-Path $stage 'result.txt')
        throw
    }
} catch {'failed: '+$_.Exception.Message | Set-Content -LiteralPath (Join-Path $stage 'result.txt');Write-Output $_.Exception.Message} finally {
    Stop-Transcript | Out-Null
    if(Test-Path -LiteralPath $runtime){$env:NARAE_TALK_HOME=$jobData.home;Start-Process -FilePath $runtime -ArgumentList @(('"'+$appRoot+'"'),'--talk') -WorkingDirectory $appRoot -WindowStyle Hidden}
}
