'use strict';
/* 用本机 Chromium 渲染界面并截图，用于视觉核对
 * 用法：CHROME_PATH=/path/to/chrome node test/screenshot.js
 * 依赖：npm i -D playwright-core
 */
const path = require('path');
const fs = require('fs');
const engine = require('../rename-engine.js');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('缺少 playwright-core，请先执行：npm i -D playwright-core');
  process.exit(1);
}

function resolveChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const CHROME = resolveChrome();
if (!CHROME) {
  console.error('未找到 Chromium/Chrome，请通过环境变量 CHROME_PATH 指定可执行文件路径');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs');
fs.mkdirSync(outDir, { recursive: true });

const demoFiles = [
  { path: 'D:\\demo\\上海旅游照片.png', name: '上海旅游照片.png', isDirectory: false, mtime: Date.now() },
  { path: 'D:\\demo\\北京旅游照片.jpg', name: '北京旅游照片.jpg', isDirectory: false, mtime: Date.now() },
  { path: 'D:\\demo\\IMG_2024.jpg', name: 'IMG_2024.jpg', isDirectory: false, mtime: Date.now() },
  { path: 'D:\\demo\\会议纪要-最终版.docx', name: '会议纪要-最终版.docx', isDirectory: false, mtime: Date.now() },
];

const options = {
  mode: 'custom',
  nameBank: '风景',
  numbering: { enabled: true, onlyNumber: false, position: 'tail', type: 'number', start: 1, step: 1, pad: 3 },
  caseConvert: 'none',
  zhConvert: 'none',
  pinyin: 'none',
  ext: { enabled: false, type: 'custom', value: '' },
};

const preview = engine.computePreview(demoFiles, options);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 2 });

  // 注入 preload 的 API 模拟（preview 直接返回预计算结果）
  await page.addInitScript(
    (payload) => {
      window.api = {
        preview: async () => payload.preview,
        stat: async (paths) => paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop(), isDirectory: false, mtime: Date.now() })),
        scanDir: async () => [],
        pickFiles: async () => [],
        pickFolders: async () => [],
        importNames: async () => ({ names: [] }),
        apply: async () => ({ ok: 0, failed: [], log: [] }),
        undo: async () => ({ ok: 0, failed: [] }),
        applyTime: async () => ({ ok: 0, failed: [] }),
        extractNames: async () => ({ saved: false }),
        mkdirBatch: async () => ({ canceled: true, ok: 0, failed: [] }),
        minimize() {}, toggleMax() {}, close() {}, onWinState() {},
        showItem() {}, appInfo: async () => ({}),
        getPathForFile: () => '',
      };
    },
    { preview }
  );

  const url = 'file:///' + path.join(root, 'src', 'index.html').replace(/\\/g, '/');
  await page.goto(url);

  await page.evaluate(
    (payload) => {
      document.getElementById('opt-nameBank').value = '风景';
      document.getElementById('opt-numStart').value = '1';
      document.getElementById('opt-numPad').value = '3';
      state.files = payload.files;
      state.preview = payload.preview;
      renderListTitle();
      renderTable();
    },
    { files: demoFiles, preview }
  );

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'preview-rename.png') });

  // 第二个视图：批量新建文件夹工具
  await page.evaluate(() => {
    document.querySelector('.nav-item[data-tool="new-folder"]').click();
    document.getElementById('mkdir-names').value = '2024年度报告\n2025年度报告\n客户资料\n项目文档';
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'preview-newfolder.png') });

  await browser.close();
  console.log('screenshots written to ' + outDir);
})().catch((e) => {
  console.error('SCREENSHOT FAILED:', e);
  process.exit(1);
});
