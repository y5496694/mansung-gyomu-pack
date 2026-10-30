(()=>{
 'use strict';const guide=window.narae3Guide,$=id=>document.getElementById(id),topics=$('guideTopics');
 const node=(tag,text,className)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
 $('guideIntro').textContent=guide.intro;$('guideVersion').textContent='기준: '+guide.updated+' · 오피스 '+guide.version;$('guideModelNote').textContent=guide.modelNote;
 for(const [level,value]of Object.entries(guide.levels)){$('guideLegend').append(node('dt',value.label),node('dd',value.description));}
 for(const category of guide.categories){const option=node('option',category);option.value=category;$('guideCategory').append(option);}
 for(const topic of guide.topics){const card=node('details',null,'guide-topic');card.id='guide-'+topic.id;card.dataset.category=topic.category;card.dataset.search=[topic.title,topic.summary,topic.evidence,...topic.tasks,...topic.examples,...topic.requirements,...topic.limits].join(' ').normalize('NFC').toLocaleLowerCase('ko');
  const summary=node('summary'),badge=node('span',guide.levels[topic.level].label,'guide-level');badge.dataset.level=topic.level;summary.append(node('strong',topic.title),badge,node('small',topic.summary));const body=node('div',null,'guide-topic-body');
  function list(title,items){body.append(node('h4',title));const ul=node('ul');for(const text of items)ul.append(node('li',text));body.append(ul);}
  list('요청할 수 있는 일',topic.tasks);body.append(node('h4','이렇게 요청해 보세요'));
  for(const text of topic.examples){const row=node('div',null,'guide-example'),button=node('button','복사');button.type='button';button.setAttribute('aria-label',topic.title+' 요청 예시 복사');button.onclick=async()=>{try{await navigator.clipboard.writeText(text);$('guideCopyStatus').textContent='요청 예시를 복사했습니다. 날짜·대상·파일명을 확인해 대화창에 붙여 넣으세요.';}catch{$('guideCopyStatus').textContent='복사하지 못했습니다. 예시 문장을 선택해 직접 복사해 주세요.';}};row.append(node('p',text),button);body.append(row);}
  list('사용 전 준비',topic.requirements);list('제한과 확인할 점',topic.limits);body.append(node('h4','확인한 범위'),node('p',topic.evidence,'guide-evidence'));card.append(summary,body);topics.append(card);
 }
 const cards=[...topics.children];let expanded=false;
 function filter(){const query=$('guideSearch').value.trim().normalize('NFC').toLocaleLowerCase('ko'),category=$('guideCategory').value;let count=0;for(const card of cards){card.hidden=Boolean(category&&card.dataset.category!==category||query&&!query.split(/\s+/u).every(word=>card.dataset.search.includes(word)));if(!card.hidden)count++;}$('guideResults').textContent=guide.topics.length+'개 영역 중 '+count+'개 표시 · 예시 복사는 작업을 실행하지 않습니다.';$('guideEmpty').hidden=count>0;$('guideCopyStatus').textContent='';}
 $('guideSearch').addEventListener('input',filter);$('guideCategory').addEventListener('change',filter);$('guideExpand').onclick=()=>{expanded=!expanded;for(const card of cards)card.open=expanded;$('guideExpand').textContent=expanded?'모두 접기':'모두 펼치기';$('guideExpand').setAttribute('aria-pressed',String(expanded));};
 $('agentUserGuide').onclick=()=>void window.naraeSettings.open('guide');filter();
})();
