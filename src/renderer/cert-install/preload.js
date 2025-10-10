const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for certificate installation
contextBridge.exposeInMainWorld('electronAPI', {
  installCertificate: () => ipcRenderer.invoke('install-certificate'),
  sendResponse: (result) => ipcRenderer.send('cert-dialog-response', result)
});

