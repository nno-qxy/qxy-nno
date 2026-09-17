/**
 * 阶段 9 逻辑层冒烟测试：取消交换（cancelled 终态）
 * 规则（与前端按钮一致）：
 *   - 「标记完成」只在 双方都点了「开始」(started) 之后才允许；
 *   - 「取消交换」只在 双方还没开始协作的「待开始」(active) 阶段出现；
 *   - 双方各确认一次取消 → cancelled：**直接跳过评价**，也不再互发联系方式；
 *   - 点「开始」会清空 cancelBy、点「取消」会清空 startBy，两者互斥。
 * 覆盖：
 *   - POST /api/exchanges/:id/cancel  正常流 / 越权 / 状态 / 重复
 *   - cancelled 终态：不能 complete / start / cancel-start / evaluate
 *   - complete 收紧：active 阶段 409，started 阶段两人齐全才 completed
 *   - 列表与详情下发 cancelBy / iRequestedCancel / peerRequestedCancel
 * 运行：node tests/stage9-cancel-exchange.test.js
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
  console.log('\n[阶段9] skillswap-api · 取消交换（双方确认 → 跳过评价） 冒烟测试\n');

  const mock = install({ adminPassHash: 'x' });
  const main = loadApi();

  const oA = 'openid_from_T9_A'; // 帖主 / 教学者
  const oB = 'openid_from_T9_B'; // 申请人 / 学员
  const oC = 'openid_from_T9_C'; // 第二个申请人 / 非当事方

  mock.stores.users.push(
    { _openid: oA, nickname: '老师A', avatarColor: '#2B62E0', contact: 'wx_teacher_a', goodCount: 0, totalCount: 0 },
    { _openid: oB, nickname: '学员B', avatarColor: '#7A3FE0', contact: 'wx_learner_b', goodCount: 0, totalCount: 0 },
    { _openid: oC, nickname: '同学C', avatarColor: '#1F8A4C', contact: 'wx_student_c', goodCount: 0, totalCount: 0 }
  );

  function req(method, p, body, token) {
    const h = token ? { Authorization: 'Bearer ' + token } : {};
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

  const tokenA = await loginAs('T9_A');
  const tokenB = await loginAs('T9_B');
  const tokenC = await loginAs('T9_C');

  const t0 = Date.now();
  const mkPost = (id, title, tags, ts) => ({
    _id: id, title, type: 'teach', category: '学业辅导', content: title + ' 辅导', tags,
    authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed',
    createTime: ts, updateTime: ts,
  });
  mock.stores.posts.push(
    mkPost('q1', '教高数', ['高数'], t0 - 5000),
    mkPost('q2', '教线代', ['线代'], t0 - 4000),
    mkPost('q3', '教英语', ['英语'], t0 - 3000),
    mkPost('q4', '教吉他', ['吉他'], t0 - 2000),
    mkPost('q5', '教摄影', ['摄影'], t0 - 1000)
  );

  // ================== 取消交换主流程 ==================
  console.log('取消交换 POST /api/exchanges/:id/cancel');

  const cr1 = jsonOf(await req('POST', '/api/exchanges', { postId: 'q1', message: '想学高数' }, tokenB));
  const ex1 = cr1.data._id;
  await req('POST', `/api/exchanges/${ex1}/confirm`, {}, tokenA);

  await t('pending 阶段不能取消（要先由帖主接受）→ 409', async () => {
    const cr0 = jsonOf(await req('POST', '/api/exchanges', { postId: 'q2' }, tokenB));
    const r = await req('POST', `/api/exchanges/${cr0.data._id}/cancel`, {}, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('非当事方取消 → 403', async () => {
    const r = await req('POST', `/api/exchanges/${ex1}/cancel`, {}, tokenC);
    assert.strictEqual(r.statusCode, 403);
  });

  await t('学员 B 先申请取消 → 仍是 active，cancelBy=[B]', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex1}/cancel`, {}, tokenB));
    assert.strictEqual(b.data.status, 'active');
    assert.deepStrictEqual(b.data.cancelBy, [oB]);
  });

  await t('详情：发起方看到 iRequestedCancel，帖主看到 peerRequestedCancel', async () => {
    const mine = jsonOf(await req('GET', `/api/exchanges/${ex1}`, null, tokenB)).data;
    assert.strictEqual(mine.iRequestedCancel, true);
    assert.strictEqual(mine.peerRequestedCancel, false);
    const peer = jsonOf(await req('GET', `/api/exchanges/${ex1}`, null, tokenA)).data;
    assert.strictEqual(peer.iRequestedCancel, false);
    assert.strictEqual(peer.peerRequestedCancel, true);
  });

  await t('同一人重复申请取消 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${ex1}/cancel`, {}, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('帖主 A 也确认取消（第 2 人）→ cancelled', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex1}/cancel`, {}, tokenA));
    assert.strictEqual(b.data.status, 'cancelled');
    assert.deepStrictEqual(b.data.cancelBy.slice().sort(), [oA, oB].sort());
  });

  // ================== cancelled 是终态：跳过评价 ==================
  console.log('cancelled 终态：直接跳过评价');

  await t('已取消 → 不能标记完成 409', async () => {
    const r = await req('POST', `/api/exchanges/${ex1}/complete`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('已取消 → 不能开始 409', async () => {
    const r = await req('POST', `/api/exchanges/${ex1}/start`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('已取消 → 不能评价 409（跳过评价）', async () => {
    const r = await req('POST', `/api/exchanges/${ex1}/evaluate`, { rating: 'satisfied' }, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('已取消 → 不能改约（cancel-start 仅限 active）409', async () => {
    const r = await req('POST', `/api/exchanges/${ex1}/cancel-start`, {}, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('取消后不再互发联系方式（agreed=false / 联系方式为空）', async () => {
    const d = jsonOf(await req('GET', `/api/exchanges/${ex1}`, null, tokenB)).data;
    assert.strictEqual(d.agreed, false);
    assert.strictEqual(d.peerContact, '');
    assert.strictEqual(d.myContact, '');
  });

  await t('取消不占用帖子：busy=false，别人仍可发起', async () => {
    const p = jsonOf(await req('GET', '/api/posts/q1', null, tokenC)).data;
    assert.strictEqual(p.exchangeState.busy, false);
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'q1' }, tokenC));
    assert.strictEqual(b.code, 0, '取消后帖子应重新可申请');
  });

  await t('同一人可在取消后重新申请该帖（cancelled 不参与去重）', async () => {
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'q1', message: '再约一次' }, tokenB));
    assert.strictEqual(b.code, 0);
  });

  // ================== 开始 / 取消互斥 ==================
  console.log('开始与取消互斥：点开始清空取消申请，点取消清空开始申请');

  const cr2 = jsonOf(await req('POST', '/api/exchanges', { postId: 'q3' }, tokenB));
  const ex2 = cr2.data._id;
  await req('POST', `/api/exchanges/${ex2}/confirm`, {}, tokenA);

  await t('学员先点「开始」→ startBy=[B]，仍是 active', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenB));
    assert.strictEqual(b.data.status, 'active');
    assert.deepStrictEqual(b.data.startBy, [oB]);
  });

  await t('帖主改主意要取消 → 清空 startBy，只留 cancelBy=[A]', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/cancel`, {}, tokenA));
    assert.deepStrictEqual(b.data.cancelBy, [oA]);
    const d = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenA)).data;
    assert.strictEqual(d.status, 'active', '单人取消后仍是待开始');
    assert.deepStrictEqual(d.startBy, [], '取消应把双方的开始标记一并清空');
  });

  await t('学员反悔再点「开始」→ 取消申请作废，回到正常待开始', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenB));
    assert.deepStrictEqual(b.data.startBy, [oB]);
    const d = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenA)).data;
    assert.deepStrictEqual(d.cancelBy, [], '点开始应清空取消申请');
  });

  await t('帖主确认开始 → started', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenA));
    assert.strictEqual(b.data.status, 'started');
  });

  await t('已开始 → 不能再取消 409（应走标记完成）', async () => {
    const r = await req('POST', `/api/exchanges/${ex2}/cancel`, {}, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  // ================== 标记完成只在 started ==================
  console.log('标记完成只在 started（双方都确认开始之后）');

  // 这里换用 C（而不是 B）：A 与 B 之间已有一摊进行中（ex2），
  // 按「同一对用户同时只能有一摊进行中」规则，A 与 B 的新一摊无法再开始。
  const cr3 = jsonOf(await req('POST', '/api/exchanges', { postId: 'q4' }, tokenC));
  const ex3 = cr3.data._id;
  await req('POST', `/api/exchanges/${ex3}/confirm`, {}, tokenA);

  await t('待开始阶段「标记完成」→ 409', async () => {
    const r = await req('POST', `/api/exchanges/${ex3}/complete`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('双方都开始后单人完成 → 仍是 started，completedBy=[A]', async () => {
    await req('POST', `/api/exchanges/${ex3}/start`, {}, tokenA);
    await req('POST', `/api/exchanges/${ex3}/start`, {}, tokenC);
    const b = jsonOf(await req('POST', `/api/exchanges/${ex3}/complete`, {}, tokenA));
    assert.strictEqual(b.data.status, 'started');
    assert.deepStrictEqual(b.data.completedBy, [oA]);
  });

  await t('两人都完成 → completed，随后可正常评价', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex3}/complete`, {}, tokenC));
    assert.strictEqual(b.data.status, 'completed');
    const ev = jsonOf(await req('POST', `/api/exchanges/${ex3}/evaluate`, { rating: 'satisfied' }, tokenC));
    assert.strictEqual(ev.data.rating, 'satisfied');
  });

  // ================== 列表下发 ==================
  console.log('列表下发 cancelBy');

  await t('我的交换列表带 status=cancelled 与 cancelBy', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges', null, tokenB)).data.list;
    const c = list.find((x) => x._id === ex1);
    assert.ok(c, '应含已取消的那条');
    assert.strictEqual(c.status, 'cancelled');
    assert.deepStrictEqual(c.cancelBy.slice().sort(), [oA, oB].sort());
    assert.strictEqual(c.iRequestedCancel, true, 'B 也在取消名单里');
  });

  await t('收到的申请列表里 cancelled 同样是终态', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges/received', null, tokenA)).data.list;
    const c = list.find((x) => x._id === ex1);
    assert.ok(c);
    assert.strictEqual(c.status, 'cancelled');
    assert.strictEqual(c.peerRequestedCancel, false, '帖主自己也确认过取消');
  });

  // ================== 沙盒自交换 ==================
  console.log('沙盒自交换（单账号）：一次点击即取消');

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
  mockSb.stores.users.push({ _openid: 'openid_from_SB_A', nickname: '小A', avatarColor: '#2B62E0', goodCount: 0, totalCount: 0 });
  const tokSb = jsonOf(await reqSb('POST', '/api/auth/login', { code: 'SB_A' })).data.token;
  mockSb.stores.posts.push({
    _id: 'sp1', title: '教吉他', type: 'teach', category: '文艺特长', content: '零基础吉他',
    tags: ['吉他'], authorId: 'openid_from_SB_A', authorName: '小A', status: 'passed',
    createTime: Date.now(), updateTime: Date.now(),
  });
  const crS = jsonOf(await reqSb('POST', '/api/exchanges', { postId: 'sp1' }, tokSb));
  const exS = crS.data._id;
  await reqSb('POST', `/api/exchanges/${exS}/confirm`, {}, tokSb);

  await t('沙盒自交换点一次「取消交换」→ 直接 cancelled', async () => {
    const b = jsonOf(await reqSb('POST', `/api/exchanges/${exS}/cancel`, {}, tokSb));
    assert.strictEqual(b.data.status, 'cancelled');
  });

  await t('沙盒已取消也不能评价', async () => {
    const r = await reqSb('POST', `/api/exchanges/${exS}/evaluate`, { rating: 'satisfied' }, tokSb);
    assert.strictEqual(r.statusCode, 409);
  });

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
