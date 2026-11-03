const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('naraeDesktop',{
  info:()=>ipcRenderer.invoke('app-info'),
  chooseFiles:()=>ipcRenderer.invoke('choose-files'),
  openOutput:file=>ipcRenderer.invoke('open-output',file)
});
