'use strict';
/* 冒烟测试：启动无界面窗口，加载渲染页，收集控制台错误并验证 IPC 通路 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const errors = [];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (...args) => {
    // 兼容新旧签名
    let level, message, sourceId, line;
    if (args[0] && typeof args[0] === 'object' && 'level' in args[0]) {
      ({ level, message, sourceId, line } = args[0]);
    } else {
      [, level, message, sourceId, line] = args;
    }
    if (level >= 2) errors.push(`[${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-fail-load', (e, code, desc) => errors.push('did-fail-load: ' + desc));

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise((r) => setTimeout(r, 1200));

  const dom = await win.webContents.executeJavaScript(`(() => ({
    title: document.getElementById('list-title').textContent,
    navItems: document.querySelectorAll('.nav-item').length,
    tabs: document.querySelectorAll('.wb-tab').length,
    hasApi: !!window.api,
    apiKeys: Object.keys(window.api || {}).length
  }))()`);

  const preview = await win.webContents.executeJavaScript(`window.api.preview({
    files: [
      { path: 'D:/demo/上海旅游.png', name: '上海旅游.png', mtime: 1714000000000 },
      { path: 'D:/demo/北京旅游.jpg', name: '北京旅游.jpg', mtime: 1714000000000 }
    ],
    options: { mode: 'custom', nameBank: '风景', numbering: { enabled: true, type: 'number', start: 1, step: 1, pad: 3, position: 'tail' } }
  })`);

  const appInfo = await win.webContents.executeJavaScript('window.api.appInfo()');

  const report = {
    dom,
    preview: preview.map((p) => p.oldName + ' -> ' + p.newName),
    appInfo,
    errors,
  };
  require('fs').writeFileSync(
    path.join(__dirname, 'smoke-result.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  app.exit(errors.length ? 1 : 0);
});
