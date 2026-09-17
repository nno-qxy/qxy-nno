/**
 * 一键灌入测试数据基底（150 条：22 用户 + 100 帖 + 28 交换）
 * 前置：已部署 skillswap-api 且配置好 ADMIN_USER / ADMIN_PASS_HASH 环境变量。
 * 用法：node scripts/seed-run.js            # 追加写入（不清空已有数据）
 *      node scripts/seed-run.js --reset     # 先清空三集合再写入
 *
 * 依赖系统 curl（与 verify-seed.js 一致）。沙箱无法执行部署，请在本地 cmd 运行。
 */
const { execFileSync } = require('child_process');

const BASE = 'https://nno-d2gspwvpl6c3c9f46-1479540360.ap-shanghai.app.tcloudbase.com/skillswap-api';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@12345';
const RESET = process.argv.includes('--reset');

function curl(method, path, body, token) {
  const a = ['-s', '-m', '30', '-X', method, BASE + path, '-H', 'Content-Type: application/json'];
  if (token) a.push('-H', 'Authorization: Bearer ' + token);
  if (body) a.push('-d', JSON.stringify(body));
  a.push('-w', '\n__HTTP__%{http_code}');
  const o = execFileSync('curl', a, { encoding: 'utf8' });
  const i = o.lastIndexOf('\n__HTTP__');
  const s = i >= 0 ? Number(o.slice(i + 9)) : 0;
  const t = i >= 0 ? o.slice(0, i) : o;
  let d = null;
  try { d = JSON.parse(t); } catch (_) {}
  return { s, d };
}

(function () {
  console.log('登录管理端…');
  const lg = curl('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASS });
  if (!lg.d || !lg.d.data || !lg.d.data.token) {
    console.error('登录失败：', JSON.stringify(lg.d), 'HTTP', lg.s);
    process.exit(1);
  }
  const tok = lg.d.data.token;
  console.log('登录成功，开始灌库（reset=' + RESET + '）…');
  const res = curl('POST', '/api/admin/seed', { reset: RESET }, tok);
  console.log('HTTP', res.s);
  console.log(JSON.stringify(res.d, null, 2));
  if (res.d && res.d.code === 0) {
    console.log('\n✅ 灌库完成。可访问管理端首页看板，或用 verify-seed.js 校验。');
  } else {
    console.error('\n❌ 灌库失败，请检查 skillswap-api 是否已部署最新版（含 /api/admin/seed）。');
    process.exit(1);
  }
})();
