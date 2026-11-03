param(
    [ValidateSet('Read','Save')][string]$Action,
    [string]$Region,
    [string]$Path = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Aiedue\GyomuNarae\neis-edufine.credentials.clixml')
)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
foreach ($module in @('Microsoft.PowerShell.Security','Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility')) {
    Import-Module (Join-Path $PSHOME "Modules\$module") -ErrorAction Stop
}
$Path = [IO.Path]::GetFullPath($Path)
$helper = Join-Path $PSScriptRoot '..\vendor\narae-gyomu\packages\narae_gyomoo_portal\skills\narae-gyomu-work-portal\scripts\certificate-profile.ps1'
$fields = @('certificate_name','certificate_path','storage_type','storage_name','disk_label','disk_drive')
function Read-Profile {
    if (-not [IO.File]::Exists($Path)) { return $null }
    try { return Import-Clixml -LiteralPath $Path } catch { return $null }
}
function Valid-Profile($profile) {
    return ($null -ne $profile -and $profile.version -eq 1 -and
        $profile.password -is [Security.SecureString] -and $profile.password.Length -gt 0 -and
        $profile.storage_type -in @('HardDisk','Removable') -and
        -not [string]::IsNullOrWhiteSpace($profile.region) -and
        -not [string]::IsNullOrWhiteSpace($profile.certificate_name) -and
        [IO.Path]::IsPathRooted([string]$profile.certificate_path) -and
        ($profile.storage_type -ne 'Removable' -or $profile.disk_label -or $profile.disk_drive))
}
function Write-State($profile) {
    $valid = [bool](Valid-Profile $profile)
    $result = [ordered]@{region=$Region;exists=[IO.File]::Exists($Path);valid=$valid;hasPassword=$valid;regionMismatch=($valid -and $profile.region -ne $Region);certificate_path_exists=$false}
    foreach ($field in $fields) { $result[$field] = if ($valid) { [string]$profile.$field } else { '' } }
    if ($valid) { $result.certificate_path_exists = Test-Path -LiteralPath $profile.certificate_path }
    $result | ConvertTo-Json -Compress
}
$previous = Read-Profile
if ($Action -eq 'Read') { Write-State $previous; exit 0 }
$inputText = [Console]::In.ReadToEnd()
$request = $inputText | ConvertFrom-Json
$inputText = $null
if ([string]::IsNullOrEmpty([string]$request.password)) {
    # A blank edit keeps the encrypted SecureString without ever decrypting it.
    if (-not (Valid-Profile $previous) -or $previous.region -ne $Region) {
        '{"error":"최초 등록이나 교육청 변경 시 인증서 비밀번호를 입력하세요."}'; exit 0
    }
    $password = $previous.password
} else { $password = ConvertTo-SecureString $request.password -AsPlainText -Force }
$request.password = $null
if (-not (Test-Path -LiteralPath $request.certificate_path)) {
    '{"error":"인증서 경로를 찾을 수 없습니다. 디스크 연결과 경로를 확인하세요."}'; exit 0
}
$parent = Split-Path -Parent $Path
[IO.Directory]::CreateDirectory($parent) | Out-Null
$temporary = Join-Path $parent ([Guid]::NewGuid().ToString('N') + '.clixml')
try {
    # Reuse the portal's DPAPI format and private ACL. Publish only a fully
    # validated profile so failed updates leave the previous login usable.
    $parameters = @{Action='Register';Path=$temporary;Region=$Region;StorageType=$request.storage_type;CertificatePath=$request.certificate_path;CertificateName=$request.certificate_name;StorageName=$request.storage_name;DiskLabel=$request.disk_label;DiskDrive=$request.disk_drive;Password=$password}
    $null = & $helper @parameters
    if (-not [IO.File]::Exists($temporary)) { throw 'Profile write failed.' }
    if ([IO.File]::Exists($Path)) {
        [IO.File]::SetAccessControl($Path, (Get-Acl -LiteralPath $temporary))
        [IO.File]::Replace($temporary, $Path, [NullString]::Value)
    } else { [IO.File]::Move($temporary, $Path) }
    Write-State (Read-Profile)
} finally {
    $password = $null
    $parameters = $null
    if ([IO.File]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Force }
}
