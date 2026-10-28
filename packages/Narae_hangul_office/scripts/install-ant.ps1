param([string]$AppRoot=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$AppRoot=[IO.Path]::GetFullPath($AppRoot)
$destination=Join-Path $AppRoot 'tools\ant'
if((Test-Path -LiteralPath (Join-Path $destination 'ant.exe')) -and (Test-Path -LiteralPath (Join-Path $destination 'LICENSE')) -and (Test-Path -LiteralPath (Join-Path $destination 'LICENSE-MIT'))){if((Get-FileHash -LiteralPath (Join-Path $destination 'ant.exe')).Hash -eq 'C8CD35B64B3FC495875A48ACD9A1F253B72F7CC28BD28B5702420552B43242E4'){Write-Output 'Claude Console OAuth 도구 확인 완료.';return}}
$temporary=Join-Path $AppRoot ('cache\ant-install-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary,$destination -Force | Out-Null
try {
    $archive=Join-Path $temporary 'ant.zip'
    Invoke-WebRequest -Uri 'https://github.com/anthropics/anthropic-cli/releases/download/v2.3.0/ant_2.3.0_windows_amd64.zip' -OutFile $archive -UseBasicParsing
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne 'F6015DFD4517D326FD2CE58E036EFE22E53AA1E1C6F9D5C44F9C91FDEA1EA827'){throw 'Claude 로그인 도구의 해시가 일치하지 않습니다.'}
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $temporary 'expanded')
    $binary=@(Get-ChildItem -LiteralPath (Join-Path $temporary 'expanded') -Filter ant.exe -File -Recurse)
    if($binary.Count -ne 1){throw 'Claude 로그인 실행 파일을 식별할 수 없습니다.'}
    Copy-Item -Path (Join-Path $binary[0].DirectoryName '*') -Destination $destination -Recurse -Force
    if((Get-FileHash -LiteralPath (Join-Path $destination 'ant.exe') -Algorithm SHA256).Hash -ne 'C8CD35B64B3FC495875A48ACD9A1F253B72F7CC28BD28B5702420552B43242E4'){throw 'Claude 실행 파일 확인 실패'}
    foreach($license in @('LICENSE','LICENSE-MIT')){if(-not (Test-Path -LiteralPath (Join-Path $destination $license))){throw 'Claude 라이선스 파일 누락'}}
    Write-Output 'Claude Console OAuth 도구 설치 완료 (공식 ant 2.3.0).'
} finally {
    $resolved=[IO.Path]::GetFullPath($temporary)
    if($resolved.StartsWith($AppRoot+'\cache\ant-install-',[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
