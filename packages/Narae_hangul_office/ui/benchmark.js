(()=>{
 const el=id=>document.getElementById(id),dialog=el('officeBenchDialog');let current;
 const label=status=>({passed:'통과',incomplete:'미완료',unverified:'미검증'}[status]);
 function render(value){current=value;el('officeBenchSummary').textContent='실환경 검증 통과 '+value.passedLiveTasks+' / '+value.requiredTasks+'개 · '+(value.releasePassed?'전체 합격':'전체 합격 미확인');el('officeBenchTasks').replaceChildren();
  for(const task of value.tasks){const card=document.createElement('article');card.className='bench-task';const title=document.createElement('h3');title.textContent=task.number+'. '+task.title;const text=document.createElement('p');text.textContent=task.requirement;const state=document.createElement('p');state.className='bench-state';state.textContent='모의 검증: '+label(task.synthetic.status)+' · 실환경 검증: '+label(task.live.status);card.append(title,text,state);el('officeBenchTasks').append(card);}
  const errors=Object.values(value.records).filter(r=>r.error).map(r=>r.error);el('officeBenchNotice').hidden=!errors.length;el('officeBenchNotice').textContent=errors.join('\n');
 }
 async function refresh(method='officeBenchStatus'){try{render(await window.narae.call(method));}catch(e){el('officeBenchNotice').hidden=false;el('officeBenchNotice').textContent='검증 기록을 확인하지 못했습니다. '+e.message;}}
 el('agentBenchmark').onclick=()=>{dialog.showModal();void refresh();};el('closeOfficeBench').onclick=()=>dialog.close();el('refreshOfficeBench').onclick=()=>void refresh();el('importOfficeBench').onclick=()=>void refresh('officeBenchImport');
 el('copyOfficeBench').onclick=async()=>{if(!current)return;try{await navigator.clipboard.writeText(current.tasks.map(t=>t.number+'. '+t.title+'\n'+t.requirement).join('\n\n'));el('officeBenchSummary').textContent='필수 업무 10개 목록을 복사했습니다.';}catch{el('officeBenchNotice').hidden=false;el('officeBenchNotice').textContent='목록 복사를 완료하지 못했습니다.';}};
})();
