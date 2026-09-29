import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('diffx', {
  selectFolder: () => ipcRenderer.invoke('diffx:select-folder'),
  openRepo: (path: string) => ipcRenderer.invoke('diffx:open-repo', path),
  getRecent: () => ipcRenderer.invoke('diffx:get-recent'),
  removeRecent: (path: string) => ipcRenderer.invoke('diffx:remove-recent', path),
})
