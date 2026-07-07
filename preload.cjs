const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: () => true,
  selectDirectory: (args) => ipcRenderer.invoke('select-directory', args),
  processOutline: (args) => ipcRenderer.invoke('process-outline', args),
  comparePdfs: (args) => ipcRenderer.invoke('compare-pdfs', args),
  imageProcess: (args) => ipcRenderer.invoke('image-process', args),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
