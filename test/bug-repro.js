'use strict';
/* 功能缺陷复现测试 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../rename-engine.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-test-'));
const out = {};

// B1: 文件夹名称含点 —— 当前被当作扩展名处理
fs.mkdirSync(path.join(tmp, '2024.年度报告'));
const dirFile = { path: path.join(tmp, '2024.年度报告'), name: '2024.年度报告', isDirectory: true, mtime: Date.now() };
const r1 = engine.computePreview([dirFile], { mode: 'delete', del: { position: 'tail', count: 4 }, numbering: { enabled: false } });
out.B1_folder_delete = { input: '2024.年度报告', output: r1[0].newName, expect: '2024.年度' };

// B2: 文件夹插入 —— 插入内容被放到扩展名之前
const r2 = engine.computePreview([dirFile], { mode: 'insert', insert: { text: 'A', position: 'tail' }, numbering: { enabled: false } });
out.B2_folder_insert = { output: r2[0].newName, expect: '2024.年度报告A' };

// B3: 文件夹扩展名开关不应生效
const r3 = engine.computePreview([dirFile], { mode: 'custom', nameBank: '', ext: { enabled: true, type: 'custom', value: 'zip' }, numbering: { enabled: false } });
out.B3_folder_ext = { output: r3[0].newName, expect: '2024.年度报告（不应变 .zip）' };

// B4: 撤销语义 —— undoRename 应返回 log（渲染层需要旧路径映射）
out.B4_undo_log = '见 main.js undo 返回值检查';

// B5: GBK 导入（模拟 iconv 前的解码）
const iconvCheck = (() => {
  try {
    new TextDecoder('gbk');
    return 'TextDecoder gbk 支持';
  } catch (e) {
    return '不支持 gbk: ' + e.message;
  }
})();
out.B5_gbk_decoder = iconvCheck;

console.log(JSON.stringify(out, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
