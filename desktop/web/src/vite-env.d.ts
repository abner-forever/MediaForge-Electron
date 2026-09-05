/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface DesktopUpdaterEvent {
  type: 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  version?: string;
  currentVersion?: string;
  message?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  manual?: boolean;
}

interface ElectronDesktopApi {
  saveFile(filename: string, content: string, mimeType?: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  setNativeTheme(theme: string): Promise<boolean>;
  getAppInfo(): Promise<{ version: string; platform: string; packaged: boolean }>;
  checkForUpdates(): Promise<{ ok: boolean }>;
  downloadUpdate(): Promise<boolean>;
  quitAndInstall(): Promise<boolean>;
  ignoreUpdate(version: string): Promise<boolean>;
  onUpdaterEvent(callback: (payload: DesktopUpdaterEvent) => void): number;
  offUpdaterEvent(id: number): void;
}

interface Window {
  electronAPI?: ElectronDesktopApi;
}
