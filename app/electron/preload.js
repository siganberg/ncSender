import { contextBridge, nativeTheme, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ncSender', {
  theme: {
    shouldUseDark: () => nativeTheme.shouldUseDarkColors
  },
  
  cnc: {
    // Connection management
    listPorts: () => ipcRenderer.invoke('cnc-list-ports'),
    connect: (portPath, baudRate) => ipcRenderer.invoke('cnc-connect', portPath, baudRate),
    disconnect: () => ipcRenderer.invoke('cnc-disconnect'),
    getStatus: () => ipcRenderer.invoke('cnc-get-status'),
    requestStatus: () => ipcRenderer.invoke('cnc-request-status'),
    
    // Command sending
    sendCommand: (command) => ipcRenderer.invoke('cnc-send-command', command),
    sendRealTimeCommand: (command) => ipcRenderer.invoke('cnc-send-realtime-command', command),
    
    // Event listeners
    onStatus: (callback) => {
      ipcRenderer.on('cnc-status', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('cnc-status');
    },
    onData: (callback) => {
      ipcRenderer.on('cnc-data', (event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('cnc-data');
    },
    onStatusReport: (callback) => {
      ipcRenderer.on('cnc-status-report', (event, status) => callback(status));
      return () => ipcRenderer.removeAllListeners('cnc-status-report');
    },
    onSystemMessage: (callback) => {
      ipcRenderer.on('cnc-system-message', (event, message) => callback(message));
      return () => ipcRenderer.removeAllListeners('cnc-system-message');
    },
    onResponse: (callback) => {
      ipcRenderer.on('cnc-response', (event, response) => callback(response));
      return () => ipcRenderer.removeAllListeners('cnc-response');
    }
  }
});
