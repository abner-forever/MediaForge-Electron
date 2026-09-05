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

export function getDesktopBridge() {
  return window.electronAPI;
}
