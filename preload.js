const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boardAPI', {
  list: () => ipcRenderer.invoke('boards:list'),
  getMeta: (id) => ipcRenderer.invoke('boards:getMeta', id),
  putMeta: (meta) => ipcRenderer.invoke('boards:putMeta', meta),
  loadData: (id) => ipcRenderer.invoke('boards:loadData', id),
  saveData: (id, data) => ipcRenderer.invoke('boards:saveData', id, data),
  remove: (id) => ipcRenderer.invoke('boards:remove', id),
  putAsset: (id, bytes) => ipcRenderer.invoke('assets:put', id, bytes),
  assetURL: (id) => ipcRenderer.invoke('assets:url', id),
  exportPDF: (svg, w, h) => ipcRenderer.invoke('export:pdf', svg, w, h),
  isDark: () => ipcRenderer.invoke('theme:get'),
  onCommand: (fn) => ipcRenderer.on('cmd', (_e, cmd, ...args) => fn(cmd, ...args)),
  onFlush: (fn) => ipcRenderer.on('app:flush', async () => {
    try { await fn(); } finally { ipcRenderer.send('app:flushed'); }
  }),
  platform: process.platform,
});
