/**
 * 把 admin-web 构建产物拷入 admin-static 云函数目录
 * 用法：npm run build:deploy（先 build 再拷贝），或 node scripts/copy-dist.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'admin-web', 'dist');
const DEST = path.join(__dirname, '..', 'cloudbase', 'functions', 'admin-static', 'dist');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const f of fs.readdirSync(p)) {
    const c = path.join(p, f);
    if (fs.statSync(c).isDirectory()) rmrf(c);
    else fs.unlinkSync(c);
  }
  fs.rmdirSync(p);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) n += copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

if (!fs.existsSync(SRC)) {
  console.error('未找到构建产物：' + SRC + '\n请先执行 npm run build');
  process.exit(1);
}

rmrf(DEST);
const count = copyDir(SRC, DEST);

let total = 0;
(function size(p) {
  for (const f of fs.readdirSync(p)) {
    const c = path.join(p, f);
    if (fs.statSync(c).isDirectory()) size(c);
    else total += fs.statSync(c).size;
  }
})(DEST);

console.log('已拷贝 ' + count + ' 个文件到 ' + path.relative(process.cwd(), DEST));
console.log('产物体积：' + (total / 1024).toFixed(1) + ' KB（云函数代码包上限 50MB）');
if (total > 20 * 1024 * 1024) {
  console.warn('警告：产物偏大，可能影响部署与冷启动');
}
