/**
 * 小程序端静态校验（无需开发者工具）
 * 1. 所有 JS 语法检查
 * 2. app.json 中 pages / tabBar 指向的文件是否齐全
 * 3. 各页面 usingComponents 路径是否存在
 * 4. WXML 里引用的组件标签是否已在 json 中声明
 * 运行：node tests/check-miniprogram.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const NODE = process.execPath;

let errors = [];
let checked = 0;

function walk(dir, ext, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// ---------- 1. JS 语法 ----------
console.log('\n[1] JS 语法检查');
walk(ROOT, '.js').forEach((f) => {
  try {
    execFileSync(NODE, ['--check', f], { stdio: 'pipe' });
    console.log('  ✓ ' + path.relative(ROOT, f));
    checked++;
  } catch (e) {
    console.log('  ✗ ' + path.relative(ROOT, f) + ' → ' + e.stderr.toString().split('\n')[2]);
    errors.push('JS 语法错误: ' + f);
  }
});

// ---------- 2. app.json 页面文件齐全 ----------
console.log('\n[2] 页面文件完整性');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const REQUIRED = ['.js', '.json', '.wxml', '.wxss'];

appJson.pages.forEach((p) => {
  REQUIRED.forEach((ext) => {
    const f = path.join(ROOT, p + ext);
    if (!fs.existsSync(f)) {
      console.log('  ✗ 缺失 ' + p + ext);
      errors.push('页面文件缺失: ' + p + ext);
    }
  });
  if (REQUIRED.every((ext) => fs.existsSync(path.join(ROOT, p + ext)))) {
    console.log('  ✓ ' + p);
  }
});

// ---------- 3. tabBar 路径必须在 pages 中 ----------
console.log('\n[3] tabBar 配置');
(appJson.tabBar ? appJson.tabBar.list : []).forEach((t) => {
  if (appJson.pages.indexOf(t.pagePath) >= 0) console.log('  ✓ ' + t.text + ' → ' + t.pagePath);
  else {
    console.log('  ✗ tabBar 指向的页面未在 pages 中: ' + t.pagePath);
    errors.push('tabBar 页面未注册: ' + t.pagePath);
  }
});

// ---------- 4. 组件与页面引用 ----------
console.log('\n[4] usingComponents 与 WXML 标签');
function checkDir(dir, label, base = 'index') {
  const jsonPath = path.join(dir, base + '.json');
  const wxmlPath = path.join(dir, base + '.wxml');
  if (!fs.existsSync(jsonPath) || !fs.existsSync(wxmlPath)) return;
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const using = json.usingComponents || {};
  const wxml = fs.readFileSync(wxmlPath, 'utf8');

  Object.keys(using).forEach((tag) => {
    const rel = using[tag];
    const abs = rel.startsWith('/')
      ? path.join(ROOT, rel)
      : path.resolve(dir, rel);
    const okFile = ['.js', '.json', '.wxml', '.wxss'].every((e) => fs.existsSync(abs + e));
    if (okFile) console.log('  ✓ ' + label + ' 引用 ' + tag + ' → ' + rel);
    else {
      console.log('  ✗ ' + label + ' 引用 ' + tag + ' 指向不存在: ' + rel);
      errors.push(label + ' 组件路径错误: ' + rel);
    }
  });

  // WXML 里用到的非内置标签，必须在 usingComponents 声明
  const BUILTIN = new Set([
    'block', 'template', 'import', 'include', 'slot', 'wxs',
    'view', 'text', 'image', 'icon', 'rich-text', 'progress', 'scroll-view',
    'swiper', 'swiper-item', 'movable-area', 'movable-view', 'cover-view', 'cover-image',
    'button', 'checkbox', 'checkbox-group', 'form', 'input', 'label', 'picker',
    'picker-view', 'picker-view-column', 'radio', 'radio-group', 'slider', 'switch', 'textarea',
    'navigator', 'audio', 'video', 'camera', 'canvas', 'map', 'open-data', 'web-view',
    'page-meta', 'navigation-bar', 'page-container', 'share-element', 'keyboard-accessory',
  ]);

  const tags = new Set();
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)[\s/>]/g;
  let m;
  while ((m = re.exec(wxml))) if (!BUILTIN.has(m[1])) tags.add(m[1]);
  tags.forEach((tag) => {
    if (!using[tag]) {
      console.log('  ✗ ' + label + ' 的 WXML 使用了未声明的组件 <' + tag + '>');
      errors.push(label + ' 未声明组件: ' + tag);
    } else {
      console.log('  ✓ ' + label + ' 的 WXML 组件 <' + tag + '> 已声明');
    }
  });
}

walk(path.join(ROOT, 'components'), '.json').forEach((f) => {
  const dir = path.dirname(f);
  checkDir(dir, '组件 ' + path.relative(ROOT, dir));
});
// 页面：文件名与目录名可能不同（如 my-posts/my-posts.wxml），用 app.json 里的 basename
appJson.pages.forEach((p) => {
  const dir = path.dirname(path.join(ROOT, p));
  const base = path.basename(p);
  checkDir(dir, '页面 ' + p, base);
});

// ---------- 4b. 跳转路径有效性 ----------
// wx.navigateTo / redirectTo / switchTab / reLaunch 的 url 必须命中 app.json 的 pages
// 且 switchTab 只能跳 tabBar 页面（跳非 tab 页会静默失败，是最难排查的一类 bug）
console.log('\n[4b] 页面跳转路径');
const TAB_PAGES = new Set((appJson.tabBar ? appJson.tabBar.list : []).map((t) => t.pagePath));
const JUMP_RE = /wx\.(navigateTo|redirectTo|switchTab|reLaunch)\s*\(\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]/g;
const JS_FILES = walk(ROOT, '.js');

function normalizeUrl(u) {
  // 去掉 query（?id=xxx）与可能的变量拼接尾巴，取路径主体
  const clean = String(u).split('?')[0].split('+')[0];
  return clean.replace(/^\//, '');
}

JS_FILES.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  const re = new RegExp(JUMP_RE.source, 'g');
  while ((m = re.exec(src))) {
    const api = m[1];
    const url = m[2];
    const page = normalizeUrl(url);
    if (!page) continue;
    const label = path.relative(ROOT, f) + ' → ' + api + '("' + url + '")';
    if (appJson.pages.indexOf(page) < 0) {
      console.log('  ✗ ' + label + ' 目标页面未注册');
      errors.push('跳转未注册页面: ' + page);
    } else if (api === 'switchTab' && !TAB_PAGES.has(page)) {
      console.log('  ✗ ' + label + ' switchTab 只能跳 tabBar 页面');
      errors.push('switchTab 目标非 tabBar 页: ' + page);
    } else {
      console.log('  ✓ ' + label);
    }
  }
});

// ---------- 5. 设计 Token 引用检查（禁止硬编码主色） ----------
console.log('\n[5] 样式规范：是否绕过 Token 硬编码');
const HARDCODE = ['#FF2442', '#C2183D', '#2B62E0', '#7A3FE0'];
const TOKEN_FILE = path.join('styles', 'tokens.wxss'); // Token 定义文件本身允许写死色值
walk(ROOT, '.wxss')
  .filter((f) => !f.endsWith(TOKEN_FILE))
  .forEach((f) => {
  const css = fs.readFileSync(f, 'utf8');
  HARDCODE.forEach((c) => {
    if (css.includes(c)) {
      console.log('  ! ' + path.relative(ROOT, f) + ' 出现硬编码色值 ' + c + '（建议改用 Token）');
    }
  });
});
console.log('  （提示项，不计入失败）');

console.log('\n结果：检查 ' + checked + ' 个 JS 文件，错误 ' + errors.length + ' 项\n');
process.exit(errors.length ? 1 : 0);
