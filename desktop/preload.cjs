const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('numoraDesktop', {
  selectWorkspaceDirectory: () => ipcRenderer.invoke('numora:choose-workspace-directory'),
})
