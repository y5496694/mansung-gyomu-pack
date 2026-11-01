param([string]$RunDirectory,[string]$ProfileHelper)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
foreach($module in @('Microsoft.PowerShell.Security','Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility')){Import-Module (Join-Path $PSHOME "Modules\$module") -ErrorAction Stop}
$testSecret=[guid]::NewGuid().ToString('N')
$secure=ConvertTo-SecureString $testSecret -AsPlainText -Force
& $ProfileHelper -Action Register -Path (Join-Path $RunDirectory 'synthetic.clixml') -Region fixture -StorageType HardDisk -CertificatePath $RunDirectory -CertificateName 'Synthetic Certificate' -Password $secure | Out-Null
$sha=[System.Security.Cryptography.SHA256]::Create()
$digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($testSecret)))).Replace('-','').ToLower()
$sha.Dispose()
@{registered=$true;secretSha256=$digest} | ConvertTo-Json -Compress
$testSecret=$null
