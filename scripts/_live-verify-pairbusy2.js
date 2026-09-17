/**
 * 线上复验（补充）：确认约束维度是「同一对用户」而不是「同一个人」
 * 帖主 testB 已与 testD 在 lvpair_t1 上进行中；
 * 此时 testC 申请 lvpair_t2 → 应能确认并开始（B 同时带两个学生，互不干扰）
 *
 * 用法：node scripts/_live-verify-pairbusy2.js
 */
const https = require('https');

const HOST = 'nno-d2gspwvpl6c3c9f46.service.tcloudbase.com';
const BASE = '/skillswap-api';

function call(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const d = body == null ? '' : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = https.request({ host: HOST, path: BASE + path, method, headers }, (x) => {
      let s = '';
      x.on('data', (c) => { s += c; });
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(s); } catch (_) {}
        resolve({ status: x.statusCode, body: s, json });
      });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); fail++; }
}

(async () => {
  console.log('\n[线上复验 · 补] 只约束同一对用户，不影响同一位帖主带其他人\n');

  const tB = (await call('POST', '/api/auth/test-login', { uid: 'testB' })).json.data.token;
  const tC = (await call('POST', '/api/auth/test-login', { uid: 'testC' })).json.data.token;

  const c = await call('POST', '/api/exchanges', { postId: 'lvpair_t2', message: '我想学课程二' }, tC);
  check('testC 申请帖主 testB 的另一条帖（t2）→ pending', c.json.code === 0 && c.json.data.status === 'pending',
    JSON.stringify(c.json));
  const eC = c.json.data && c.json.data._id;

  const cf = await call('POST', `/api/exchanges/${eC}/confirm`, {}, tB);
  check('帖主确认 testC 的申请 → active（帖主可与不同人并行）',
    cf.json.data && cf.json.data.status === 'active', JSON.stringify(cf.json));

  await call('POST', `/api/exchanges/${eC}/start`, {}, tC);
  const st = await call('POST', `/api/exchanges/${eC}/start`, {}, tB);
  check('双方开始 → started（帖主同时带两个学生，互不干扰）',
    st.json.data && st.json.data.status === 'started', JSON.stringify(st.json));

  console.log('\n本次新增记录（待清理）：' + eC);
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
