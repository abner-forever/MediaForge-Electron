export async function saveFileWithDialog(
  filename: string,
  content: string,
  mimeType = 'text/csv',
): Promise<boolean> {
  if (window.electronAPI?.saveFile) {
    return window.electronAPI.saveFile(filename, content, mimeType);
  }

  return false;
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (window.electronAPI?.openExternal) {
    return window.electronAPI.openExternal(url);
  }

  window.open(url, '_blank');
  return true;
}

export async function setNativeTheme(theme: string): Promise<boolean> {
  if (window.electronAPI?.setNativeTheme) {
    return window.electronAPI.setNativeTheme(theme);
  }
  return false;
}

export async function getAppInfo(): Promise<{ version: string; platform: string; packaged: boolean } | null> {
  if (window.electronAPI?.getAppInfo) {
    return window.electronAPI.getAppInfo();
  }
  return null;
}

export async function checkForUpdates(): Promise<{
  ok: boolean;
} | null> {
  if (window.electronAPI?.checkForUpdates) {
    return window.electronAPI.checkForUpdates();
  }
  return null;
}

export async function downloadUpdate(): Promise<boolean> {
  return window.electronAPI?.downloadUpdate ? window.electronAPI.downloadUpdate() : false;
}

export async function quitAndInstall(): Promise<boolean> {
  return window.electronAPI?.quitAndInstall ? window.electronAPI.quitAndInstall() : false;
}

export async function ignoreUpdate(version: string): Promise<boolean> {
  return window.electronAPI?.ignoreUpdate ? window.electronAPI.ignoreUpdate(version) : false;
}

export function onUpdaterEvent(callback: (payload: DesktopUpdaterEvent) => void): () => void {
  if (!window.electronAPI?.onUpdaterEvent) return () => {};
  const id = window.electronAPI.onUpdaterEvent(callback);
  return () => window.electronAPI?.offUpdaterEvent(id);
}

export function getDesktopBridge() {
  return window.electronAPI;
}
