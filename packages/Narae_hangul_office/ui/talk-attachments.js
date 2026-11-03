(()=>{'use strict';
 let depth=0,imports=0;const chat=document.querySelector('.talk-chat'),overlay=node('div','파일을 놓아 첨부하세요','attachment-drop');overlay.hidden=true;overlay.setAttribute('aria-hidden','true');chat.append(overlay);
 const fileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
 async function importFiles(work){imports++;attachmentBusy=true;updateComposer();status('파일을 첨부하고 있습니다…');try{const result=await work();attachments.push(...(Array.isArray(result)?result:result?[result]:[]));showAttachments();status('파일을 첨부했습니다. 메시지를 입력해 전송하세요.');}catch(error){report(error);}finally{imports--;attachmentBusy=imports>0;updateComposer();}}
 $('attachFile').onclick=()=>void importFiles(()=>call('talkAttach'));
 document.addEventListener('dragover',event=>{if(fileDrag(event)){event.preventDefault();event.dataTransfer.dropEffect=separate?'copy':'none';}});
 chat.addEventListener('dragenter',event=>{if(fileDrag(event)&&separate){event.preventDefault();depth++;overlay.hidden=false;}});
 chat.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;overlay.hidden=true;}});
 document.addEventListener('drop',event=>{const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;event.preventDefault();depth=0;overlay.hidden=true;if(separate)void importFiles(()=>window.narae.importFiles(files));});
 document.addEventListener('dragend',()=>{depth=0;overlay.hidden=true;});
 chat.addEventListener('paste',event=>{if(!separate||!Array.from(event.clipboardData?.items||[]).some(item=>item.kind==='file'&&item.type.startsWith('image/')))return;event.preventDefault();void importFiles(()=>call('talkPasteImage'));});
})();
