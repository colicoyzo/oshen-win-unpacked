'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const engine = require('./rename-engine');

let mainWindow = null;
let lastRenameLog = []; // [{from(new), to(old)}] 用于撤销

/* ------------------------------ 窗口 ------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1000,
    minHeight: 620,
    frame: false,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => mainWindow.webContents.send('win:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:state', { maximized: false }));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ------------------------------ 工具 ------------------------------ */

async function statToItem(p) {
  try {
    const st = await fsp.stat(p);
    return {
      path: p,
      name: path.basename(p),
      isDirectory: st.isDirectory(),
      size: st.size,
      mtime: st.mtimeMs,
      atime: st.atimeMs,
      ctime: st.ctimeMs,
    };
  } catch (e) {
    return { path: p, name: path.basename(p), isDirectory: false, error: e.message };
  }
}

async function scanDir(dir, { recursive = false, kind = 'all' } = {}) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      const isDir = ent.isDirectory();
      if (kind === 'file' && isDir) {
        if (recursive) await walk(full);
        continue;
      }
      if (kind === 'folder' && !isDir) continue;
      const item = await statToItem(full);
      out.push(item);
      if (recursive && isDir) await walk(full);
    }
  }
  await walk(dir);
  return out;
}

/* ------------------------------ IPC: 窗口 ------------------------------ */

ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('win:toggle-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow && mainWindow.close());

/* ------------------------------ IPC: 选择文件/文件夹 ------------------------------ */

ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择要处理的文件',
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(statToItem));
});

ipcMain.handle('dialog:pickFolders', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件夹',
    properties: ['openDirectory', 'multiSelections'],
  });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(statToItem));
});

ipcMain.handle('dialog:pickDirToScan', async (e, { recursive = false, kind = 'all' } = {}) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择要扫描的文件夹',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return [];
  return scanDir(r.filePaths[0], { recursive, kind });
});

ipcMain.handle('fs:scanDir', (e, arg) => scanDir(arg.dir, arg));

ipcMain.handle('fs:stat', (e, paths) => Promise.all((paths || []).map(statToItem)));

/* ------------------------------ IPC: 重命名 ------------------------------ */

ipcMain.handle('rename:preview', (e, { files, options }) => {
  return engine.computePreview(files || [], options);
});

ipcMain.handle('rename:apply', async (e, items) => {
  const res = await engine.performRename(items || []);
  if (res.log.length) lastRenameLog = res.log;
  return res;
});

ipcMain.handle('rename:undo', async () => {
  if (!lastRenameLog.length) return { ok: 0, failed: [] };
  const res = await engine.undoRename(lastRenameLog);
  lastRenameLog = [];
  return res;
});

/* ------------------------------ IPC: 时间属性 ------------------------------ */

ipcMain.handle('time:apply', async (e, { paths, mtime, atime }) => {
  let ok = 0;
  const failed = [];
  const m = mtime ? new Date(mtime) : null;
  const a = atime ? new Date(atime) : null;
  for (const p of paths || []) {
    try {
      const st = await fsp.stat(p);
      await fsp.utimes(p, a || st.atime, m || st.mtime);
      ok += 1;
    } catch (err) {
      failed.push({ path: p, reason: err.message });
    }
  }
  return { ok, failed };
});

/* ------------------------------ IPC: 提取名称 ------------------------------ */

ipcMain.handle('extract:names', async (e, { items, ext = '.csv', separator = ',' }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '导出名称列表',
    defaultPath: `名称列表_${Date.now()}${ext}`,
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: 'CSV 文件', extensions: ['csv'] },
    ],
  });
  if (r.canceled || !r.filePath) return { saved: false };
  const lines = (items || []).map((it) => {
    if (separator === ',') {
      // CSV 字段含逗号/引号时按标准加引号转义
      const esc = (v) => {
        const s = String(v == null ? '' : v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return [esc(it.name), esc(it.path)].join(separator);
    }
    if (separator) {
      return [it.name, it.path].join(separator);
    }
    return it.name;
  });
  await fsp.writeFile(r.filePath, '\ufeff' + lines.join('\r\n'), 'utf8');
  return { saved: true, path: r.filePath, count: lines.length };
});

ipcMain.handle('import:names', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '导入名称列表',
    properties: ['openFile'],
    filters: [{ name: '文本文件', extensions: ['txt', 'csv'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { names: [] };
  const buf = await fsp.readFile(r.filePaths[0]);
  const content = engine.decodeTextBuffer(buf);
  const names = content
    .split(/\r?\n/)
    .map((l) => {
      // 若为 CSV，仅取第一列
      const first = l.split(',')[0];
      return (first || '').trim();
    })
    .filter(Boolean);
  return { names };
});

/* ------------------------------ IPC: 批量新建文件夹 ------------------------------ */

ipcMain.handle('mkdir:batch', async (e, { dir, names }) => {
  let target = dir;
  if (!target) {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择创建位置',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true, ok: 0, failed: [] };
    target = r.filePaths[0];
  }
  let ok = 0;
  const failed = [];
  for (const raw of names || []) {
    const name = engine.sanitize(String(raw).trim());
    if (!name) continue;
    try {
      await fsp.mkdir(path.join(target, name), { recursive: true });
      ok += 1;
    } catch (err) {
      failed.push({ name, reason: err.message });
    }
  }
  return { canceled: false, ok, failed, dir: target };
});

/* ------------------------------ IPC: 系统 ------------------------------ */

ipcMain.handle('shell:showItem', (e, p) => {
  shell.showItemInFolder(p);
});
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
}));
