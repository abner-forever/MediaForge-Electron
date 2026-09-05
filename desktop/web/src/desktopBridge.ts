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
  status: 'checking' | 'up-to-date' | 'available' | 'error' | 'dev';
  message: string;
  version?: string;
} | null> {
  if (window.electronAPI?.checkForUpdates) {
    return window.electronAPI.checkForUpdates();
  }
  return { status: 'error', message: '当前环境不支持检查更新' };
}

export function getDesktopBridge() {
  return window.electronAPI;
}
