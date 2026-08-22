// Sandboxed preloads must be CommonJS — contextBridge + ipcRenderer only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qodea', {
  listProviders: () => ipcRenderer.invoke('qodea:providers'),

  sessionsList: () => ipcRenderer.invoke('qodea:sessions:list'),
  sessionGet: (id) => ipcRenderer.invoke('qodea:sessions:get', id),
  sessionDelete: (id) => ipcRenderer.invoke('qodea:sessions:delete', id),

  getConfig: () => ipcRenderer.invoke('qodea:getConfig'),
  saveConfig: (payload) => ipcRenderer.invoke('qodea:saveConfig', payload),
  listModels: (req) => ipcRenderer.invoke('qodea:listModels', req),

  startSession: (req) => ipcRenderer.invoke('qodea:start', req),

  respondPermission: (sessionId, requestId, approved) =>
    ipcRenderer.invoke('qodea:respond', { sessionId, requestId, approved }),

  stopSession: (sessionId) => ipcRenderer.invoke('qodea:stop', sessionId),

  /** Subscribe to agent events; returns an unsubscribe function. */
  onEvent: (callback) => {
    const listener = (_event, sessionId, payload) => callback(sessionId, payload);
    ipcRenderer.on('qodea:event', listener);
    return () => ipcRenderer.removeListener('qodea:event', listener);
  },
});
