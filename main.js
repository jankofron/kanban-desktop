const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_BOARD_URL = 'https://cryptpad.arch-linux.cz/kanban/b/1';
const CONFIG_PATH = path.join(os.homedir(), '.config', 'kanban.conf');
const PARTITION = 'persist:kanban-board';

const Store = require('electron-store').default;
const store = new Store();

let win, tray, saveTimer;

function runCommand(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function getNativeWindowXid(winRef) {
  try {
    const handle = winRef?.getNativeWindowHandle?.();
    if (!Buffer.isBuffer(handle) || handle.length < 4) return null;
    const xid = handle.readUInt32LE(0);
    return xid > 0 ? xid : null;
  } catch {
    return null;
  }
}

function getWindowWorkspace(winRef) {
  if (process.platform !== 'linux') return null;
  const windowXid = getNativeWindowXid(winRef);
  if (windowXid === null) return null;
  const windowId = `0x${windowXid.toString(16)}`;

  const output = runCommand('xprop', ['-id', windowId, '_NET_WM_DESKTOP']);
  const match = output?.match(/=\s*(-?\d+)/);
  if (!match) return null;

  const workspace = Number.parseInt(match[1], 10);
  return Number.isInteger(workspace) && workspace >= 0 ? workspace : null;
}

function moveWindowToWorkspace(winRef, workspace) {
  if (process.platform !== 'linux') return;
  if (!Number.isInteger(workspace) || workspace < 0) return;

  const windowXid = getNativeWindowXid(winRef);
  if (windowXid === null) return;

  const windowIdHex = `0x${windowXid.toString(16)}`;
  const windowIdDec = String(windowXid);
  const workspaceStr = String(workspace);

  // XFCE normally supports wmctrl; xdotool/xprop are fallback paths.
  if (runCommand('wmctrl', ['-i', '-r', windowIdHex, '-t', workspaceStr]) !== null) return;
  if (runCommand('xdotool', ['set_desktop_for_window', windowIdDec, workspaceStr]) !== null) return;
  runCommand('xprop', ['-id', windowIdHex, '-f', '_NET_WM_DESKTOP', '32c', '-set', '_NET_WM_DESKTOP', workspaceStr]);
}

function saveWindowWorkspace(winRef) {
  const workspace = getWindowWorkspace(winRef);
  if (workspace !== null) {
    store.set('windowWorkspace', workspace);
  }
}

function getBoardUrlFromConfig() {
  try {
    const config = fs.readFileSync(CONFIG_PATH, 'utf8');
    const url = config
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#'));

    if (!url) return null;
    new URL(url);
    return url;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to read ${CONFIG_PATH}: ${error.message}`);
    }
    return null;
  }
}

function isKanbanBoardUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname === 'https://cryptpad.arch-linux.cz/kanban' && u.pathname.startsWith('/b/');
  } catch {
    return false;
  }
}

function saveBoardUrl(url) {
  if (!isKanbanBoardUrl(url)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set('lastBoardUrl', url);
  }, 200); // small debounce for SPA churn
}

function createWindow() {
  const { width, height, x, y } = store.get('windowBounds', {
    width: 1200,
    height: 800
  });
  const lastWorkspace = store.get('windowWorkspace');
  
  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 200,
    minHeight: 400,
    show: false,
    icon: path.join(__dirname, 'assets/icons/icon.png'),
    webPreferences: {
      // Keep the site sandboxed; use preload for anything you need
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      partition: PARTITION
    }
  });
  
  win.setMenu(null);

  // Open external links in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Kanban’s own auth popups; open everything else externally
    const allow = url.startsWith('https://cryptpad.arch-linux.cz/kanban') || url.includes('auth');
    if (!allow) shell.openExternal(url);
    return { action: allow ? 'allow' : 'deny' };
  });

  // Optional: tweak UA if Kanban serves odd variants
  // const ua = win.webContents.getUserAgent() + ' KanbanDesktop/0.1';
  // win.webContents.setUserAgent(ua);

  const startUrl = getBoardUrlFromConfig() || store.get('lastBoardUrl') || DEFAULT_BOARD_URL;
  win.loadURL(startUrl);
  win.once('ready-to-show', () => {
    if (Number.isInteger(lastWorkspace) && lastWorkspace >= 0) {
      moveWindowToWorkspace(win, lastWorkspace);
    }
    win.show();
    if (Number.isInteger(lastWorkspace) && lastWorkspace >= 0) {
      setTimeout(() => moveWindowToWorkspace(win, lastWorkspace), 150);
    }
  });

 // Save size and position on move or resize
  win.on('resize', saveBounds);
  win.on('move', () => {
    saveBounds();
    saveWindowWorkspace(win);
  });



  win.webContents.on('did-navigate', (_event, url) => saveBoardUrl(url));

  // In-page navigations (SPA: hash/router changes)
  win.webContents.on('did-navigate-in-page', (_event, url) => saveBoardUrl(url));

  // On close, persist whatever’s currently shown (handles last-second changes)
  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      saveWindowWorkspace(win);
      win.hide();
    }
    const url = win?.webContents?.getURL?.();
    if (url) saveBoardUrl(url);
    if (app.isQuiting) saveWindowWorkspace(win);
  });


  function saveBounds() {
    if (!win.isMinimized() && !win.isMaximized()) {
      store.set('windowBounds', win.getBounds());
    }
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icons/icon.png'));
  tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    { label: 'Show', click: () => { win.show(); win.focus(); } },
    { label: 'Hide', click: () => { saveWindowWorkspace(win); win.hide(); } },
    { type: 'separator' },
    { label: 'Reload', click: () => win.webContents.reload() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setToolTip('Kanban Board');
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) {
      saveWindowWorkspace(win);
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => {
  // On Linux we keep running in tray; don’t quit
  // If you want to quit when last window is closed: app.quit();
});
