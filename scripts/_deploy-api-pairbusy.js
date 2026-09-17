/**
 * 部署 skillswap-api 云函数（本机 Git Bash shim 不可用，故用 node spawnSync 传 cwd）
 * 用法：node scripts/_deploy-api-pairbusy.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ENV_ID = 'nno-d2gspwvpl6c3c9f46';
const ROOT = path.resolve(__dirname, '..');
const cwd = path.join(ROOT, 'cloudbase');
const tcb = path.join(process.env.APPDATA || '', 'npm', 'tcb.cmd');

console.log('[deploy] tcb =', tcb);
console.log('[deploy] cwd =', cwd);

const r = spawnSync(tcb, ['fn', 'deploy', 'skillswap-api', '--force', '-e', ENV_ID], {
  cwd,
  encoding: 'utf8',
  shell: true,
});

console.log('[deploy] status =', r.status);
console.log('---- stdout ----');
console.log((r.stdout || '').slice(-3000));
console.log('---- stderr ----');
console.log((r.stderr || '').slice(-1500));
process.exit(r.status === 0 ? 0 : 1);
