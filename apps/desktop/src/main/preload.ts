import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only way the window reaches the main process: four calls, no Node, no file
 * paths. Everything the window sends is validated on the other side.
 */
contextBridge.exposeInMainWorld('logsy', {
  status: () => ipcRenderer.invoke('logsy:status'),
  examples: () => ipcRenderer.invoke('logsy:examples'),
  example: (id: string) => ipcRenderer.invoke('logsy:example', id),
  openFile: () => ipcRenderer.invoke('logsy:open'),
  analyze: (request: { log: string; name: string; skipRules: boolean; useLlm: boolean }) =>
    ipcRenderer.invoke('logsy:analyze', request),
});
