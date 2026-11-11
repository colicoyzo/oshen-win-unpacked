'use strict';
/* 修复验证测试：文件夹名含点 / 保留设备名 / GBK / 撤销恢复 / 折叠按钮 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../rename-engine.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-test-'));
const out = {};
const mkf = (n, dir) => {
  if (dir) fs.mkdirSync(path.join(tmp, n));
  else fs.writeFileSync(path.join(tmp, n), 'x');
  const st = fs.statSync(path.join(tmp, n));
  return { path: path.join(tmp, n), name: n, isDirectory: !!dir, mtime: st.mtimeMs };
};

(async () => {
  // ===== 1) 文件夹名称处理 =====
  const d1 = mkf('2024.年度报告', true);
  const r1 = engine.computePreview([d1], { mode: 'delete', del: { position: 'tail', count: 4 }, numbering: { enabled: false } });
  // 删除"年度报告"后剩"2024."，Windows 不允许结尾点 → sanitize 去掉，得"2024"
  out['1_folder_delete_tail'] = { got: r1[0].newName, want: '2024' };

  const r2 = engine.computePreview([d1], { mode: 'insert', insert: { text: 'A', position: 'tail' }, numbering: { enabled: false } });
  out['2_folder_insert_tail'] = { got: r2[0].newName, want: '2024.年度报告A' };

  const r3 = engine.computePreview([d1], { mode: 'custom', nameBank: '', ext: { enabled: true, type: 'custom', value: 'zip' }, numbering: { enabled: false } });
  out['3_folder_ext_skip'] = { got: r3[0].newName, want: '2024.年度报告' };

  // 文件夹真实改名落盘
  const pr = engine.computePreview([d1], { mode: 'custom', nameBank: '年报', numbering: { enabled: false } });
  const rr = await engine.performRename(pr.map((p) => ({ path: p.path, newPath: p.newPath })));
  out['4_folder_rename_on_disk'] = { ok: rr.ok, exists: fs.existsSync(path.join(tmp, '年报')) };

  // ===== 2) 文件扩展名处理仍正确 =====
  const f1 = mkf('photo.backup.png');
  const r5 = engine.computePreview([f1], { mode: 'custom', nameBank: '', ext: { enabled: true, type: 'custom', value: 'webp' }, numbering: { enabled: false } });
  out['5_file_ext'] = { got: r5[0].newName, want: 'photo.backup.webp' };

  // ===== 3) Windows 保留设备名 =====
  const f2 = mkf('CON.png');
  const r6 = engine.computePreview([f2], { mode: 'custom', nameBank: '', numbering: { enabled: false } });
  out['6_reserved_name'] = { got: r6[0].newName, want: '_CON.png' };
  const f3 = mkf('aux.txt');
  const r7 = engine.computePreview([f3], { mode: 'custom', nameBank: 'nul', numbering: { enabled: false } });
  out['7_reserved_from_bank'] = { got: r7[0].newName, want: '_nul.txt' };

  // ===== 4) 撤销后恢复路径列表（undoRename 返回 restored） =====
  const f4 = mkf('undo_me.txt');
  const p4 = engine.computePreview([f4], { mode: 'custom', nameBank: 'renamed', numbering: { enabled: false } });
  const rr4 = await engine.performRename([{ path: p4[0].path, newPath: p4[0].newPath }]);
  const ur = await engine.undoRename(rr4.log);
  out['8_undo_restored'] = { ok: ur.ok, restored: (ur.restored || []).map((p) => path.basename(p)), want: ['undo_me.txt'] };

  // ===== 5) GBK / BOM / UTF-8 导入解码（用引擎的 decodeTextBuffer） =====
  const iconv = require('iconv-lite');
  const gbkBuf = iconv.encode('图片001\n图片002\n图片003', 'gbk');
  out['9_gbk_import'] = { got: engine.decodeTextBuffer(gbkBuf).split(/\r?\n/), want: ['图片001', '图片002', '图片003'] };
  const bomBuf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('名称A\n名称B', 'utf8')]);
  out['9b_bom_import'] = { got: engine.decodeTextBuffer(bomBuf).split(/\r?\n/), want: ['名称A', '名称B'] };
  out['9c_plain_utf8'] = { got: engine.decodeTextBuffer(Buffer.from('文件report_01.txt', 'utf8')), want: '文件report_01.txt' };

  // ===== 6) 批量新建文件夹：非法字符 + 保留名自动处理 =====
  const mkdirDir = path.join(tmp, 'mkdir-target');
  fs.mkdirSync(mkdirDir);
  const badNames = ['a<b>c', 'CON', '正常名'];
  for (const raw of badNames) {
    const name = engine.sanitize(raw.trim());
    if (name) fs.mkdirSync(path.join(mkdirDir, name));
  }
  out['10_mkdir_safe'] = fs.readdirSync(mkdirDir).sort();

  // 断言汇总
  const checks = [
    ['1_folder_delete_tail', (v) => v.got === v.want],
    ['2_folder_insert_tail', (v) => v.got === v.want],
    ['3_folder_ext_skip', (v) => v.got === v.want],
    ['4_folder_rename_on_disk', (v) => v.ok === 1 && v.exists],
    ['5_file_ext', (v) => v.got === v.want],
    ['6_reserved_name', (v) => v.got === v.want],
    ['7_reserved_from_bank', (v) => v.got === v.want],
    ['8_undo_restored', (v) => v.ok === 1 && v.restored.join() === v.want.join()],
    ['9_gbk_import', (v) => JSON.stringify(v.got) === JSON.stringify(v.want)],
    ['10_mkdir_safe', (v) => v.includes('a_b_c') && v.includes('_CON') && v.includes('正常名')],
  ];
  out.__summary = checks.map(([k, fn]) => ({ k, pass: fn(out[k]) }));

  console.log(JSON.stringify(out, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  const allPass = out.__summary.every((c) => c.pass);
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(2);
});
