param([string]$Destination = 'D:\Codex\apps\NaraeGyomu',[switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$version = 'v0.1.0-preview.1'
$base = "https://github.com/y5496694/narae-gyomu/releases/download/$version"
$downloads = 'D:\Codex\downloads\narae-gyomu-0.1.0'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$manifestFile = Join-Path $downloads 'release-manifest.json'
Invoke-WebRequest -UseBasicParsing -Uri "$base/release-manifest.json" -OutFile $manifestFile
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne '0.1.0-preview.1') { throw '배포 버전이 일치하지 않습니다.' }
Write-Host '나래교무와 세 AI 모델을 내려받습니다. 모델이 포함되어 용량이 큽니다.'
foreach ($part in $manifest.parts) {
  if ($part.name -notmatch '^NaraeGyomu-0\.1\.0-win-x64\.zip\.part\d{2}$') { throw '잘못된 배포 파일명입니다.' }
  $target = Join-Path $downloads $part.name
  if ((Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $part.sha256)) { continue }
  Write-Host "다운로드: $($part.name)"
  & curl.exe --location --fail --retry 3 --continue-at - --output $target "$base/$($part.name)"
  if ($LASTEXITCODE -ne 0) { throw '다운로드가 중단됐습니다. 같은 설치 스크립트를 다시 실행하면 이어받습니다.' }
  if ((Get-Item -LiteralPath $target).Length -ne $part.bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $part.sha256) { throw "파일 검증 실패: $target" }
}
$archive = Join-Path $downloads $manifest.archive
$stream = [IO.File]::Open($archive,[IO.FileMode]::Create,[IO.FileAccess]::Write)
try {
  foreach ($part in $manifest.parts) {
    $inputStream = [IO.File]::OpenRead((Join-Path $downloads $part.name))
    try { $inputStream.CopyTo($stream) } finally { $inputStream.Dispose() }
  }
} finally { $stream.Dispose() }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $manifest.archive_sha256) { throw '전체 설치 파일의 해시가 일치하지 않습니다.' }
$dest = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $dest) { throw "기존 폴더를 보존했습니다. -Destination으로 새 폴더를 지정하세요: $dest" }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Write-Host '압축을 풉니다.'
& tar.exe -xf $archive -C $dest
if ($LASTEXITCODE -ne 0) { throw "압축 해제에 실패했습니다. 설치 파일은 $archive 에 있습니다." }
& (Join-Path $dest 'install.ps1') -InstallDirectory $dest
Write-Host "설치 완료: $dest"
if (-not $NoLaunch) { Start-Process -FilePath (Join-Path $dest 'NaraeGyomu.exe') }
