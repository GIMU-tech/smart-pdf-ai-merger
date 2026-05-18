const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: () => true,
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  processOutline: (args) => ipcRenderer.invoke('process-outline', args),
  comparePdfs: (args) => ipcRenderer.invoke('compare-pdfs', args),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
