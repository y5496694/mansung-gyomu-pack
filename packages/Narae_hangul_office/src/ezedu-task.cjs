'use strict';
function ezeduTask(prompt,{domain='',canUse=false,now=new Date()}={}){
 if(!canUse||!(/일정|스케[줄쥴]/.test(prompt)||domain==='ezedu'&&/오늘|내일|모레|어제|이번\s*주|다음\s*주|지난\s*주|이번\s*달|다음\s*달|조회|뭐.*있/.test(prompt)||/이지\s*에듀/.test(prompt)&&/조회|알려|보여|확인|요약|정리/.test(prompt))||/등록|추가|생성|입력|넣어|저장|수정|삭제|보내|전송|작성|사용법|어떻게.*사용|나래톡|캘린더|시간표|교시|쪽지|메신저|포[털탈]|나이스/.test(prompt))return null;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(now),base=new Date(today+'T00:00:00Z'),iso=date=>date.toISOString().slice(0,10);let from,to;
 const explicit=[...prompt.matchAll(/\b(20\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\b/g)].map(match=>match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0'));
 const year=prompt.match(/\b(20\d{2})\s*년/)?.[1]||today.slice(0,4),partial=[...prompt.matchAll(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)].map(match=>year+'-'+match[1].padStart(2,'0')+'-'+match[2].padStart(2,'0'));
 const dates=explicit.length?explicit:partial;
 if(dates.length){[from,to]=[dates[0],dates[1]||dates[0]];if(dates.length>2||dates.some(date=>!Number.isFinite(Date.parse(date+'T00:00:00Z'))||iso(new Date(date+'T00:00:00Z'))!==date)||to<from)return {area:'ezedu',observe:false,error:'조회할 날짜 또는 기간을 확인해 주세요.'};}
 else if(/이번\s*주|금주|다음\s*주|차주|지난\s*주|전주/.test(prompt)){base.setUTCDate(base.getUTCDate()-(base.getUTCDay()+6)%7+(/다음\s*주|차주/.test(prompt)?7:/지난\s*주|전주/.test(prompt)?-7:0));const weekday=prompt.match(/([월화수목금토일])요일/);if(weekday)base.setUTCDate(base.getUTCDate()+'월화수목금토일'.indexOf(weekday[1]));from=iso(base);if(!weekday)base.setUTCDate(base.getUTCDate()+6);to=iso(base);}
 else if(/이번\s*(?:달|월)|다음\s*달|지난\s*달|\d{1,2}\s*월/.test(prompt)){const month=prompt.match(/(?<!\d)(\d{1,2})\s*월/);if(month&&(Number(month[1])<1||Number(month[1])>12))return {area:'ezedu',observe:false,error:'조회할 월을 확인해 주세요.'};base.setUTCDate(1);base.setUTCFullYear(Number(year));base.setUTCMonth(month?Number(month[1])-1:base.getUTCMonth()+(/다음\s*달/.test(prompt)?1:/지난\s*달/.test(prompt)?-1:0));from=iso(base);base.setUTCMonth(base.getUTCMonth()+1,0);to=iso(base);}
 else{const weekday=prompt.match(/([월화수목금토일])요일/);if(weekday)base.setUTCDate(base.getUTCDate()-(base.getUTCDay()+6)%7+'월화수목금토일'.indexOf(weekday[1]));else base.setUTCDate(base.getUTCDate()+(/모레/.test(prompt)?2:/내일/.test(prompt)?1:/어제/.test(prompt)?-1:0));from=to=iso(base);}
 return {area:'ezedu',observe:false,from,to,brief:/간단|간략|타이틀|제목\s*만/.test(prompt),kind:/개인/.test(prompt)?'personal':/학교/.test(prompt)?'school':/그룹/.test(prompt)?'group':/복무기타/.test(prompt)?'other':'all'};
}
function ezeduStep(task,input,all){
 if(task.error)return {tools:[],receipt:task.error};
 const observed=input.flatMap(item=>{if(item.type!=='function_call_output')return [];const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);if(!call)return [];try{return [{name:call.name,args:JSON.parse(call.arguments),value:JSON.parse(item.output)}];}catch{return [];}});
 const fixed=(name,args,instructions)=>{const original=all.find(tool=>tool.name===name);if(!original)return {tools:[],receipt:'이지에듀 친구의 사용 안내와 일정 조회 도구를 먼저 설치하세요.'};return {tools:[{...original,parameters:{type:'object',properties:Object.fromEntries(Object.entries(args).map(([key,value])=>[key,{type:'string',enum:[value]}])),required:Object.keys(args),additionalProperties:false}}],required:true,context:{source:'이지에듀 일정 조회 단계',from:task.from,to:task.to,kind:task.kind},instructions};};
 const guide=observed.find(o=>o.name==='gyomu_addon_read'&&o.args.id==='ezedu');
 if(!guide)return fixed('gyomu_addon_read',{id:'ezedu',document:'guide'},'설치된 이지에듀 사용 절차를 한 번 읽는다. 사용자 요청은 일정 조회이며 등록하지 않는다.');
 if(guide.value.error)return {tools:[],receipt:'이지에듀 사용 안내를 확인하지 못했습니다. '+guide.value.error};
 const query=observed.find(o=>o.name==='gyomu_ezedu'&&o.args.operation==='list');
 if(!query)return fixed('gyomu_ezedu',{operation:'list',from:task.from,to:task.to,kind:task.kind},'사용자가 요청한 기간과 범위의 이지에듀 일정을 한 번 조회한다. 날짜를 생략하거나 같은 안내를 다시 읽지 않는다.');
 const value=query.value;if(value.error)return {tools:[],receipt:'이지에듀 일정 조회를 완료하지 못했습니다. '+value.error+'\n조회나 등록을 반복하지 않았습니다.'};
 if(value.from!==task.from||value.to!==task.to||!Array.isArray(value.events)||value.events.some(event=>typeof event.date!=='string'||event.date<task.from||event.date>task.to)||Number(value.count)!==value.events.length)return {tools:[],receipt:'이지에듀 응답의 조회 기간 또는 일정 목록을 확인하지 못했습니다. 요청 기간 전체를 조회했다고 처리하지 않았습니다.'};
 const lines=task.brief&&value.events.length?[]:['이지에듀 일정 · '+task.from+' ~ '+task.to,'조회 '+value.events.length+'건'];let length=lines.join('\n').length,shown=0;
 for(const event of value.events){const line=(task.brief?'':'\n')+event.date+(event.category?' ['+event.category+']':'')+' '+String(event.title||'제목 없음')+(!task.brief&&event.detail?'\n'+String(event.detail):'');if(length+line.length>38000)break;lines.push(line);length+=line.length;shown++;}
 if(!value.events.length)lines.push('\n해당 기간에 조회된 일정이 없습니다.');if(shown<value.events.length)lines.push('\n표시 분량을 넘어 '+(value.events.length-shown)+'건을 생략했습니다.');return {tools:[],receipt:lines.join('\n')};
}
module.exports={ezeduTask,ezeduStep};
