$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 if($request.operation -eq 'discover') { @((Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.ProcessName -match 'messenger|talk|cool|cbe|ucware'}) | ForEach-Object { @{pid=$_.Id;hwnd=('0x{0:x}' -f $_.MainWindowHandle.ToInt64());title=$_.MainWindowTitle;process=$_.ProcessName} }) | ConvertTo-Json -Depth 4 -Compress;exit }
 $process=Get-Process -Id $request.pid
 $executable=$process.Path
 $sha=(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
 $product=[Diagnostics.FileVersionInfo]::GetVersionInfo($executable)
 if(($product.ProductName+' '+$product.FileDescription+' '+$process.ProcessName) -notmatch 'messenger|메신저|talk|cool|ucware') {throw '교육청 메신저로 식별되지 않은 프로그램입니다.'}
 if($request.sha256 -and $request.sha256 -ne $sha) {throw '연결 후 실행 파일이 변경됐습니다. 다시 확인하여 bind하세요.'}
 $handle=[IntPtr][Convert]::ToInt64(($request.hwnd -replace '^0x',''),16)
 $window=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 if($window.Current.ProcessId -ne $process.Id) {throw '실제 창의 소유 프로세스가 다릅니다.'}
 $nodes=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition))
 if($nodes.Count -gt 600) {throw '접근성 항목이 600개를 넘어 부분 자료로 변경하지 않습니다.'}
 $items=@();$map=@{}
 foreach($node in $nodes) {
  $current=$node.Current
  if($current.IsOffscreen) {continue}
  $ref='e'+$items.Count
  $value=$null;$text=$null;$pattern=$null
  if(-not $current.IsPassword) {
   if($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {$value=$pattern.Current.Value}
   $pattern=$null
   if($node.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)) {$text=$pattern.DocumentRange.GetText(8000)}
  }
  $item=[ordered]@{ref=$ref;runtimeId=@($node.GetRuntimeId());role=$current.ControlType.ProgrammaticName;name=$current.Name;automationId=$current.AutomationId;enabled=$current.IsEnabled;password=$current.IsPassword;value=$value;text=$text}
  $items+=,$item;$map[$ref]=$node
 }
 $snapshot=[ordered]@{pid=$process.Id;hwnd=$request.hwnd;title=$window.Current.Name;executable=$executable;sha256=$sha;processStarted=$process.StartTime.ToUniversalTime().ToString('o');elements=$items;coverage='visible_accessibility_only';completeHistory=$false}
 $json=$snapshot | ConvertTo-Json -Depth 12 -Compress
 $hasher=[Security.Cryptography.SHA256]::Create()
 $digest=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($json)))).Replace('-','').ToLowerInvariant()
 $snapshot['fingerprint']=$digest
 if($request.operation -eq 'inspect') {$snapshot | ConvertTo-Json -Depth 12 -Compress;exit}
 if($request.snapshot.fingerprint -ne $digest) {throw '직전 조회 후 대상 창이나 표시 내용이 바뀌었습니다. inspect로 다시 확인하세요.'}
 if(-not $map.ContainsKey([string]$request.ref)) {throw '실제 조회에 없는 항목입니다.'}
 $node=$map[[string]$request.ref];$item=$items | Where-Object ref -eq $request.ref
 if($item.password -or -not $item.enabled) {throw '인증정보 또는 비활성 항목은 처리하지 않습니다.'}
 if($request.operation -eq 'read') {@{value=$item.value;text=$item.text;name=$item.name;coverage='visible_accessibility_only';completeHistory=$false} | ConvertTo-Json -Compress;exit}
 $pattern=$null
 if(-not $node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -or $pattern.Current.IsReadOnly -or $pattern.Current.Value) {throw '현재 비어 있는 편집 항목만 입력할 수 있습니다. 기존 초안을 보존했습니다.'}
 $send=$null
 if($request.operation -eq 'send') {
  if(-not $request.expectedTitle -or $window.Current.Name -ne $request.expectedTitle) {throw '전송할 대화방의 실제 전체 창 제목이 일치해야 합니다.'}
  if(-not $map.ContainsKey([string]$request.button)) {throw '실제 전송 버튼 항목이 필요합니다.'}
  $button=$map[[string]$request.button]
  if($button.Current.Name -notin @('보내기','전송','Send') -or -not $button.Current.IsEnabled -or -not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$send)) {throw '실제 지원되는 전송 버튼이 아닙니다.'}
 }
 $pattern.SetValue([string]$request.message)
 if($pattern.Current.Value -ne $request.message -or $window.Current.Name -ne $snapshot.title) {throw '입력 또는 대화방 확인 실패. 전송하지 않았습니다.'}
 if($request.operation -eq 'send') {$send.Invoke();@{submitted=$true;deliveryConfirmed=$false;status='submitted_unconfirmed'} | ConvertTo-Json -Compress}
 else {@{filled=$true;submitted=$false} | ConvertTo-Json -Compress}
} catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress;exit 1 }
