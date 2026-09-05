const { contextBridge, ipcRenderer } = require('electron');

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
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
