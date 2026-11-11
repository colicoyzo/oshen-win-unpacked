'use strict';
/* 真实磁盘测试：创建临时目录 -> 预览 -> 批量重命名 -> 校验 -> 撤销 -> 校验 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../rename-engine.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ren-test-'));

const originals = ['上海旅游照片.png', '北京旅游照片.jpg', 'IMG_2024.jpg', '文档 副本.txt', 'same.txt', 'same(1).txt'];
for (const n of originals) fs.writeFileSync(path.join(tmp, n), 'x');

const files = fs.readdirSync(tmp).sort().map((n) => {
  const st = fs.statSync(path.join(tmp, n));
  return { path: path.join(tmp, n), name: n, isDirectory: false, mtime: st.mtimeMs, size: st.size };
});

(async () => {
  const report = {};

  // 1) 预览：中文转拼音 + 原扩展名保留
  let prev = engine.computePreview(files, {
    mode: 'custom', nameBank: '', pinyin: 'full-nospace',
    numbering: { enabled: false },
  });
  report.pinyinPreview = prev.map((p) => `${p.oldName} -> ${p.newName}`);

  // 2) 执行重命名（真实落盘）
  const res = await engine.performRename(prev.map((p) => ({ path: p.path, newPath: p.newPath })));
  report.renamed = { ok: res.ok, failed: res.failed };
  report.afterRename = fs.readdirSync(tmp).sort();

  // 3) 撤销
  const und = await engine.undoRename(res.log);
  report.undone = { ok: und.ok, failed: und.failed };
  report.afterUndo = fs.readdirSync(tmp).sort();
  report.undoMatchesOriginal =
    JSON.stringify(report.afterUndo) === JSON.stringify([...originals].sort());

  // 4) 大小写改写（Windows 大小写不敏感路径的经典场景）+ 冲突拦截
  fs.writeFileSync(path.join(tmp, 'case.txt'), 'x');
  const cprev = engine.computePreview(
    [{ path: path.join(tmp, 'case.txt'), name: 'case.txt', isDirectory: false, mtime: Date.now() }],
    { mode: 'custom', nameBank: 'CASE', numbering: { enabled: false } }
  );
  const cres = await engine.performRename(cprev.map((p) => ({ path: p.path, newPath: p.newPath })));
  report.caseRename = { ok: cres.ok, list: fs.readdirSync(tmp).filter((f) => f.toLowerCase() === 'case.txt') };

  // 5) 冲突：目标已存在应被拦截
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
  fs.writeFileSync(path.join(tmp, 'b.txt'), 'x');
  const conflict = await engine.performRename([
    { path: path.join(tmp, 'a.txt'), newPath: path.join(tmp, 'b.txt') },
  ]);
  report.conflictBlocked = conflict.failed.length === 1 && conflict.ok === 0;
  report.conflictReason = conflict.failed[0] && conflict.failed[0].reason;

  // 6) 批次内重名拦截
  const dup = await engine.performRename([
    { path: path.join(tmp, 'a.txt'), newPath: path.join(tmp, 'z.txt') },
    { path: path.join(tmp, 'b.txt'), newPath: path.join(tmp, 'z.txt') },
  ]);
  report.duplicateBlocked = dup.ok === 0 && dup.failed.length === 2;

  console.log(JSON.stringify(report, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('TEST FAILED:', e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(1);
});
