// DSH Desktop — Electron shell around the DSH web UI.
// Starts `dsh web` as localagent (passwordless via /etc/sudoers.d/dsh-web),
// reads the printed URL (with launch token) from stdout, and opens it in a
// native window. Stops the server when the window/app closes.
// The launch token is kept in memory only and never logged or written to disk.
//
// QQ gradient background (2026-11-06, user-approved): after every page load
// the app injects qq-gradient.css (same folder) via webContents.insertCSS.
// The CSS only changes the main-area background (DSH's --dsw-alias-bg-base
// token -> transparent, animated QQ gradient on <body>); the sidebar keeps
// its own dark fill, and no font/layout/text is touched. To revert, delete
// qq-gradient.css (or remove the hook below) and restart the app.
//
// Top menu bar (2026-11-07, v1.1.6, user request): the native
// "File Edit View Window" application menu is hidden
// (autoHideMenuBar — Alt still brings it back if ever needed).
// It is NOT a DOM element, so the injected CSS cannot remove it;
// this is the only place it can be hidden. Window dragging,
// resizing, and closing are unaffected (the window keeps its frame).
'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LAUNCHER = '/opt/localagent/bin/dsh-web-launch';
const START_TIMEOUT_MS = 60000;
const URL_RE = /dsh web:\s*(https?:\/\/\S+)/;
const QQ_GRADIENT_CSS_PATH = path.join(__dirname, 'qq-gradient.css');
const QQ_GRADIENT_LOG = '/tmp/dsh-desktop-qq-gradient.log';

let serverProc = null;
let mainWindow = null;
let qqGradientCss = null;

function loadQqGradientCss() {
  try {
    const css = fs.readFileSync(QQ_GRADIENT_CSS_PATH, 'utf8');
    qqGradientCss = css.trim() ? css : null;
  } catch (e) {
    qqGradientCss = null;
  }
  return qqGradientCss;
}

function logQqGradient(msg) {
  try {
    fs.appendFileSync(QQ_GRADIENT_LOG, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) { /* logging must never break the app */ }
}

async function injectQqGradient() {
  if (!qqGradientCss) return;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  try {
    const key = await mainWindow.webContents.insertCSS(qqGradientCss);
    logQqGradient('QQ gradient CSS injected (key ' + key + ')');
  } catch (e) {
    logQqGradient('QQ gradient CSS inject FAILED: ' + (e && e.message ? e.message : String(e)));
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', '-u', 'localagent', LAUNCHER], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc = child;
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('DSH 服务启动超时：60 秒内没有输出访问地址。\n请确认 DSH 安装完好，或稍后重试。'));
      }
    }, START_TIMEOUT_MS);
    const onData = (chunk) => {
      out += chunk.toString();
      const m = out.match(URL_RE);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('无法启动 DSH 服务：' + (err && err.message ? err.message : String(err))));
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('DSH 服务意外退出（code ' + code + '）。\n' + out.slice(-400)));
      }
    });
  });
}

function stopServer() {
  if (!serverProc) return;
  const pid = serverProc.pid;
  serverProc = null;
  try { process.kill(-pid, 'SIGTERM'); } catch (e) { /* already gone */ }
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  }, 3000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'DeepSeek Harness',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f1115',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.maximize();
  win.show();
  // Re-inject the QQ gradient on every (re)load so a refresh or in-app
  // navigation can never silently drop it.
  win.webContents.on('did-finish-load', () => { injectQqGradient(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Keep the DSH UI in the window; open outside links in the system browser.
    if (/^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  return win;
}

function loadingHtml() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title></head>' +
    '<body style="margin:0;background:#0f1115;color:#e8e8e8;font-family:sans-serif;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:14px">' +
    '<div style="font-size:22px">正在启动 DeepSeek Harness…</div>' +
    '<div style="font-size:13px;color:#9aa0a6">首次启动约需 10–20 秒，请稍候</div>' +
    '</body></html>'
  );
}

app.whenReady().then(async () => {
  if (loadQqGradientCss()) {
    logQqGradient('QQ gradient CSS loaded from ' + QQ_GRADIENT_CSS_PATH);
  } else {
    logQqGradient('QQ gradient CSS NOT found/empty at ' + QQ_GRADIENT_CSS_PATH + ' — running without gradient');
  }
  mainWindow = createWindow();
  mainWindow.loadURL(loadingHtml());
  try {
    const url = await startServer();
    await mainWindow.loadURL(url);
  } catch (err) {
    dialog.showErrorBox('DSH 启动失败', String((err && err.message) || err));
    stopServer();
    app.quit();
    return;
  }
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', () => { stopServer(); });
