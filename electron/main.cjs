const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

process.env.MEDIAFORGE_PACKAGED = app.isPackaged ? '1' : '0';
const { startServer } = require('./backend');

const APP_NAME = '图文工坊';
const APP_ID = 'com.mediaforge.app';
const PREFERRED_PORT = 8765;

let mainWindow = null;
let backendServer = null;
let backendPort = null;
let forceClose = false;
let quitting = false;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
const devWindowIcon = app.isPackaged
  ? undefined
  : path.join(__dirname, '..', 'desktop', 'web', 'public', 'logo-icon.png');

app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

function log(message) {
  console.log(`[MediaForge] ${message}`);
}

function updateStatePath() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(updateStatePath(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeUpdateState(patch = {}) {
  const state = readUpdateState();
  Object.assign(state, patch);
  fs.mkdirSync(path.dirname(updateStatePath()), { recursive: true });
  fs.writeFileSync(updateStatePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function emitUpdaterEvent(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:event', payload);
  }
}

function parseVersion(value) {
  return String(value || '')
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isVersionNewer(candidate, current) {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i] || 0;
    const b = right[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isUpdaterDisabled() {
  return process.env.MEDIAFORGE_DISABLE_UPDATER === '1';
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) emitUpdaterEvent({ type: 'up-to-date', message: '开发模式不支持检查更新', currentVersion: app.getVersion(), manual: true });
    return;
  }
  if (isUpdaterDisabled()) {
    if (manual) emitUpdaterEvent({ type: 'error', message: '更新功能已关闭' });
    return;
  }
  if (updateCheckInProgress) return;

  updateCheckInProgress = true;
  try {
    if (manual) emitUpdaterEvent({ type: 'checking', message: '正在检查更新...' });
    const result = await autoUpdater.checkForUpdates();
    const currentVersion = app.getVersion();
    const latestVersion = result?.updateInfo?.version || '';
    if (!latestVersion || !isVersionNewer(latestVersion, currentVersion)) {
      if (manual) emitUpdaterEvent({ type: 'up-to-date', message: '当前已是最新版本', currentVersion, manual: true });
      return;
    }

    if (!manual && readUpdateState().ignoredVersion === latestVersion) return;
    emitUpdaterEvent({
      type: 'available',
      version: latestVersion,
      currentVersion,
      message: `发现新版本 v${latestVersion}`,
      manual,
    });
  } catch (error) {
    const message = error?.message || '检查更新失败';
    if (manual) emitUpdaterEvent({ type: 'error', message });
    else console.error('[MediaForge updater] check failed:', error);
  } finally {
    updateCheckInProgress = false;
  }
}

async function autoCheckToday() {
  if (!app.isPackaged || isUpdaterDisabled()) return;
  const state = readUpdateState();
  const today = todayKey();
  if (state.lastAutoCheckDate === today) return;
  writeUpdateState({ lastAutoCheckDate: today });
  await checkForUpdates(false);
}

function reservePort(preferredPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => server.listen(0, '127.0.0.1'));
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });
    server.listen(preferredPort, '127.0.0.1');
  });
}

async function startBackend() {
  backendPort = await reservePort(PREFERRED_PORT);
  backendServer = await startServer(backendPort);
}

function stopBackend() {
  quitting = true;
  if (backendServer) {
    try {
      backendServer.close();
    } catch {
      // Server already closed.
    }
  }
}

function showFatalError(message) {
  dialog.showErrorBox(APP_NAME, message);
  stopBackend();
  app.quit();
}

async function getBusyState() {
  if (!backendPort) return { busy: false, publishActive: false, activeTasks: [] };
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/status/active-tasks`);
    if (!response.ok) return { busy: false, publishActive: false, activeTasks: [] };
    const data = await response.json();
    return {
      busy: Boolean(data.publish_active) || (Array.isArray(data.active_tasks) && data.active_tasks.length > 0),
      publishActive: Boolean(data.publish_active),
      activeTasks: Array.isArray(data.active_tasks) ? data.active_tasks : [],
    };
  } catch {
    return { busy: false, publishActive: false, activeTasks: [] };
  }
}

function createChildWindow(url) {
  const child = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 720,
    minHeight: 560,
    title: APP_NAME,
    parent: mainWindow || undefined,
    icon: devWindowIcon,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  child.setMenuBarVisibility(false);
  child.loadURL(url);
  return child;
}

async function confirmClose() {
  const state = await getBusyState();
  if (!state.busy) {
    forceClose = true;
    return true;
  }

  const detail = state.publishActive
    ? '正在发布公众号文章，确定要退出吗？'
    : `以下任务正在进行中：${state.activeTasks.join('、')}\n\n确定要退出吗？`;
  const result = await dialog.showMessageBox(mainWindow || undefined, {
    type: 'warning',
    buttons: ['退出', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: APP_NAME,
    message: detail,
  });
  if (result.response === 0) {
    forceClose = true;
    return true;
  }
  return false;
}

function createMainWindow() {
  const serverUrl = `http://127.0.0.1:${backendPort}`;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f8f5ff',
    icon: devWindowIcon,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(process.platform === 'darwin');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    createChildWindow(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const origin = new URL(serverUrl);
    if (target.origin !== origin.origin) {
      event.preventDefault();
      createChildWindow(url);
    }
  });

  mainWindow.on('close', async (event) => {
    if (forceClose || quitting) return;
    event.preventDefault();
    const canClose = await confirmClose();
    if (canClose) mainWindow.close();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopBackend();
    app.quit();
  });

  mainWindow.loadURL(serverUrl);
}

function setupIpc() {
  ipcMain.handle('desktop:save-file', async (event, filename, content) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(owner || undefined, {
      title: '保存文件',
      defaultPath: filename,
    });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, Buffer.from(content || '', 'base64'));
    return true;
  });

  ipcMain.handle('desktop:open-external', (_event, url) => {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') shell.openExternal(url);
      else createChildWindow(url);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('desktop:set-native-theme', (_event, theme) => {
    nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system';
    return true;
  });

  ipcMain.handle('desktop:get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle('desktop:check-for-updates', async () => {
    await checkForUpdates(true);
    return { ok: true };
  });

  ipcMain.handle('desktop:download-update', async () => {
    if (!app.isPackaged || isUpdaterDisabled() || updateDownloadInProgress) return false;
    updateDownloadInProgress = true;
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      emitUpdaterEvent({ type: 'error', message: error?.message || '下载更新失败' });
      return false;
    } finally {
      updateDownloadInProgress = false;
    }
  });

  ipcMain.handle('desktop:quit-and-install', () => {
    if (app.isPackaged) autoUpdater.quitAndInstall(false, true);
    return true;
  });

  ipcMain.handle('desktop:ignore-update', (_event, version) => {
    writeUpdateState({ ignoredVersion: String(version || '') });
    return true;
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged || isUpdaterDisabled()) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => {
    console.error('[MediaForge updater]', error);
    emitUpdaterEvent({ type: 'error', message: error?.message || '更新失败' });
  });
  autoUpdater.on('download-progress', (progress) => {
    emitUpdaterEvent({
      type: 'downloading',
      percent: Math.floor(progress.percent || 0),
      transferred: progress.transferred || 0,
      total: progress.total || 0,
      bytesPerSecond: progress.bytesPerSecond || 0,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emitUpdaterEvent({
      type: 'downloaded',
      version: info.version,
      message: `v${info.version} 已下载完成，是否立即重启安装？`,
    });
  });

  setTimeout(() => {
    autoCheckToday().catch((error) => {
      console.error('[MediaForge updater] auto check failed:', error);
    });
  }, 8000);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    setupIpc();
    try {
      await startBackend();
      createMainWindow();
      setupAutoUpdater();
    } catch (error) {
      showFatalError(error instanceof Error ? error.message : String(error));
    }
  });

  app.on('window-all-closed', () => {
    stopBackend();
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendPort) createMainWindow();
  });
}
