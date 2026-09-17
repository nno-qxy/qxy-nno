/** 一次性诊断：线上 /api/admin/users 无 keyword 时返回什么 */
const { execFileSync } = require('child_process');
const BASE = 'https://nno-d2gspwvpl6c3c9f46-1479540360.ap-shanghai.app.tcloudbase.com/skillswap-api';

function curl(method, path, body, token) {
  const a = ['-s', '-m', '20', '-X', method, BASE + path, '-H', 'Content-Type: application/json'];
  if (token) a.push('-H', 'Authorization: Bearer ' + token);
  if (body) a.push('-d', JSON.stringify(body));
  a.push('-w', '\n__HTTP__%{http_code}');
  const o = execFileSync('curl', a, { encoding: 'utf8' });
  const i = o.lastIndexOf('\n__HTTP__');
  const s = i >= 0 ? Number(o.slice(i + 9)) : 0;
  const t = i >= 0 ? o.slice(0, i) : o;
  let d = null;
  try { d = JSON.parse(t); } catch (_) { d = t; }
  return { s, d };
}

(async () => {
  const lg = curl('POST', '/api/admin/login', { username: 'admin', password: 'Admin@12345' });
  console.log('登录 HTTP', lg.s, JSON.stringify(lg.d).slice(0, 200));
  const tok = lg.d && lg.d.data && lg.d.data.token;
  if (!tok) return;

  console.log('\n=== GET /api/admin/users (无 keyword) ===');
  const r = curl('GET', '/api/admin/users', null, tok);
  console.log('HTTP', r.s);
  console.log('返回:', JSON.stringify(r.d).slice(0, 600));
  if (r.d && r.d.data && r.d.data.list) console.log('>>> 用户数:', r.d.data.list.length);

  console.log('\n=== GET /api/admin/users?keyword= (空串) ===');
  const r2 = curl('GET', '/api/admin/users?keyword=', null, tok);
  console.log('HTTP', r2.s, JSON.stringify(r2.d).slice(0, 400));

  console.log('\n=== GET /api/admin/stats (对照：总用户数) ===');
  const r3 = curl('GET', '/api/admin/stats', null, tok);
  console.log('HTTP', r3.s, JSON.stringify(r3.d && r3.d.data && r3.d.data.users));
})();
