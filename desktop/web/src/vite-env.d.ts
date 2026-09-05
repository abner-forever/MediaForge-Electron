/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ElectronDesktopApi {
  saveFile(filename: string, content: string, mimeType?: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  setNativeTheme(theme: string): Promise<boolean>;
  getAppInfo(): Promise<{ version: string; platform: string; packaged: boolean }>;
  checkForUpdates(): Promise<{
    status: 'checking' | 'up-to-date' | 'available' | 'error' | 'dev';
    message: string;
    version?: string;
  }>;
}

interface Window {
  electronAPI?: ElectronDesktopApi;
}
