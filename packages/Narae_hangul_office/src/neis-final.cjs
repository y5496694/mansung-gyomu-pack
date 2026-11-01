'use strict';
const {approvalRoute}=require('./neis-approval.cjs');
const norm=s=>String(s??'').replace(/[\s./:\-년월일시분]/g,'');
function neisFinalStep(task,records,all,prepare){
 if(!task.preparation)return null;
 const p=task.preparation.plan,trip=task.preparation.area==='neis-trip',screen=records.findLast(r=>r.call.name==='gyomu_browser'&&!r.value.error)?.value;
 const done=receipt=>({tools:[],receipt});
 const step=(values,instructions)=>{const tool=structuredClone(all.find(t=>t.name==='gyomu_browser'));if(!tool)return done('현재 설치본에 업무 브라우저가 없습니다.');tool.parameters={type:'object',properties:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{type:typeof v,enum:[v]}])),required:Object.keys(values),additionalProperties:false};return {tools:[tool],required:true,instructions,context:{source:'실제 나이스 신청 단계',url:screen?.url,text:screen?.text,tableData:screen?.tableData},procedure:task.instructions};};
 if(records.some(r=>r.call.name==='gyomu_browser'&&r.args.confirmFinalAction===true&&r.value.error))return done('최종 조작 중 오류로 처리 결과가 미확인입니다. 같은 상신을 다시 실행하지 않았습니다. 서버 신청 목록에서 먼저 확인해야 합니다.');
 const attempts=records.filter(r=>r.value.finalAction),accepted=attempts.filter(r=>!(r.value.finalAction.nativeDialog?.type==='confirm'&&r.value.finalAction.nativeDialog.accepted===false));
 if(accepted.length){
  const last=records.indexOf(accepted.at(-1)),after=records.slice(last+1).filter(r=>r.call.name==='gyomu_browser'&&!r.value.error);
  if(!after.length)return step({action:'snapshot'},'최종 처리를 한 번 시도했다. 현재 신청 목록을 재조회하고 같은 상신을 다시 하지 않는다.');
  const matches=[];
  for(const table of screen?.tableData||[]){if(table.hasMore)continue;const find=re=>table.headers.findIndex(h=>re.test(h.replace(/\s/g,''))),date=find(/^(신청일자|시작일자|시작일|출장시작일자)$/),endDate=find(/^(종료일자|종료일|출장종료일자)$/),start=find(/^(시작시각|시작시간)$/),end=find(/^(종료시각|종료시간)$/),kind=find(/^(복무|근무상황|근무상황소분류|종류|출장구분)$/),reason=find(trip?/^(출장목적|목적|용무|사유)$/:/^(사유|용무)$/),status=find(/^(결재상태|신청상태|상태)$/),destination=trip?find(/^(출장지|목적지)$/):-1;
   if([date,start,end,kind,reason,status,...(trip?[destination,endDate]:p.endDate&&p.endDate!==p.date?[endDate]:[])].some(i=>i<0))continue;
   for(const row of table.rows){const pairs=[[row[date],p.date],[row[start],p.start],[row[end],p.end],[row[kind],p.type],[row[reason],trip?p.purpose:p.reason],...(trip?[[row[destination],p.destination],[row[endDate],p.endDate]]:endDate>=0?[[row[endDate],p.endDate||p.date]]:[])];if(pairs.every(([a,b])=>b&&norm(a)===norm(b))&&!/취소|회수|반려|미상신|임시/.test(row[status])&&/결재중|상신|신청완료|승인완료|진행중/.test(row[status]))matches.push({headers:table.headers,row});}
  }
  if(matches.length===1)return done('요청한 '+(trip?'출장':p.type)+'을 상신한 뒤 같은 신청을 서버 목록에서 확인했습니다.\n'+matches[0].headers.join(' | ')+'\n'+matches[0].row.join(' | ')+'\n같은 상신은 반복하지 않았습니다.');
  const next=(screen?.elements||[]).filter(e=>!e.disabled&&/^(신청목록|출장신청목록|출장신청관리|개인근무상황관리|목록)$/.test(e.label.replace(/\s/g,'')));
  if(next.length===1&&!after.some(r=>r.args.action==='click'&&r.args.ref===next[0].ref))return step({action:'click',ref:next[0].ref},'관찰한 신청 목록으로 이동해 요청과 같은 행을 확인한다. 새 신청이나 최종 처리를 만들지 않는다.');
  return done('상신을 한 번 시도했으나 요청한 날짜·시각·종류·사유와 일치하는 서버 신청 행을 유일하게 확인하지 못했습니다. 결과 미확인으로 남겼으며 같은 상신을 반복하지 않았습니다.');
 }
 const preparation=prepare();if(!preparation.readyForFinal)return {...preparation,preparationPending:true};
 const route=approvalRoute(screen),text=screen?.text?.trim();
 const values=[p.date,p.endDate||p.date,p.start,p.end,trip?p.destination:p.type,trip?p.purpose:p.reason,...(trip?[p.type,p.transport,p.cost]:[])];
 if(!route||!text||text.length>3500||values.some(v=>!v||!norm(text).includes(norm(v))))return done('상신 전 요청값과 현재 결재선을 최종 화면에서 모두 확인하지 못했습니다. 최종 처리를 실행하지 않았습니다.');
 if(task.requestedApprovers?.length&&JSON.stringify(route.filter(r=>!/^기안$/.test(r.role)).map(r=>r.name))!==JSON.stringify(task.requestedApprovers))return done('현재 결재선의 구성원·순서가 사용자가 지정한 결재선과 다릅니다. 최종 상신을 실행하지 않았습니다.');
 const buttons=(screen.elements||[]).filter(e=>!e.disabled&&/^(상신|결재상신)$/.test(e.label.replace(/\s/g,'')));
 if(buttons.length!==1||!/^[a-f0-9]{64}$/.test(screen.finalState||''))return done('상신할 실제 버튼과 최신 화면 지문을 유일하게 확인하지 못했습니다. 최종 처리를 실행하지 않았습니다.');
 const rejected=attempts.at(-1)?.value.finalAction.nativeDialog;
 if(rejected&&(!/상신|신청|승인요청/.test(rejected.message)||/삭제|회수|반려|발송/.test(rejected.message)))return done('실제 확인창 문구가 요청한 상신과 다릅니다. 확인창을 수락하지 않았습니다.');
 return step({action:'click',ref:buttons[0].ref,confirmFinalAction:true,expectedDocument:text,expectedLabel:buttons[0].label,expectedUrl:screen.url,expectedState:screen.finalState,...(rejected?.type==='confirm'&&rejected.accepted===false?{confirmationText:rejected.message}:{})},'요청값·현재 결재선·최신 화면 지문을 대조한 한 건만 상신한다. 처음 보는 확인창은 기존 브라우저가 닫고 실제 문구를 반환하며, 그 문구를 확인한 뒤에만 이어 처리한다.');
}
module.exports={neisFinalStep};
