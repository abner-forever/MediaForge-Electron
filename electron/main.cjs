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
const devWindowIcon = app.isPackaged
  ? undefined
  : path.join(__dirname, '..', 'desktop', 'web', 'public', 'logo-icon.png');

app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

function log(message) {
  console.log(`[MediaForge] ${message}`);
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
    if (!app.isPackaged) {
      return { status: 'dev', message: '开发模式不支持检查更新', version: app.getVersion() };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) {
        return { status: 'up-to-date', message: '当前已是最新版本', version: app.getVersion() };
      }
      const latestVersion = result.updateInfo?.version || '';
      return { status: 'available', message: `发现新版本 v${latestVersion}，正在下载...`, version: latestVersion };
    } catch (error) {
      return { status: 'error', message: error?.message || '检查更新失败', version: app.getVersion() };
    }
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged || process.env.MEDIAFORGE_DISABLE_UPDATER === '1') return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => console.error('[MediaForge updater]', error));
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: APP_NAME,
      message: `新版本 v${info.version} 已下载，是否立即重启安装？`,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[MediaForge updater] check failed:', error);
    });
  }, 5000);
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
