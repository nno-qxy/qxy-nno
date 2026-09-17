/**
 * 阶段 4 逻辑层冒烟测试
 * 覆盖：Z-08 发起申请（成功 / 非 passed / 自己的帖 / 重复）、
 *       Z-09 收到申请列表 + 确认 / 拒绝（越权 / 状态冲突）、
 *       Z-10 我的交换分组 + 详情越权校验、
 *       Z-11 完成（双人到齐 → completed）+ 评价（原子自增对方好评）
 * 运行：node tests/stage4.test.js
 */

const assert = require('assert');
const path = require('path');
const { install } = require('./helpers/mock-cloudbase');

const API_DIR = path.resolve(__dirname, '../cloudbase/functions/skillswap-api');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' → ' + (e && e.stack || e)); failed++; }
}

function clearApiCache() {
  Object.keys(require.cache).forEach((k) => { if (k.startsWith(API_DIR)) delete require.cache[k]; });
}
function loadApi() {
  clearApiCache();
  return require(path.join(API_DIR, 'index.js')).main;
}
function jsonOf(res) { return JSON.parse(res.body); }

(async () => {
  console.log('\n[阶段4] skillswap-api · 交换闭环 冒烟测试\n');

  const mock = install({ adminPassHash: 'x' });
  const main = loadApi();

  const oA = 'openid_from_USER_A';
  const oB = 'openid_from_USER_B';
  const oC = 'openid_from_USER_C';

  // 预置用户（必须在登录前，避免登录自动建号产生空昵称重复文档）
  mock.stores.users.push(
    { _openid: oA, nickname: '小A', avatarColor: '#2B62E0', goodCount: 0, totalCount: 0 },
    { _openid: oB, nickname: '小B', avatarColor: '#7A3FE0', goodCount: 0, totalCount: 0 },
    { _openid: oC, nickname: '小C', avatarColor: '#1F8A4C', goodCount: 0, totalCount: 0 },
  );

  function req(method, p, body, headers, token) {
    const h = Object.assign({}, headers);
    if (token) h.Authorization = 'Bearer ' + token;
    return main({
      httpMethod: method, path: p, headers: h,
      queryStringParameters: {}, body: body == null ? '' : JSON.stringify(body),
      isBase64Encoded: false,
    });
  }
  async function loginAs(code) {
    const r = jsonOf(await req('POST', '/api/auth/login', { code }));
    return r.data.token;
  }

  // ----- 预置：两个用户登录 + 一篇 passed 帖（A 发布，B 来申请） -----
  const tokenA = await loginAs('USER_A'); // openid_from_USER_A
  const tokenB = await loginAs('USER_B'); // openid_from_USER_B
  const tokenC = await loginAs('USER_C'); // 第三方，用于越权校验
  mock.stores.posts.push(
    { _id: 'post1', title: '教高数', type: 'teach', category: '学业辅导', content: '高数辅导', tags: ['高数'], authorId: oA, authorName: '小A', authorAvatar: '#2B62E0', status: 'passed', createTime: Date.now() - 3000, updateTime: Date.now() - 3000 },
    // post2：与 post1 分开，用于「post1 被 B 的 active 交换占用后」的拒绝分支
    { _id: 'post2', title: '教线代', type: 'teach', category: '学业辅导', content: '线代辅导', tags: ['线代'], authorId: oA, authorName: '小A', authorAvatar: '#2B62E0', status: 'passed', createTime: Date.now() - 2500, updateTime: Date.now() - 2500 },
    { _id: 'post_pending', title: '待审帖', type: 'teach', category: '学业辅导', content: 'x', tags: [], authorId: oA, status: 'pending', createTime: Date.now() - 2000, updateTime: Date.now() - 2000 },
  );

  // ===== Z-08 发起申请 =====
  console.log('Z-08 发起申请');

  let exId;
  await t('B 对 post1 发起申请 → 200 + status=pending', async () => {
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'post1' }, null, tokenB));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending');
    assert.ok(b.data._id);
    exId = b.data._id;
  });

  await t('未登录发起申请 → 401', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'post1' });
    assert.strictEqual(r.statusCode, 401);
  });

  await t('重复申请同一帖 → 409', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'post1' }, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('申请自己的帖（A 申请 post1）→ 403', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'post1' }, null, tokenA);
    assert.strictEqual(r.statusCode, 403);
  });

  await t('申请非 passed 帖（post_pending）→ 409', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'post_pending' }, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('申请不存在的帖 → 404', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'nope' }, null, tokenB);
    assert.strictEqual(r.statusCode, 404);
  });

  // ===== Z-09 收到申请 + 确认 / 拒绝 =====
  console.log('Z-09 收到申请 + 处理');

  await t('A（帖主）收到列表含该申请，myRole=target，peer=小B', async () => {
    const b = jsonOf(await req('GET', '/api/exchanges/received', null, null, tokenA));
    assert.strictEqual(b.data.list.length, 1);
    const e = b.data.list[0];
    assert.strictEqual(e.myRole, 'target');
    assert.strictEqual(e.peerName, '小B');
    assert.strictEqual(e.status, 'pending');
  });

  await t('B（申请人）看不到 received 列表里的这条（不是帖主）', async () => {
    const b = jsonOf(await req('GET', '/api/exchanges/received', null, null, tokenB));
    assert.strictEqual(b.data.list.length, 0);
  });

  await t('A 确认 → status=active', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/confirm`, {}, null, tokenA));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('B 越权确认（非帖主）→ 403', async () => {
    // 先 B 重新发起一个，再用 A 确认，再 B 越权 confirm 另一个已 active 的
    const r = await req('POST', `/api/exchanges/${exId}/confirm`, {}, null, tokenB);
    assert.strictEqual(r.statusCode, 403);
  });

  await t('重复确认 → 409（状态已非 pending）', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/confirm`, {}, null, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  // 帖主已接受（active）不再锁帖：其他人照样可以发起申请（2026-09-14 规则修订）
  await t('post1 上有 B 的 active 交换 → C 仍可发起（待开始不锁帖）', async () => {
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'post1' }, null, tokenC));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending');
  });

  // 拒绝分支：由 C 在另一条未被占用的帖上发起，A 拒绝（用 C 避免与 B 已有申请冲突）
  await t('A 拒绝另一条申请 → status=rejected', async () => {
    const cr = jsonOf(await req('POST', '/api/exchanges', { postId: 'post2' }, null, tokenC));
    const newId = cr.data._id;
    const b = jsonOf(await req('POST', `/api/exchanges/${newId}/reject`, {}, null, tokenA));
    assert.strictEqual(b.data.status, 'rejected');
    const r2 = await req('POST', `/api/exchanges/${newId}/confirm`, {}, null, tokenA);
    assert.strictEqual(r2.statusCode, 409);
  });

  // ===== Z-10 我的交换 + 详情越权 =====
  console.log('Z-10 我的交换');

  await t('B 的「我的交换」包含申请，myRole=applicant', async () => {
    const b = jsonOf(await req('GET', '/api/exchanges', null, null, tokenB));
    assert.ok(b.data.list.length >= 1);
    const e = b.data.list.find((x) => x._id === exId);
    assert.ok(e, '应含 exId');
    assert.strictEqual(e.myRole, 'applicant');
    assert.strictEqual(e.status, 'active');
  });

  await t('C（非当事方）查看详情 → 403', async () => {
    const r = await req('GET', `/api/exchanges/${exId}`, null, null, tokenC);
    assert.strictEqual(r.statusCode, 403);
  });

  await t('A 查看详情 → 200 且含双方信息', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${exId}`, null, null, tokenA));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.applicantId, oB);
    assert.strictEqual(b.data.targetId, oA);
  });

  // ===== Z-11 完成 + 互评 =====
  console.log('Z-11 完成与互评');

  await t('待开始阶段点「标记完成」→ 409（必须先双方都「开始」）', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('双方各点一次「开始」→ 先 active，两人齐全后 started', async () => {
    const b1 = jsonOf(await req('POST', `/api/exchanges/${exId}/start`, {}, null, tokenA));
    assert.strictEqual(b1.data.status, 'active', '只点一次还不算开始');
    const b2 = jsonOf(await req('POST', `/api/exchanges/${exId}/start`, {}, null, tokenB));
    assert.strictEqual(b2.data.status, 'started');
  });

  await t('A 点击完成（仅 1 人）→ status 仍 started，completedBy=[A]', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenA));
    assert.strictEqual(b.data.status, 'started');
    assert.deepStrictEqual(b.data.completedBy, [oA]);
  });

  await t('B 点击完成（第 2 人）→ status=completed', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenB));
    assert.strictEqual(b.data.status, 'completed');
    assert.deepStrictEqual(b.data.completedBy.sort(), [oA, oB].sort());
  });

  await t('重复点击完成 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  // 注意：这里不能再用「新建一条同帖同人的申请」来造数据了。
  // 去重规则是「同一人对同一帖同时只能有一笔未结束的交换」，上一条用例已经留下了 pending 的记录，
  // 再建会被正确拦成 409（旧代码只检查查到的那一条记录，恰好是已完成的那笔，所以曾经是「碰巧通过」）。
  let pendingExId = null;
  await t('pending 阶段不能完成（新建一条 pending 试 complete）→ 409', async () => {
    const cr = jsonOf(await req('POST', '/api/exchanges', { postId: 'post1' }, null, tokenB));
    pendingExId = cr.data._id;
    const r = await req('POST', `/api/exchanges/${pendingExId}/complete`, {}, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('同一帖已有未结束申请时重复发起 → 409', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'post1' }, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('B（学员）评价 satisfied=true → A 的好评数/总评数各 +1', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/evaluate`, { satisfied: true }, null, tokenB));
    assert.strictEqual(b.data.rating, 'satisfied');
    assert.strictEqual(b.data.role, 'learner');
    assert.strictEqual(b.data.counterpart, oA);
    const a = mock.stores.users.find((u) => u._openid === oA);
    assert.strictEqual(a.goodCount, 1);
    assert.strictEqual(a.totalCount, 1);
  });

  await t('A（教学者）评价只写评语 → 强制不计分（B 的统计保持 0）', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/evaluate`, { rating: 'dissatisfied', comment: '基础可以再扎实些' }, null, tokenA));
    assert.strictEqual(b.data.role, 'teacher');
    assert.strictEqual(b.data.rating, null, '教学者不参与满意/不满意');
    assert.strictEqual(b.data.comment, '基础可以再扎实些');
    assert.strictEqual(b.data.counterpart, oB);
    const buser = mock.stores.users.find((u) => u._openid === oB);
    assert.strictEqual(buser.totalCount || 0, 0, '教学者评语不计入对方评价数');
    assert.strictEqual(buser.goodCount || 0, 0);
  });

  await t('重复评价 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/evaluate`, { satisfied: true }, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('未完成状态评价 → 409', async () => {
    await req('POST', `/api/exchanges/${pendingExId}/confirm`, {}, null, tokenA);
    const r = await req('POST', `/api/exchanges/${pendingExId}/evaluate`, { satisfied: true }, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  // ================= 沙盒模式（SANDBOX_MODE：单账号自交换验收） =================
  console.log('\n沙盒模式（单账号验收）');

  const mockSb = install({ adminPassHash: 'x', sandbox: true });
  const mainSb = loadApi();

  function reqSb(method, p, body, token) {
    const h = token ? { Authorization: 'Bearer ' + token } : {};
    return mainSb({
      httpMethod: method, path: p, headers: h,
      queryStringParameters: {}, body: body == null ? '' : JSON.stringify(body),
      isBase64Encoded: false,
    });
  }

  mockSb.stores.users.push({ _openid: 'openid_from_USER_A', nickname: '小A', avatarColor: '#2B62E0', goodCount: 0, totalCount: 0 });
  const tokA2 = jsonOf(await reqSb('POST', '/api/auth/login', { code: 'USER_A' })).data.token;
  mockSb.stores.posts.push({
    _id: 'sp1', title: '教吉他', type: 'teach', category: '文艺特长', content: '零基础吉他',
    tags: ['吉他'], authorId: 'openid_from_USER_A', authorName: '小A', status: 'passed',
    createTime: Date.now(), updateTime: Date.now(),
  });

  let selfExId;
  await t('沙盒下 A 对自己的帖发起交换 → 允许，applicant=target', async () => {
    const b = jsonOf(await reqSb('POST', '/api/exchanges', { postId: 'sp1', message: '自测' }, tokA2));
    assert.strictEqual(b.code, 0);
    selfExId = b.data._id;
    const rec = mockSb.stores.exchanges.find((e) => e._id === selfExId);
    assert.strictEqual(rec.applicantId, rec.targetId, '沙盒自交换双方为同一账号');
  });

  await t('自交换可被本人同意 → active', async () => {
    const b = jsonOf(await reqSb('POST', `/api/exchanges/${selfExId}/confirm`, {}, tokA2));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('自交换点一次「开始」即 started（沙盒单人视同双方）', async () => {
    const b = jsonOf(await reqSb('POST', `/api/exchanges/${selfExId}/start`, {}, tokA2));
    assert.strictEqual(b.data.status, 'started');
  });

  await t('自交换第一次「标记完成」即 completed（单账号可闭环）', async () => {
    const b = jsonOf(await reqSb('POST', `/api/exchanges/${selfExId}/complete`, {}, tokA2));
    assert.strictEqual(b.data.status, 'completed');
  });

  await t('自交换评价生效但不给自己刷分', async () => {
    const b = jsonOf(await reqSb('POST', `/api/exchanges/${selfExId}/evaluate`, { satisfied: true }, tokA2));
    assert.strictEqual(b.data.selfSwap, true, '应标记 selfSwap');
    const u = mockSb.stores.users.find((x) => x._openid === 'openid_from_USER_A');
    assert.strictEqual(u.goodCount, 0, '自交换不累计好评');
    assert.strictEqual(u.totalCount, 0, '自交换不累计总评');
  });

  await t('沙盒关闭（默认）时仍禁止对自己的帖发起交换 → 403', async () => {
    const mockOff = install({ adminPassHash: 'x' }); // 不传 sandbox → SANDBOX_MODE 不存在
    const mainOff = loadApi();
    mockOff.stores.users.push({ _openid: 'openid_from_USER_A', nickname: '小A', avatarColor: '#2B62E0' });
    const loginRes = await mainOff({
      httpMethod: 'POST', path: '/api/auth/login', headers: {}, queryStringParameters: {},
      body: JSON.stringify({ code: 'USER_A' }), isBase64Encoded: false,
    });
    const tok = jsonOf(loginRes).data.token;
    mockOff.stores.posts.push({
      _id: 'sp2', title: '教吉他', type: 'teach', category: '文艺特长', content: 'x',
      tags: [], authorId: 'openid_from_USER_A', authorName: '小A', status: 'passed',
      createTime: Date.now(), updateTime: Date.now(),
    });
    const r = await mainOff({
      httpMethod: 'POST', path: '/api/exchanges', headers: { Authorization: 'Bearer ' + tok },
      queryStringParameters: {}, body: JSON.stringify({ postId: 'sp2' }), isBase64Encoded: false,
    });
    assert.strictEqual(r.statusCode, 403);
  });

  // ---------- 汇总 ----------
  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})();
