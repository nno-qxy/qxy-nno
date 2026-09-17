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
  let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { s, d };
}
(async () => {
  const lg = curl('POST', '/api/admin/login', { username: 'admin', password: 'Admin@12345' });
  const tok = lg.d.data.token;
  const sq = curl('GET', '/api/posts', null, tok);
  console.log('广场 passed 帖:', (sq.d.data.list || []).length);
  const pend = curl('GET', '/api/admin/posts?status=pending', null, tok);
  const pl = (pend.d.data.list || []);
  console.log('管理端待审核 pending 帖:', pl.length);
  pl.forEach((p) => console.log('  full _id =', p._id, '|', p.title, '| 作者', p.authorName));
  const usr = curl('GET', '/api/admin/users', null, tok);
  const ul = (usr.d.data.list || usr.d.data || []);
  console.log('用户列表总数:', ul.length);
  ul.slice(0, 6).forEach((u) => console.log('  -', u.nickname, '|', u._openid, '|', u.status, '| 学号', u.studentId));
})();
