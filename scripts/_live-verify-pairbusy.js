/**
 * 线上复验：同一对用户同时只能有一摊进行中（2026-09-15）
 *
 * 场景：
 *   testB（帖主，两条临时帖 lvpair_t1 / lvpair_t2）× testD（申请人）
 *   D 两条都申请 → B 两条都确认（active）→ D 先开始 t1、B 确认 → t1 变进行中
 *   → 此时 D / B 再开始 t2 **必须 409**（旧版本这里会成功，两摊都进行中）
 *
 * 用法：node scripts/_live-verify-pairbusy.js
 * 前置：两条临时帖已由 MCP 写入数据库（authorId=sandbox:testB, status=passed）
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
  console.log('\n[线上复验] 同一对用户同时只能有一摊进行中 · ' + HOST + '\n');

  const h = await call('GET', '/health');
  check('新版本已上线（health 正常）', h.status === 200);

  const lgB = await call('POST', '/api/auth/test-login', { uid: 'testB' });
  const lgD = await call('POST', '/api/auth/test-login', { uid: 'testD' });
  check('沙盒测试账号登录可用（testB / testD）',
    lgB.json && lgB.json.data && lgB.json.data.token && lgD.json && lgD.json.data.token);
  const tB = lgB.json.data.token;
  const tD = lgD.json.data.token;
  console.log('    testB = sandbox:testB（帖主） / testD = sandbox:testD（申请人）');

  // 申请人 D 对同一帖主 B 的两条帖各申请一次
  const c1 = await call('POST', '/api/exchanges', { postId: 'lvpair_t1', message: '想学课程一' }, tD);
  const c2 = await call('POST', '/api/exchanges', { postId: 'lvpair_t2', message: '想学课程二' }, tD);
  check('D 对两条帖的申请都创建成功', c1.json.code === 0 && c2.json.code === 0,
    JSON.stringify(c1.json) + ' / ' + JSON.stringify(c2.json));
  const e1 = c1.json.data && c1.json.data._id;
  const e2 = c2.json.data && c2.json.data._id;

  const cf1 = await call('POST', `/api/exchanges/${e1}/confirm`, {}, tB);
  const cf2 = await call('POST', `/api/exchanges/${e2}/confirm`, {}, tB);
  check('B 把两条申请都确认成待开始（active 阶段不互相占用）',
    cf1.json.data && cf1.json.data.status === 'active' &&
    cf2.json.data && cf2.json.data.status === 'active');

  // 第一摊开起来
  await call('POST', `/api/exchanges/${e1}/start`, {}, tD);
  const st1 = await call('POST', `/api/exchanges/${e1}/start`, {}, tB);
  check('第一摊双方确认开始 → 进行中(started)',
    st1.json.data && st1.json.data.status === 'started');

  // 核心：第二摊必须被拦住
  const r1 = await call('POST', `/api/exchanges/${e2}/start`, {}, tD);
  check('★ 申请人再开始第二摊 → 409（旧版本这里是 200）',
    r1.status === 409 && /你和 TA/.test(r1.json.msg || ''), r1.status + ' ' + r1.body.slice(0, 160));

  const r2 = await call('POST', `/api/exchanges/${e2}/start`, {}, tB);
  check('★ 帖主再开始第二摊 → 409', r2.status === 409 && /你和 TA/.test(r2.json.msg || ''),
    r2.status + ' ' + r2.body.slice(0, 160));

  const d2 = await call('GET', `/api/exchanges/${e2}`, null, tB);
  check('第二摊仍是 active，且下发 peerBusy=true / postBusy=false',
    d2.json.data.status === 'active' && d2.json.data.peerBusy === true && d2.json.data.postBusy === false,
    JSON.stringify({ status: d2.json.data.status, peerBusy: d2.json.data.peerBusy, postBusy: d2.json.data.postBusy }));

  const d1 = await call('GET', `/api/exchanges/${e1}`, null, tB);
  check('进行中那条自己不置灰（peerBusy=false）', d1.json.data.peerBusy === false);

  // 换一对人（同一位帖主）不受影响：C 申请 → B 确认 → 应放行
  const lgC = await call('POST', '/api/auth/test-login', { uid: 'testC' });
  const tC = lgC.json.data.token;
  const c3 = await call('POST', '/api/exchanges', { postId: 'lvpair_t1', message: '我也来' }, tC);
  const cf3 = await call('POST', `/api/exchanges/${c3.json.data._id}/confirm`, {}, tB);
  check('换一对人（testC）仍可被确认 → active（只约束同一对）',
    cf3.json.data && cf3.json.data.status === 'active', JSON.stringify(cf3.json));

  const list = await call('GET', '/api/exchanges', null, tD);
  const row2 = (list.json.data.list || []).filter((x) => x._id === e2)[0];
  check('「我的交换」列表每行带 peerBusy', !!row2 && row2.peerBusy === true);

  console.log('\n本次复验产生的记录（待清理）：');
  console.log('  exchanges:', [e1, e2, c3.json.data._id].join(', '));
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
