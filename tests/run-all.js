/**
 * 一键跑全量本地测试并汇总
 * 用法：node tests/run-all.js
 *
 * 注意：本机 Git Bash shim 曾出现 `grep/tail/head` 缺失，
 * 因此这里用 Node 自身统计，不依赖任何 shell 外部命令。
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 自动发现同目录下所有 *.test.js，避免新加套件后这里忘同步（曾漏掉 stage6~stage11）
const SUITES = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => f.replace(/\.test\.js$/, ''))
  .sort();

let totalPass = 0;
let totalFail = 0;
const bad = [];

console.log('\n[全量测试] skillswap 本地套件\n');

SUITES.forEach((name) => {
  const file = path.join(__dirname, name + '.test.js');
  let out = '';
  try {
    out = execFileSync(process.execPath, [file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
  }
  const pass = (out.match(/✓/g) || []).length;
  const fail = (out.match(/✗/g) || []).length;
  totalPass += pass;
  totalFail += fail;
  if (fail) bad.push(name);
  console.log('  ' + (fail ? '✗' : '✓') + ' ' + name.padEnd(16) + ' 通过 ' + pass + ' / 失败 ' + fail);
});

console.log('\n合计：通过 ' + totalPass + ' / 失败 ' + totalFail);
if (bad.length) {
  console.log('失败套件：' + bad.join(', '));
  process.exit(1);
}
console.log('');
