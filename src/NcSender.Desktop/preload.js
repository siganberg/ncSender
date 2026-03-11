const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ncSender', {
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    isKiosk: () => ipcRenderer.invoke('app:isKiosk'),
  },
});
