'use strict';

/* ============================ 工具配置 ============================ */

const TOOLS = {
  'rename-file':   { label: '文件', addKind: 'file',   wb: 'rename',    action: '开始命名',  table: 'rename' },
  'rename-folder': { label: '文件夹', addKind: 'folder', wb: 'rename',    action: '开始命名',  table: 'rename' },
  'file-time':     { label: '文件', addKind: 'file',   wb: 'time',      action: '应用时间',  table: 'info' },
  'folder-time':   { label: '文件夹', addKind: 'folder', wb: 'time',      action: '应用时间',  table: 'info' },
  'extract-file':  { label: '文件', addKind: 'file',   wb: 'extract',   action: '导出名称',  table: 'info' },
  'extract-folder':{ label: '文件夹', addKind: 'folder', wb: 'extract',   action: '导出名称',  table: 'info' },
  'new-folder':    { label: '文件夹', addKind: 'none', wb: 'newfolder', action: '创建文件夹', table: 'none' },
};

const state = {
  tool: 'rename-file',
  files: [],
  preview: [],
  tab: 'custom',
  mkdirDir: '',
};

const $ = (id) => document.getElementById(id);

/* ============================ 通用工具 ============================ */

function debounce(fn, wait) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), wait);
  };
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toast-wrap').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function num(v, d = 0) {
  const n = Number(v);
  return isNaN(n) ? d : n;
}

function radioValue(name, fallback) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : fallback;
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ============================ 窗口控制 ============================ */

$('btn-min').onclick = () => window.api.minimize();
$('btn-max').onclick = () => window.api.toggleMax();
$('btn-close').onclick = () => window.api.close();
$('vip-link').onclick = (e) => {
  e.preventDefault();
  toast('会员功能尚未接入', 'warn');
};

/* ============================ 左侧导航 ============================ */

$('sidebar').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.tool = btn.dataset.tool;
  state.files = [];
  state.preview = [];
  updateToolUI();
});

function updateToolUI() {
  const cfg = TOOLS[state.tool];

  // 工作台面板
  ['rename', 'time', 'extract', 'newfolder'].forEach((k) => {
    $('wb-' + k).classList.toggle('hidden', k !== cfg.wb);
  });

  $('btn-action').textContent = cfg.action;

  // 拖拽区提示
  $('dz-text').textContent =
    cfg.addKind === 'none'
      ? '在右侧输入文件夹名称，点击「创建文件夹」'
      : cfg.addKind === 'folder'
      ? '点击添加 / 拖拽文件夹到此区域'
      : '点击添加 / 拖拽文件到此区域';

  // 新建文件夹工具：隐藏列表
  const showList = cfg.table !== 'none';
  $('btn-add').style.display = cfg.addKind === 'none' ? 'none' : '';
  $('btn-clear').style.display = cfg.addKind === 'none' ? 'none' : '';

  if (!showList) {
    $('dropzone').classList.remove('hidden');
    $('list-wrap').classList.add('hidden');
  }
  renderListTitle();
  renderTable();
  refreshPreview();
}

function renderListTitle() {
  const cfg = TOOLS[state.tool];
  if (cfg.table === 'none') {
    $('list-title').textContent = '批量新建文件夹';
    return;
  }
  $('list-title').textContent = `${cfg.label} ${state.files.length}`;
}

/* ============================ 添加文件 ============================ */

async function addByDialog() {
  const cfg = TOOLS[state.tool];
  if (cfg.addKind === 'none') return;
  const items = cfg.addKind === 'folder' ? await window.api.pickFolders() : await window.api.pickFiles();
  mergeItems(items || []);
}

async function addByPaths(paths) {
  const cfg = TOOLS[state.tool];
  if (cfg.addKind === 'none' || !paths.length) return;
  const stats = await window.api.stat(paths);
  const out = [];
  for (const it of stats) {
    if (!it || it.error) continue;
    if (cfg.addKind === 'file') {
      if (it.isDirectory) {
        const scanned = await window.api.scanDir({ dir: it.path, recursive: false, kind: 'file' });
        out.push(...scanned);
      } else {
        out.push(it);
      }
    } else {
      if (it.isDirectory) out.push(it);
    }
  }
  mergeItems(out);
}

function mergeItems(items) {
  const seen = new Set(state.files.map((f) => f.path.toLowerCase()));
  let added = 0;
  for (const it of items) {
    if (!it || !it.path) continue;
    const k = it.path.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    state.files.push(it);
    added++;
  }
  if (added === 0) {
    toast('未添加新项目');
  } else {
    toast(`已添加 ${added} 项`, 'ok');
  }
  renderListTitle();
  renderTable();
  refreshPreview();
}

$('btn-add').onclick = addByDialog;
$('dropzone').onclick = addByDialog;

$('btn-clear').onclick = () => {
  state.files = [];
  state.preview = [];
  renderListTitle();
  renderTable();
  refreshPreview();
};

/* ============================ 拖拽 ============================ */

let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  if (TOOLS[state.tool].addKind !== 'none') $('dropzone').classList.add('dragover');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('dropzone').classList.remove('dragover');
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropzone').classList.remove('dragover');
  const paths = [];
  for (const f of e.dataTransfer.files) {
    const p = window.api.getPathForFile(f);
    if (p) paths.push(p);
  }
  await addByPaths(paths);
});

/* ============================ 列表渲染 ============================ */

function renderTable() {
  const cfg = TOOLS[state.tool];
  const wrap = $('list-wrap');
  const dz = $('dropzone');
  const tbody = $('file-tbody');
  const thead = document.querySelector('.file-table thead');

  if (cfg.table === 'none') return;

  if (state.files.length === 0) {
    wrap.classList.add('hidden');
    dz.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  dz.classList.add('hidden');
  wrap.classList.remove('hidden');

  if (cfg.table === 'rename') {
    thead.innerHTML =
      '<tr><th class="col-idx">#</th><th class="col-old">原名称</th>' +
      '<th class="col-new">新名称</th><th class="col-status">状态</th><th class="col-op"></th></tr>';
    tbody.innerHTML = state.files.map((f, i) => {
      const p = state.preview[i] || {};
      const newName = p.newName || '';
      const same = newName === f.name;
      const st = p.status || 'ok';
      const badge = statusBadge(st, p.reason);
      const cls = st === 'conflict' || st === 'invalid' ? 'row-conflict' : st === 'unchanged' ? 'row-unchanged' : '';
      return `<tr class="${cls}" data-idx="${i}">
        <td class="col-idx">${i + 1}</td>
        <td class="col-old" title="${esc(f.path)}">${esc(f.name)}</td>
        <td class="col-new"><span class="new-name ${same ? 'same' : ''}" title="${esc(newName)}">${esc(newName || '-')}</span></td>
        <td class="col-status">${badge}</td>
        <td class="col-op"><button class="row-del" data-idx="${i}" title="移除">✕</button></td>
      </tr>`;
    }).join('');
  } else {
    const t3 = state.tool.includes('folder') ? '所在路径' : '所在路径';
    thead.innerHTML =
      '<tr><th class="col-idx">#</th><th class="col-old">名称</th>' +
      `<th class="col-new">${t3}</th><th class="col-status">修改时间</th><th class="col-op"></th></tr>`;
    tbody.innerHTML = state.files.map((f, i) => {
      const dir = f.path.replace(/[\\/][^\\/]*$/, '');
      return `<tr data-idx="${i}">
        <td class="col-idx">${i + 1}</td>
        <td class="col-old" title="${esc(f.name)}">${esc(f.name)}</td>
        <td class="col-new"><span class="new-name same" title="${esc(dir)}">${esc(dir)}</span></td>
        <td class="col-status">${fmtTime(f.mtime)}</td>
        <td class="col-op"><button class="row-del" data-idx="${i}" title="移除">✕</button></td>
      </tr>`;
    }).join('');
  }
}

function statusBadge(st, reason) {
  const map = {
    ok: ['st-ok', '可重命名'],
    unchanged: ['st-unchanged', '未变化'],
    conflict: ['st-conflict', reason || '重名冲突'],
    invalid: ['st-invalid', reason || '无效'],
  };
  const [cls, text] = map[st] || map.ok;
  return `<span class="status-badge ${cls}">${esc(text)}</span>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('file-tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('.row-del');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  state.files.splice(idx, 1);
  renderListTitle();
  renderTable();
  refreshPreview();
});

/* ============================ 选项读取 ============================ */

function readOptions() {
  const mode = state.tab === 'import' ? 'import' : state.tab;
  return {
    mode,
    nameBank: $('opt-nameBank').value,
    insert: {
      text: $('opt-insertText').value,
      position: radioValue('ins-pos', 'head'),
      index: num($('opt-insertIndex').value, 0),
    },
    replace: {
      find: $('opt-find').value,
      with: $('opt-replaceWith').value,
      useRegex: $('opt-useRegex').checked,
      ignoreCase: $('opt-ignoreCase').checked,
    },
    del: {
      start: num($('opt-delStart').value, 0),
      count: num($('opt-delCount').value, 1),
      position: radioValue('del-pos', 'head'),
    },
    caseConvert: $('opt-case').value,
    zhConvert: $('opt-zh').value,
    pinyin: $('opt-pinyin').value,
    numbering: {
      enabled: $('opt-numEnabled').checked,
      onlyNumber: $('opt-onlyNumber').checked,
      position: radioValue('num-pos', 'tail'),
      index: num($('opt-numIndex').value, 0),
      type: radioValue('num-type', 'number'),
      start: num($('opt-numStart').value, 0),
      step: num($('opt-numStep').value, 1),
      pad: num($('opt-numPad').value, 1),
      timeFormat: $('opt-timeFormat').value,
      randomLen: num($('opt-numPad').value, 4),
      randomCharset: $('opt-randomCharset').value,
    },
    ext: {
      enabled: $('opt-extEnabled').checked,
      type: radioValue('ext-type', 'custom'),
      value: $('opt-extValue').value,
    },
  };
}

/* ============================ 预览 ============================ */

const refreshPreview = debounce(async () => {
  const cfg = TOOLS[state.tool];
  if (cfg.table !== 'rename' || state.files.length === 0) {
    state.preview = [];
    if (cfg.table === 'rename') renderTable();
    return;
  }
  try {
    state.preview = await window.api.preview({ files: state.files, options: readOptions() });
  } catch (e) {
    state.preview = [];
  }
  renderTable();
}, 120);

/* ============================ 工作台交互绑定 ============================ */

// 标签页
$('wb-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.wb-tab');
  if (!tab) return;
  document.querySelectorAll('.wb-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  state.tab = tab.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.panel !== state.tab);
  });
  refreshPreview();
});

// 输入类控件统一触发预览
const bindPreview = (ids) => ids.forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', refreshPreview);
  el.addEventListener('change', refreshPreview);
});
bindPreview([
  'opt-nameBank', 'opt-insertText', 'opt-insertIndex', 'opt-find', 'opt-replaceWith',
  'opt-useRegex', 'opt-ignoreCase', 'opt-delCount', 'opt-delStart',
  'opt-case', 'opt-zh', 'opt-pinyin',
  'opt-numEnabled', 'opt-onlyNumber', 'opt-numIndex', 'opt-numStart', 'opt-numStep',
  'opt-numPad', 'opt-timeFormat', 'opt-randomCharset',
  'opt-extEnabled', 'opt-extValue',
]);
document.querySelectorAll('input[name="ins-pos"],input[name="del-pos"],input[name="num-pos"],input[name="num-type"],input[name="ext-type"]')
  .forEach((el) => el.addEventListener('change', () => { syncConditionalUI(); refreshPreview(); }));

// 条件显示
function syncConditionalUI() {
  $('ins-index-row').style.display = radioValue('ins-pos', 'head') === 'custom' ? 'flex' : 'none';
  $('del-start-row').style.display = radioValue('del-pos', 'head') === 'custom' ? 'flex' : 'none';
  $('num-index-row').style.display = radioValue('num-pos', 'tail') === 'custom' ? 'flex' : 'none';

  const t = radioValue('num-type', 'number');
  $('num-time-row').style.display = t === 'time' ? 'flex' : 'none';
  $('num-random-row').style.display = t === 'random' ? 'flex' : 'none';
  $('num-seq-row').style.display = t === 'random' || t === 'time' ? 'none' : 'flex';
  $('num-pad-row').style.display = t === 'number' || t === 'random' ? 'flex' : 'none';
  if (t === 'random') $('num-pad-row').querySelector('.field-label').textContent = '长度';
  else $('num-pad-row').querySelector('.field-label').textContent = '位数';

  // 类型切换时给出合理默认
  if (t === 'letter' && num($('opt-numStart').value) > 700) $('opt-numStart').value = 1;

  $('ext-body').classList.toggle('hidden', !$('opt-extEnabled').checked);
  const extType = radioValue('ext-type', 'custom');
  $('ext-label').textContent = extType === 'custom' ? '新扩展名' : '替换（旧|新）';
  $('opt-extValue').placeholder = extType === 'custom' ? '例如：jpg' : '例如：png|jpg';
  $('num-body').style.opacity = $('opt-numEnabled').checked ? '1' : '.45';
  $('num-body').style.pointerEvents = $('opt-numEnabled').checked ? 'auto' : 'none';
}

// 导入名称列表
$('btn-import-names').onclick = async () => {
  const r = await window.api.importNames();
  if (!r || !r.names || !r.names.length) {
    toast('未导入任何名称', 'warn');
    return;
  }
  $('opt-nameBank').value = r.names.join('\n');
  $('import-preview').textContent = r.names.slice(0, 60).join('\n') + (r.names.length > 60 ? `\n… 共 ${r.names.length} 个` : '');
  state.tab = 'import';
  document.querySelectorAll('.wb-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'import'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== 'import'));
  toast(`已导入 ${r.names.length} 个名称`, 'ok');
  refreshPreview();
};

// 批量新建文件夹：选择位置
$('btn-mkdir-pick').onclick = async () => {
  const items = await window.api.pickFolders();
  if (items && items[0]) {
    state.mkdirDir = items[0].path;
    $('mkdir-dir').textContent = state.mkdirDir;
  }
};

/* ============================ 执行动作 ============================ */

$('btn-action').onclick = async () => {
  const cfg = TOOLS[state.tool];
  if (cfg.wb === 'rename') return doRename();
  if (cfg.wb === 'time') return doApplyTime();
  if (cfg.wb === 'extract') return doExtract();
  if (cfg.wb === 'newfolder') return doMkdir();
};

async function doRename() {
  if (state.files.length === 0) return toast('请先添加文件', 'warn');
  await refreshPreviewNow();
  const items = state.preview.filter((p) => p.status === 'ok');
  const conflicts = state.preview.filter((p) => p.status === 'conflict' || p.status === 'invalid');
  if (items.length === 0) {
    return toast(conflicts.length ? '存在冲突或无效名称，请检查' : '没有需要重命名的项目', 'warn');
  }
  if (conflicts.length) {
    toast(`已跳过 ${conflicts.length} 项冲突/无效名称`, 'warn');
  }
  const res = await window.api.apply(items.map((p) => ({ path: p.path, newPath: p.newPath, newName: p.newName })));
  if (res.ok) toast(`成功重命名 ${res.ok} 项`, 'ok');
  if (res.failed && res.failed.length) {
    toast(`失败 ${res.failed.length} 项：${res.failed[0].reason}`, 'err');
  }
  // 改名后刷新列表真实状态：成功项指向新路径，失败项保留旧路径
  const okSet = new Set((res.log || []).map((l) => l.from.toLowerCase()));
  const nextPaths = state.preview.map((p) =>
    p.status === 'ok' && okSet.has(p.newPath.toLowerCase()) ? p.newPath : p.path
  );
  const stats = await window.api.stat(nextPaths);
  state.files = stats.filter((s) => s && !s.error);
  state.preview = [];
  renderListTitle();
  renderTable();
  refreshPreviewNow();
}

async function refreshPreviewNow() {
  if (TOOLS[state.tool].table !== 'rename' || state.files.length === 0) return;
  try {
    state.preview = await window.api.preview({ files: state.files, options: readOptions() });
  } catch (e) {
    state.preview = [];
  }
  renderTable();
}

async function doApplyTime() {
  if (state.files.length === 0) return toast('请先添加项目', 'warn');
  const useNow = radioValue('time-mode', 'fixed') === 'now';
  let mtime = null;
  let atime = null;
  if (useNow) {
    mtime = Date.now();
  } else {
    const mv = $('time-mtime').value;
    if (!mv) return toast('请选择修改时间', 'warn');
    mtime = new Date(mv).getTime();
    const av = $('time-atime').value;
    if (av) atime = new Date(av).getTime();
  }
  const res = await window.api.applyTime({ paths: state.files.map((f) => f.path), mtime, atime });
  toast(`已更新 ${res.ok} 项时间属性` + (res.failed.length ? `，失败 ${res.failed.length}` : ''), res.failed.length ? 'warn' : 'ok');
  const stats = await window.api.stat(state.files.map((f) => f.path));
  state.files = stats.filter((s) => s && !s.error);
  renderTable();
}

async function doExtract() {
  if (state.files.length === 0) return toast('请先添加项目', 'warn');
  const fmt = radioValue('extract-fmt', 'txt');
  const withExt = $('extract-withExt').checked;
  const items = state.files.map((f) => ({
    // 文件夹名称中的点不属于扩展名，不剥离
    name: withExt || f.isDirectory ? f.name : f.name.replace(/\.[^.]+$/, ''),
    path: f.path,
  }));
  const res = await window.api.extractNames({
    items,
    ext: fmt === 'csv' ? '.csv' : '.txt',
    separator: fmt === 'csv' ? ',' : '',
  });
  if (res.saved) toast(`已导出 ${res.count} 条名称`, 'ok');
}

// 撤销
$('btn-undo').onclick = async () => {
  const res = await window.api.undo();
  if (res.ok) toast(`已撤销 ${res.ok} 项`, 'ok');
  else toast('没有可撤销的操作', 'warn');
  // 撤销后文件回到旧路径：用 restored + failed 重新构建列表
  const paths = (res.restored || []).concat((res.failed || []).map((f) => f.path));
  const stats = await window.api.stat(paths);
  state.files = stats.filter((s) => s && !s.error);
  state.preview = [];
  renderListTitle();
  renderTable();
  refreshPreviewNow();
};

// 新建文件夹执行
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && TOOLS[state.tool].wb === 'newfolder' && (e.ctrlKey || e.metaKey)) {
    doMkdir();
  }
});

async function doMkdir() {
  const raw = $('mkdir-names').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return toast('请输入文件夹名称', 'warn');
  let names = raw;
  if ($('mkdir-number').checked) {
    const start = num($('mkdir-start').value, 1);
    const pad = Math.max(1, num($('mkdir-pad').value, 2));
    names = raw.map((n, i) => n + String(start + i).padStart(pad, '0'));
  }
  const res = await window.api.mkdirBatch({ dir: state.mkdirDir, names });
  if (res.canceled) return;
  state.mkdirDir = res.dir || state.mkdirDir;
  $('mkdir-dir').textContent = state.mkdirDir || '未选择';
  toast(`已创建 ${res.ok} 个文件夹` + (res.failed.length ? `，失败 ${res.failed.length}` : ''), res.failed.length ? 'warn' : 'ok');
}


// 工作台折叠
$('wb-toggle').onclick = () => {
  const wb = document.querySelector('.workbench');
  const collapsed = wb.classList.toggle('collapsed');
  $('wb-toggle').textContent = collapsed ? '›' : '‹';
  $('wb-toggle').title = collapsed ? '展开' : '折叠';
};

/* ============================ 初始化 ============================ */

(async function init() {
  $('time-mtime').value = toLocalInput(new Date());
  $('time-atime').value = '';
  syncConditionalUI();
  updateToolUI();
})();

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
