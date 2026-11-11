'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口控制
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMax: () => ipcRenderer.send('win:toggle-max'),
  close: () => ipcRenderer.send('win:close'),
  onWinState: (cb) => ipcRenderer.on('win:state', (e, s) => cb(s)),

  // 选择 / 扫描
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickFolders: () => ipcRenderer.invoke('dialog:pickFolders'),
  pickDirToScan: (arg) => ipcRenderer.invoke('dialog:pickDirToScan', arg),
  scanDir: (arg) => ipcRenderer.invoke('fs:scanDir', arg),
  stat: (paths) => ipcRenderer.invoke('fs:stat', paths),

  // 重命名
  preview: (payload) => ipcRenderer.invoke('rename:preview', payload),
  apply: (items) => ipcRenderer.invoke('rename:apply', items),
  undo: () => ipcRenderer.invoke('rename:undo'),

  // 其它工具
  applyTime: (payload) => ipcRenderer.invoke('time:apply', payload),
  extractNames: (payload) => ipcRenderer.invoke('extract:names', payload),
  importNames: () => ipcRenderer.invoke('import:names'),
  mkdirBatch: (payload) => ipcRenderer.invoke('mkdir:batch', payload),

  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  appInfo: () => ipcRenderer.invoke('app:info'),

  // 拖拽文件取真实路径（Electron >= 32 需用 webUtils）
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return file.path || '';
    }
  },
});
