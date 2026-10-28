const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('narae',{call:(name,args)=>ipcRenderer.invoke('narae:call',name,args),onEvent:callback=>{const listener=(_event,event)=>callback(event);ipcRenderer.on('narae:event',listener);return()=>ipcRenderer.removeListener('narae:event',listener);}});
