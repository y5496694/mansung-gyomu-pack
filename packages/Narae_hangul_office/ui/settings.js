(()=>{
 'use strict';const dialog=document.getElementById('settingsDialog'),notice=document.getElementById('settingsNotice'),tabs=[...dialog.querySelectorAll('[data-settings-tab]')],loaders=new Map();let active='general';
 async function select(name){const selected=tabs.find(tab=>tab.dataset.settingsTab===name);if(!selected)return;active=name;notice.hidden=true;for(const tab of tabs){const current=tab===selected;tab.setAttribute('aria-selected',String(current));tab.tabIndex=current?0:-1;document.getElementById(tab.getAttribute('aria-controls')).hidden=!current;}
  try{await loaders.get(name)?.();}catch(error){if(active===name){notice.textContent=error.message||'설정을 불러오지 못했습니다.';notice.hidden=false;}}
 }
 async function open(name=active){if(!dialog.open)dialog.showModal();await select(name);}
 function attention(name,pending){const tab=tabs.find(tab=>tab.dataset.settingsTab===name);if(!tab)return;tab.classList.toggle('has-attention',Boolean(pending));const any=tabs.some(t=>t.classList.contains('has-attention')),button=document.getElementById('settingsButton');button.classList.toggle('has-attention',any);button.title=any?'설정 · 승인 대기 중':'설정';}
 for(const [index,tab]of tabs.entries()){tab.onclick=()=>void open(tab.dataset.settingsTab);tab.onkeydown=event=>{const key=event.key;if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(key))return;event.preventDefault();const next=key==='Home'?0:key==='End'?tabs.length-1:(index+(['ArrowDown','ArrowRight'].includes(key)?1:tabs.length-1))%tabs.length;tabs[next].focus();void select(tabs[next].dataset.settingsTab);};}
 document.getElementById('settingsButton').onclick=()=>void open();document.getElementById('closeSettings').onclick=()=>dialog.close();
 window.naraeSettings={open,close:()=>dialog.close(),onOpen:(name,loader)=>loaders.set(name,loader),attention};
})();
