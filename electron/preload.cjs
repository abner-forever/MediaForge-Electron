const { contextBridge, ipcRenderer } = require('electron');

let updaterListenerId = 0;
const updaterListeners = new Map();

const electronAPI = {
  saveFile: (filename, content, mimeType) =>
    ipcRenderer.invoke('desktop:save-file', filename, content, mimeType),
  openExternal: (url) =>
    ipcRenderer.invoke('desktop:open-external', url),
  setNativeTheme: (theme) =>
    ipcRenderer.invoke('desktop:set-native-theme', theme),
  getAppInfo: () =>
    ipcRenderer.invoke('desktop:get-app-info'),
  checkForUpdates: () =>
    ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () =>
    ipcRenderer.invoke('desktop:download-update'),
  quitAndInstall: () =>
    ipcRenderer.invoke('desktop:quit-and-install'),
  ignoreUpdate: (version) =>
    ipcRenderer.invoke('desktop:ignore-update', version),
  onUpdaterEvent: (callback) => {
    const id = ++updaterListenerId;
    const listener = (_event, payload) => callback(payload);
    updaterListeners.set(id, listener);
    ipcRenderer.on('updater:event', listener);
    return id;
  },
  offUpdaterEvent: (id) => {
    const listener = updaterListeners.get(id);
    if (listener) {
      ipcRenderer.removeListener('updater:event', listener);
      updaterListeners.delete(id);
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
