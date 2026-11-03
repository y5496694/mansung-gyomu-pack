(()=>{
 const el=id=>document.getElementById(id),dialog=el('modelReliabilityDialog'),cache=new Map();let current;
 const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
 const rate=value=>value?.percent===null||value?.percent===undefined?'미집계':value.percent+'%';
 const labels={success:'성공',failure:'실패',partial:'부분 완료',unverified:'미확인',cancelled:'취소'};
 function update(){for(const span of document.querySelectorAll('.model-reliability-rate')){const value=cache.get(span.dataset.model);span.textContent=value?.error?'확인 불가':rate(value);span.title=value?`실제 확인 ${value.total}건 중 성공 ${value.success}건 · 미확인 ${value.unverified}건`:'실제 수행 기록을 불러오는 중입니다.';}}
 async function load(){try{for(const value of await window.narae.call('modelReliabilityState'))cache.set(value.id,value);}catch{cache.clear();}update();}
 function render(value){
  cache.set(value.id,value);update();el('modelReliabilityTitle').textContent=value.label+' 신뢰도';
  el('modelReliabilitySummary').textContent=rate(value)+' · 성공 '+value.success+' / 확인 '+value.total+'건 · 실패·부분 완료 '+value.failure+'건 · 미확인 '+value.unverified+'건 · 취소 '+value.cancelled+'건';el('modelReliabilityRule').textContent=value.rule;
  el('modelReliabilityNotice').hidden=!value.error;el('modelReliabilityNotice').textContent=value.error||'';
  const list=el('modelReliabilityRecords');list.replaceChildren();
  if(!value.records.length){list.append(node('li','확인 가능한 실제 수행 기록이 없습니다. 가상·모의 시험 점수는 표시하지 않습니다.','reliability-empty'));return;}
  for(const row of value.records){
   const item=node('li',undefined,'reliability-case'),details=document.createElement('details'),heading=document.createElement('summary');
   heading.append(node('strong',row.title),node('span',row.kind==='service-test'?'실서비스 시험':'실제 업무','reliability-outcome'),node('span',labels[row.outcome]||'미확인','reliability-outcome '+row.outcome));details.append(heading);
   const time=new Date(row.at),date=Number.isNaN(time.valueOf())?'날짜 미확인':time.toLocaleString('ko-KR');details.append(node('p',date+' · '+(row.kind==='service-test'?'실서비스 시험':'실제 업무')+' · '+(row.environment==='real-file'?'실제 파일':'실제 시스템'),'reliability-meta'));
   const pair=node('div',undefined,'reliability-pair');for(const [title,text,missing]of [['프롬프트',row.prompt,'프롬프트 원문이 보존되지 않았습니다. 아래 수행 근거를 확인하세요.'],[row.responseKind==='tool-error'?'도구 오류 응답 · AI 최종 응답 미보존':'응답',row.response,'최종 응답 원문이 보존되지 않았습니다. 확인되지 않은 응답을 재구성하지 않았습니다.']]){const section=document.createElement('section');section.append(node('h3',title),node('pre',text??missing,text===null?'reliability-missing':''));pair.append(section);}details.append(pair,node('h3','수행 결과 확인'),node('p',row.verification));
   details.append(node('p',row.evidenceVerified?'원본 근거 '+row.sourceCount+'개 · SHA256 및 결과 값 일치':'집계 제외 · '+(row.reason||'원본 근거 미확인'),'reliability-meta'));
   item.append(details);list.append(item);
  }
 }
 async function refresh(){if(!current)return;el('modelReliabilitySummary').textContent='실제 수행 기록을 확인하고 있습니다…';try{render(await window.narae.call('modelReliabilityState',{id:current}));}catch(error){el('modelReliabilitySummary').textContent='신뢰도를 집계하지 못했습니다.';el('modelReliabilityNotice').hidden=false;el('modelReliabilityNotice').textContent=error.message;}}
 window.naraeReliability={load,attach(card,id){const group=node('div',undefined,'model-reliability'),span=node('span',undefined,'model-reliability-rate'),button=node('button','신뢰도');span.dataset.model=id;button.type='button';button.setAttribute('aria-label',card.querySelector('h3').textContent.split(' · ')[0]+' 신뢰도');button.onclick=()=>{current=id;el('modelReliabilityTitle').textContent='모델 신뢰도';el('modelReliabilityRecords').replaceChildren();el('modelReliabilityNotice').hidden=true;dialog.showModal();void refresh();};group.append(span,button);card.append(group);update();}};
 el('closeModelReliability').onclick=()=>dialog.close();el('refreshModelReliability').onclick=()=>void refresh();
})();
