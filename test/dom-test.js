'use strict';
/* 无头 DOM 测试：用 jsdom 加载渲染页，模拟添加文件、切换工具、计算预览 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const engine = require('../rename-engine.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const rendererSrc = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'file://' + root.replace(/\\/g, '/') + '/src/index.html',
});
const { window } = dom;

/* ---- 模拟 preload 暴露的 API（preview 走真实引擎） ---- */
window.api = {
  preview: async ({ files, options }) => engine.computePreview(files, options),
  stat: async (paths) => paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop(), isDirectory: false, mtime: Date.now() })),
  scanDir: async () => [],
  pickFiles: async () => [],
  pickFolders: async () => [],
  importNames: async () => ({ names: ['甲', '乙'] }),
  apply: async () => ({ ok: 0, failed: [], log: [] }),
  undo: async () => ({ ok: 0, failed: [] }),
  applyTime: async () => ({ ok: 0, failed: [] }),
  extractNames: async () => ({ saved: false }),
  mkdirBatch: async () => ({ canceled: true, ok: 0, failed: [] }),
  minimize: () => {}, toggleMax: () => {}, close: () => {},
  onWinState: () => {},
  showItem: () => {}, appInfo: async () => ({}),
  getPathForFile: () => '',
};

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e.error)));

// 把「renderer 源码 + 测试脚本」放在同一次 eval 中执行，保证共享顶层作用域
const harness = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(30);
  const out = {};

  out.initTitle = document.getElementById('list-title').textContent;
  out.navCount = document.querySelectorAll('.nav-item').length;

  // 1) 添加文件 + 实时预览（自定义名称 + 编号）
  state.files = [
    { path: 'D:\\\\demo\\\\上海旅游.png', name: '上海旅游.png', mtime: 1714000000000, isDirectory: false },
    { path: 'D:\\\\demo\\\\北京旅游.jpg', name: '北京旅游.jpg', mtime: 1714000000000, isDirectory: false }
  ];
  document.getElementById('opt-nameBank').value = '风景';
  document.getElementById('opt-numStart').value = '1';
  document.getElementById('opt-numPad').value = '3';
  renderListTitle(); renderTable();
  await refreshPreviewNow();
  out.rename = {
    title: document.getElementById('list-title').textContent,
    rows: [...document.querySelectorAll('#file-tbody tr')].map((tr) => ({
      oldName: tr.querySelector('.col-old').textContent,
      newName: tr.querySelector('.col-new .new-name').textContent,
      status: tr.querySelector('.status-badge').textContent
    })),
    dropzoneHidden: document.getElementById('dropzone').classList.contains('hidden'),
    listVisible: !document.getElementById('list-wrap').classList.contains('hidden')
  };

  // 2) 关闭编号 -> 新名称应变为纯名称
  document.querySelector('.wb-tab[data-tab="custom"]').click();
  document.getElementById('opt-numEnabled').checked = false;
  document.getElementById('opt-numEnabled').dispatchEvent(new Event('change'));
  await refreshPreviewNow();
  out.numberingOff = [...document.querySelectorAll('#file-tbody tr .col-new .new-name')].map((e) => e.textContent);

  // 3) 打开编号，类型切换为「字母」，起始 1，位数 2
  document.getElementById('opt-numEnabled').checked = true;
  document.querySelector('input[name="num-type"][value="letter"]').checked = true;
  document.querySelector('input[name="num-type"][value="letter"]').dispatchEvent(new Event('change'));
  document.getElementById('opt-numStart').value = '1';
  document.getElementById('opt-numPad').value = '2';
  await refreshPreviewNow();
  out.letterNumbering = [...document.querySelectorAll('#file-tbody tr .col-new .new-name')].map((e) => e.textContent);
  out.letterStartAutoFix = document.getElementById('opt-numStart').value;

  // 4) 拼音 + 简繁 组合
  document.querySelector('input[name="num-type"][value="number"]').checked = true;
  document.querySelector('input[name="num-type"][value="number"]').dispatchEvent(new Event('change'));
  document.getElementById('opt-numEnabled').checked = false;
  document.getElementById('opt-nameBank').value = '';
  document.getElementById('opt-pinyin').value = 'first';
  document.getElementById('opt-zh').value = 'none';
  await refreshPreviewNow();
  out.pinyin = [...document.querySelectorAll('#file-tbody tr .col-new .new-name')].map((e) => e.textContent);

  // 5) 标签页「删除」条件 UI
  document.querySelector('.wb-tab[data-tab="delete"]').click();
  document.querySelector('input[name="del-pos"][value="custom"]').checked = true;
  document.querySelector('input[name="del-pos"][value="custom"]').dispatchEvent(new Event('change'));
  out.deleteTab = {
    activeTab: document.querySelector('.wb-tab.active').dataset.tab,
    panelVisible: !document.querySelector('.tab-panel[data-panel="delete"]').classList.contains('hidden'),
    startRowVisible: document.getElementById('del-start-row').style.display === 'flex'
  };

  // 6) 切换工具：提取文件名称
  document.querySelector('.nav-item[data-tool="extract-file"]').click();
  out.extractTool = {
    actionText: document.getElementById('btn-action').textContent,
    wbExtractVisible: !document.getElementById('wb-extract').classList.contains('hidden'),
    wbRenameHidden: document.getElementById('wb-rename').classList.contains('hidden'),
    listTitle: document.getElementById('list-title').textContent
  };

  // 7) 切换工具：批量新建文件夹
  document.querySelector('.nav-item[data-tool="new-folder"]').click();
  out.newFolderTool = {
    actionText: document.getElementById('btn-action').textContent,
    wbVisible: !document.getElementById('wb-newfolder').classList.contains('hidden'),
    addHidden: document.getElementById('btn-add').style.display === 'none',
    title: document.getElementById('list-title').textContent
  };

  // 8) 回到文件重命名
  document.querySelector('.nav-item[data-tool="rename-file"]').click();
  out.backToRename = {
    wbRenameVisible: !document.getElementById('wb-rename').classList.contains('hidden'),
    dropzoneVisible: !document.getElementById('dropzone').classList.contains('hidden')
  };

  return out;
})()`;

(async () => {
  const out = await window.eval(rendererSrc + '\n;(' + harness + ');');
  // 静态检查：$('id') 引用的元素是否都存在
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const refs = new Set([...rendererSrc.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  out.missingIds = [...refs].filter((r) => !ids.has(r));
  out.windowErrors = errors;
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('TEST FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
