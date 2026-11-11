'use strict';

/**
 * 重命名引擎 —— 纯计算模块，运行在 Electron 主进程（Node）。
 * 输入文件列表 + 规则，输出每条文件的新名称与状态。
 * 不做任何磁盘写操作（写操作由 main.js 负责）。
 */

let pinyinFn = null;
try {
  pinyinFn = require('pinyin-pro').pinyin;
} catch (e) {
  // 缺少依赖时降级：拼音转换返回原文
}

let s2tConv = null;
let t2sConv = null;
try {
  const OpenCC = require('opencc-js');
  s2tConv = OpenCC.Converter({ from: 'cn', to: 'tw' });
  t2sConv = OpenCC.Converter({ from: 'tw', to: 'cn' });
} catch (e) {
  // 缺少依赖时降级：简繁转换返回原文
}

const DEFAULT_OPTIONS = {
  mode: 'custom', // custom | insert | replace | delete | import
  nameBank: '', // 新文件名（多行 = 词库，按序循环）
  insert: { text: '', position: 'head', index: 0 },
  replace: { find: '', with: '', useRegex: false, ignoreCase: false },
  del: { start: 0, count: 1, position: 'head' },
  caseConvert: 'none', // none | upper | lower | capitalize | toggle
  zhConvert: 'none', // none | s2t | t2s
  pinyin: 'none', // none | full | full-nospace | full-cap | first | first-upper
  numbering: {
    enabled: true,
    onlyNumber: false,
    position: 'tail', // head | tail | custom
    index: 0,
    type: 'number', // number | letter | random | time
    start: 122,
    step: 1,
    pad: 4,
    timeFormat: 'YYYYMMDD',
    randomLen: 4,
    randomCharset: 'alnum', // alnum | alpha | digit
  },
  ext: { enabled: false, type: 'custom', value: '' },
};

/* ------------------------------ 工具函数 ------------------------------ */

function splitExt(name) {
  // 处理 ".gitignore"、多段扩展名 "a.tar.gz" 只取最后一段
  const i = name.lastIndexOf('.');
  if (i <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

// Windows 保留设备名（含带任意扩展名的形式，如 CON.txt）
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function isReservedBase(base) {
  return RESERVED_RE.test(String(base).trim());
}

function pad(num, len) {
  const s = String(Math.abs(num));
  const sign = num < 0 ? '-' : '';
  return sign + s.padStart(len, '0');
}

// 1 -> A, 26 -> Z, 27 -> AA
function toLetters(n) {
  if (n < 1) n = 1;
  let s = '';
  let x = n;
  while (x > 0) {
    x -= 1;
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

const CHARSETS = {
  alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
};

function randStr(len, charset) {
  const pool = CHARSETS[charset] || CHARSETS.alnum;
  let out = '';
  for (let i = 0; i < len; i++) {
    out += pool[Math.floor(Math.random() * pool.length)];
  }
  return out;
}

function formatTime(date, fmt) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const map = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1, 2),
    DD: pad(d.getDate(), 2),
    HH: pad(d.getHours(), 2),
    mm: pad(d.getMinutes(), 2),
    ss: pad(d.getSeconds(), 2),
    M: String(d.getMonth() + 1),
    D: String(d.getDate()),
    H: String(d.getHours()),
  };
  return fmt.replace(/YYYY|YY|MM|DD|HH|mm|ss|M|D|H/g, (t) => map[t] ?? t);
}

function convertPinyin(text, mode) {
  if (mode === 'none' || !text) return text;
  if (!pinyinFn) return text; // 依赖缺失降级
  try {
    if (mode === 'first') {
      const arr = pinyinFn(text, { toneType: 'none', type: 'array' });
      return arr.map((s) => (s ? s[0] : '')).join('');
    }
    if (mode === 'first-upper') {
      const arr = pinyinFn(text, { toneType: 'none', type: 'array' });
      return arr.map((s) => (s ? s[0].toUpperCase() : '')).join('');
    }
    if (mode === 'full-cap') {
      const arr = pinyinFn(text, { toneType: 'none', type: 'array' });
      return arr.map((s) => (s ? s[0].toUpperCase() + s.slice(1) : '')).join(' ');
    }
    if (mode === 'full-nospace') {
      return pinyinFn(text, { toneType: 'none', type: 'array' }).join('');
    }
    // full
    return pinyinFn(text, { toneType: 'none', type: 'array' }).join(' ');
  } catch (e) {
    return text;
  }
}

function convertCase(text, mode) {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    case 'toggle':
      return text
        .split('')
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join('');
    default:
      return text;
  }
}

function convertZh(text, mode) {
  if (mode === 's2t' && s2tConv) return s2tConv(text);
  if (mode === 't2s' && t2sConv) return t2sConv(text);
  return text;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------ 编号生成 ------------------------------ */

function buildNumberToken(opt, i, file) {
  const start = Number(opt.start) || 0;
  const step = Number(opt.step);
  const cur = start + (isNaN(step) ? 1 : step) * i;
  switch (opt.type) {
    case 'letter':
      return toLetters(cur);
    case 'random':
      return randStr(Number(opt.randomLen) || 4, opt.randomCharset);
    case 'time': {
      let d = file && file.mtime ? new Date(file.mtime) : new Date();
      const inc = Number(opt.step) || 0;
      if (inc) d = new Date(d.getTime() + inc * i * 60 * 1000);
      return formatTime(d, opt.timeFormat || 'YYYYMMDD');
    }
    case 'number':
    default:
      return pad(cur, Math.max(1, Number(opt.pad) || 1));
  }
}

function placeToken(name, token, position, index) {
  if (position === 'head') return token + name;
  if (position === 'custom') {
    const idx = Math.max(0, Math.min(name.length, Number(index) || 0));
    return name.slice(0, idx) + token + name.slice(idx);
  }
  // tail
  return name + token;
}

/* ------------------------------ 主计算逻辑 ------------------------------ */

// 目录名中的点属于名称本身，不拆扩展名；文件才拆。
function nameParts(file) {
  if (file.isDirectory) return { base: file.name, ext: '' };
  return splitExt(file.name);
}

function buildBaseName(file, index, opts) {
  const { base } = nameParts(file);
  const mode = opts.mode;

  if (mode === 'insert') {
    const t = opts.insert.text || '';
    const pos = opts.insert.position;
    if (pos === 'head') return t + base;
    if (pos === 'tail') return base + t;
    const idx = Math.max(0, Math.min(base.length, Number(opts.insert.index) || 0));
    return base.slice(0, idx) + t + base.slice(idx);
  }

  if (mode === 'replace') {
    const find = opts.replace.find || '';
    if (!find) return base;
    if (opts.replace.useRegex) {
      try {
        const re = new RegExp(find, opts.replace.ignoreCase ? 'gi' : 'g');
        return base.replace(re, opts.replace.with || '');
      } catch (e) {
        return base;
      }
    }
    if (opts.replace.ignoreCase) {
      const re = new RegExp(escapeRegExp(find), 'gi');
      return base.replace(re, opts.replace.with || '');
    }
    return base.split(find).join(opts.replace.with || '');
  }

  if (mode === 'delete') {
    const count = Math.max(0, Number(opts.del.count) || 0);
    if (!count) return base;
    if (opts.del.position === 'head') return base.slice(count);
    if (opts.del.position === 'tail') return base.slice(0, Math.max(0, base.length - count));
    const start = Number(opts.del.start) || 0;
    return base.slice(0, start) + base.slice(start + count);
  }

  // custom / import
  const bank = String(opts.nameBank || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (bank.length === 0) return base;
  return bank[index % bank.length];
}

function computeNewName(file, index, opts) {
  let name = buildBaseName(file, index, opts);

  const nb = opts.numbering || {};
  if (nb.enabled) {
    const token = buildNumberToken(nb, index, file);
    if (nb.onlyNumber) {
      name = token;
    } else {
      name = placeToken(name, token, nb.position, nb.index);
    }
  }

  name = convertCase(name, opts.caseConvert);
  name = convertZh(name, opts.zhConvert);
  name = convertPinyin(name, opts.pinyin);

  // 扩展名处理（目录没有扩展名概念，跳过）
  const { ext } = nameParts(file);
  let newExt = ext;
  if (!file.isDirectory && opts.ext && opts.ext.enabled) {
    if (opts.ext.type === 'custom') {
      const v = String(opts.ext.value || '').trim();
      if (v) newExt = v.startsWith('.') ? v : '.' + v;
    } else if (opts.ext.type === 'replace') {
      const parts = String(opts.ext.value || '').split('|');
      const find = parts[0] || '';
      const to = parts.length > 1 ? parts[1] : '';
      newExt = ext.split(find).join(to);
    }
  }

  name = sanitize(name);
  return name + newExt;
}

function sanitize(name) {
  // Windows 非法字符替换
  let s = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  s = s.replace(/[. ]+$/, ''); // 结尾不能是点或空格
  if (s === '') s = '_';
  // 保留设备名（CON、NUL、COM1…）加前缀避免创建失败
  const { base, ext } = splitExt(s);
  if (isReservedBase(base)) s = '_' + s;
  return s;
}

/**
 * 计算预览结果
 * @param {Array} files [{path,name,isDirectory,mtime,size}]
 * @param {Object} options
 * @returns {Array} [{...file, oldName, newName, newPath, status, reason}]
 */
function computePreview(files, options) {
  const opts = mergeOptions(options);
  const results = [];
  const usedNames = new Map(); // `${dirLower}|${nameLower}` -> count

  files.forEach((f, i) => {
    const newName = computeNewName(f, i, opts);
    const dir = dirOf(f.path);
    const key = dir.toLowerCase() + '|' + newName.toLowerCase();
    usedNames.set(key, (usedNames.get(key) || 0) + 1);

    let status = 'ok';
    let reason = '';
    if (newName === f.name) {
      status = 'unchanged';
      reason = '名称未变化';
    }
    if (newName.length > 255) {
      status = 'invalid';
      reason = '文件名过长';
    }
    results.push({
      path: f.path,
      oldName: f.name,
      newName,
      newPath: joinPath(dir, newName),
      dir,
      status,
      reason,
    });
  });

  // 批次内重名检测
  results.forEach((r) => {
    const key = r.dir.toLowerCase() + '|' + r.newName.toLowerCase();
    if (usedNames.get(key) > 1 && r.status !== 'invalid') {
      r.status = 'conflict';
      r.reason = '批次内存在重名';
    }
  });

  return results;
}

function dirOf(p) {
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i < 0 ? '' : norm.slice(0, i).replace(/\//g, '\\');
}

function joinPath(dir, name) {
  if (!dir) return name;
  const sep = dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\';
  return dir + sep + name;
}

function mergeOptions(options) {
  const o = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
  if (!options) return o;
  Object.keys(options).forEach((k) => {
    if (k === 'numbering' || k === 'insert' || k === 'replace' || k === 'del' || k === 'ext') {
      Object.assign(o[k], options[k] || {});
    } else {
      o[k] = options[k];
    }
  });
  return o;
}

/* ------------------------------ 文本解码 ------------------------------ */

// 读取 txt/csv 名称列表时的编码识别：
// 1) UTF-8 BOM 直接去 BOM；2) 无 BOM 时对 UTF-8 / GBK 两种解码按「中日韩汉字数」择优——
// 部分 GBK 字节序列恰好是合法 UTF-8（如 图片=CD BC C6 AC），strict 解码检测不出乱码。
function decodeTextBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  const cjkScore = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0xfffd) n -= 10; // 解码失败字符重罚
      else if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) n++;
    }
    return n;
  };
  let utf8 = null;
  try {
    utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    utf8 = null;
  }
  let gbk = null;
  try {
    gbk = require('iconv-lite').decode(buf, 'gbk');
  } catch (e) {
    gbk = null;
  }
  if (utf8 === null) return gbk !== null ? gbk : buf.toString('utf8');
  if (gbk === null) return utf8;
  return cjkScore(gbk) > cjkScore(utf8) ? gbk : utf8;
}

/* ------------------------------ 落盘执行（两阶段重命名） ------------------------------ */

const nodePath = require('path');
const nodeFs = require('fs');
const nodeFsp = nodeFs.promises;

let _tmpSeed = 0;
function tempName(dir, tag) {
  _tmpSeed += 1;
  return nodePath.join(dir, `.~ren_${tag}_${Date.now()}_${_tmpSeed}_${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * 执行重命名（两阶段，避免互相占位 / 大小写改写失败）
 * @param {Array} items [{path, newPath}]
 * @returns {{ok:number, failed:Array, log:Array}}
 */
async function performRename(items) {
  const list = (items || []).filter((it) => it && it.path && it.newPath && it.path !== it.newPath);
  if (list.length === 0) return { ok: 0, failed: [], log: [] };

  const sourceKeys = new Set(list.map((it) => it.path.toLowerCase()));
  const targetCount = new Map();
  list.forEach((it) => {
    const k = it.newPath.toLowerCase();
    targetCount.set(k, (targetCount.get(k) || 0) + 1);
  });

  const failed = [];
  const pending = [];
  for (const it of list) {
    const tk = it.newPath.toLowerCase();
    if (targetCount.get(tk) > 1) {
      failed.push({ path: it.path, reason: '目标名称重复' });
      continue;
    }
    if (nodeFs.existsSync(it.newPath) && !sourceKeys.has(tk)) {
      failed.push({ path: it.path, reason: '目标文件已存在' });
      continue;
    }
    pending.push(it);
  }

  // 阶段一：全部改成临时名
  const staged = [];
  for (const it of pending) {
    const temp = tempName(nodePath.dirname(it.path), 'a');
    try {
      await nodeFsp.rename(it.path, temp);
      staged.push({ temp, final: it.newPath, old: it.path });
    } catch (err) {
      failed.push({ path: it.path, reason: err.message });
    }
  }

  // 阶段二：临时名改成目标名
  let ok = 0;
  const log = [];
  for (const s of staged) {
    try {
      await nodeFsp.rename(s.temp, s.final);
      ok += 1;
      log.push({ from: s.final, to: s.old });
    } catch (err) {
      failed.push({ path: s.old, reason: '写入目标失败: ' + err.message });
      try {
        await nodeFsp.rename(s.temp, s.old); // 回滚
      } catch (_) {}
    }
  }

  return { ok, failed, log };
}

/** 撤销：把 log 中的 from 改回 to，并返回恢复后的路径列表 */
async function undoRename(log) {
  const pairs = [];
  const failed = [];
  for (const l of log || []) {
    const temp = tempName(nodePath.dirname(l.from), 'u');
    try {
      await nodeFsp.rename(l.from, temp);
      pairs.push({ temp, final: l.to });
    } catch (err) {
      failed.push({ path: l.from, reason: err.message });
    }
  }
  let ok = 0;
  const restored = [];
  for (const p of pairs) {
    try {
      await nodeFsp.rename(p.temp, p.final);
      ok += 1;
      restored.push(p.final);
    } catch (err) {
      failed.push({ path: p.final, reason: err.message });
    }
  }
  return { ok, failed, restored };
}

module.exports = {
  computePreview,
  computeNewName,
  performRename,
  undoRename,
  decodeTextBuffer,
  splitExt,
  sanitize,
  dirOf,
  joinPath,
  DEFAULT_OPTIONS,
};
