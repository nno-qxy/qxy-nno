/**
 * 阶段 7 逻辑层冒烟测试：开始协作（Z-14）+ 联系方式可见性 + 帖子占用规则
 * 覆盖：
 *   - POST /api/exchanges/:id/start         双方各点一次 → started；越权 / 状态 / 重复
 *   - POST /api/exchanges/:id/cancel-start  临时有事 / 再约时间 → 留取消留言并回到待开始
 *   - 联系方式：仅 active/started/completed 互相可见，pending 不下发
 *   - 帖子占用（2026-09-14 修订）：
 *       · 待开始(active) 不锁帖：其他人随时可发起，帖主随时可确认
 *       · 只有进行中(started) 限制：帖主不能确认新申请；同帖其它待开始也不能开始
 *       · 进行中的交换结束后帖子自然恢复
 *   - complete 在 started 下单人点击不会退回 active
 * 运行：node tests/stage7-exchange-start.test.js
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
  console.log('\n[阶段7] skillswap-api · 开始协作 / 联系方式 / 帖子占用 冒烟测试\n');

  const mock = install({ adminPassHash: 'x' });
  const main = loadApi();

  const oA = 'openid_from_T7_A'; // 帖主 / 教学者
  const oB = 'openid_from_T7_B'; // 申请人 / 学员
  const oC = 'openid_from_T7_C'; // 第二个申请人
  const oD = 'openid_from_T7_D'; // 第三个申请人

  mock.stores.users.push(
    { _openid: oA, nickname: '老师A', avatarColor: '#2B62E0', contact: 'wx_teacher_a', goodCount: 0, totalCount: 0 },
    { _openid: oB, nickname: '学员B', avatarColor: '#7A3FE0', contact: 'wx_learner_b', goodCount: 0, totalCount: 0 },
    { _openid: oC, nickname: '同学C', avatarColor: '#1F8A4C', contact: 'wx_student_c', goodCount: 0, totalCount: 0 },
    { _openid: oD, nickname: '同学D', avatarColor: '#C2410C', contact: 'wx_student_d', goodCount: 0, totalCount: 0 }
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

  const tokenA = await loginAs('T7_A');
  const tokenB = await loginAs('T7_B');
  const tokenC = await loginAs('T7_C');
  const tokenD = await loginAs('T7_D');

  const t0 = Date.now();
  mock.stores.posts.push(
    { _id: 'p1', title: '教高数', type: 'teach', category: '学业辅导', content: '高数辅导', tags: ['高数'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 5000, updateTime: t0 - 5000 },
    { _id: 'p2', title: '教线代', type: 'teach', category: '学业辅导', content: '线代辅导', tags: ['线代'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 4000, updateTime: t0 - 4000 },
    { _id: 'p3', title: '教英语', type: 'teach', category: '语言交流', content: '英语口语', tags: ['英语'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 3000, updateTime: t0 - 3000 },
    { _id: 'p4', title: '教吉他', type: 'teach', category: '文艺特长', content: '零基础吉他', tags: ['吉他'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 2000, updateTime: t0 - 2000 }
  );

  // ================= 联系方式可见性 =================
  console.log('联系方式：仅交换达成后互相可见');

  const cr = jsonOf(await req('POST', '/api/exchanges', { postId: 'p1', message: '想学高数' }, tokenB));
  const exId = cr.data._id;

  await t('申请阶段（pending）双方都看不到对方联系方式', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${exId}`, null, tokenB));
    assert.strictEqual(b.data.agreed, false, 'pending 不算达成');
    assert.strictEqual(b.data.peerContact, '', '不能下发对方联系方式');
    assert.strictEqual(b.data.myContact, '', '也不能下发自己的');
  });

  await req('POST', `/api/exchanges/${exId}/confirm`, {}, tokenA);

  await t('帖主确认后（active）双方互见联系方式', async () => {
    const asB = jsonOf(await req('GET', `/api/exchanges/${exId}`, null, tokenB)).data;
    assert.strictEqual(asB.agreed, true);
    assert.strictEqual(asB.peerContact, 'wx_teacher_a', '学员应看到教学者联系方式');
    assert.strictEqual(asB.myContact, 'wx_learner_b');
    const asA = jsonOf(await req('GET', `/api/exchanges/${exId}`, null, tokenA)).data;
    assert.strictEqual(asA.peerContact, 'wx_learner_b', '教学者应看到学员联系方式');
  });

  await t('非当事方查看交换详情 → 403（联系方式不泄漏）', async () => {
    const r = await req('GET', `/api/exchanges/${exId}`, null, tokenC);
    assert.strictEqual(r.statusCode, 403);
  });

  // ================= 帖子占用：待开始不锁帖 =================
  console.log('帖子占用：待开始不锁帖 / 帖主随时可确认');

  await t('已有 active 时，其他人仍可发起申请（不锁帖）', async () => {
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'p1' }, tokenC));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending');
  });

  await t('详情接口 exchangeState.busy=false（未被进行中占用）', async () => {
    const b = jsonOf(await req('GET', '/api/posts/p1', null, tokenC));
    assert.strictEqual(b.data.exchangeState.busy, false);
  });

  let exC;
  await t('帖主可以随时确认新的申请 → active', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges/received', null, tokenA)).data.list;
    const pend = list.find((e) => e.status === 'pending' && e.postId === 'p1');
    assert.ok(pend, '应能找到 C 的待确认申请');
    assert.strictEqual(pend.postBusy, false, '无进行中交换时不应标记 postBusy');
    const b = jsonOf(await req('POST', `/api/exchanges/${pend._id}/confirm`, {}, tokenA));
    assert.strictEqual(b.data.status, 'active');
    exC = pend._id;
  });

  // ================= 开始协作 =================
  console.log('开始协作 POST /api/exchanges/:id/start');

  await t('pending 状态不能开始 → 409', async () => {
    const c2 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p3' }, tokenB));
    const r = await req('POST', `/api/exchanges/${c2.data._id}/start`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('非当事方开始 → 403', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/start`, {}, tokenC);
    assert.strictEqual(r.statusCode, 403);
  });

  await t('学员先点「申请开始」→ 仍 active，startBy=[B]', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/start`, {}, tokenB));
    assert.strictEqual(b.data.status, 'active');
    assert.deepStrictEqual(b.data.startBy, [oB]);
  });

  await t('教学者侧能看到对方已申请开始（iAgreedStart=false, startBy 含对方）', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${exId}`, null, tokenA)).data;
    assert.strictEqual(b.iAgreedStart, false);
    assert.deepStrictEqual(b.startBy, [oB]);
  });

  await t('同一人重复点开始 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/start`, {}, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('教学者点「确认开始」→ status=started（双方齐全）', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/start`, {}, tokenA));
    assert.strictEqual(b.data.status, 'started');
    assert.deepStrictEqual(b.data.startBy.sort(), [oA, oB].sort());
  });

  await t('已 started 再点开始 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/start`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  // ================= 进行中：帖子重新开放申请，但不能再开新的一摊 =================
  console.log('进行中：申请照常 / 帖主暂不能确认 / 同帖第二摊不能开始');

  await t('双方已开始 → 其他人依然可以发起申请', async () => {
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'p1' }, tokenD));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending');
  });

  await t('详情 busy=true（该帖被进行中占用）', async () => {
    const b = jsonOf(await req('GET', '/api/posts/p1', null, tokenC));
    assert.strictEqual(b.data.exchangeState.busy, true);
  });

  await t('进行中 → 帖主不能确认新的申请 409', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges/received', null, tokenA)).data.list;
    const pend = list.find((e) => e.status === 'pending' && e.postId === 'p1');
    assert.ok(pend, '应能找到 D 的待确认申请');
    assert.strictEqual(pend.postBusy, true, '列表应下发 postBusy 供前端禁用按钮');
    const r = await req('POST', `/api/exchanges/${pend._id}/confirm`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('同帖已有进行中 → 另一条待开始也不能开始 409', async () => {
    const r = await req('POST', `/api/exchanges/${exC}/start`, {}, tokenC);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('进行中单人点完成 → 仍是 started（不会退回待开始）', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/complete`, {}, tokenA));
    assert.strictEqual(b.data.status, 'started');
    assert.deepStrictEqual(b.data.completedBy, [oA]);
  });

  await t('另一方点完成 → completed，帖子彻底释放', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/complete`, {}, tokenB));
    assert.strictEqual(b.data.status, 'completed');
    const p = jsonOf(await req('GET', '/api/posts/p1', null, tokenC)).data;
    assert.strictEqual(p.exchangeState.busy, false, '结束后不再占用帖子');
  });

  await t('结束后：帖主又能确认新申请 → active', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges/received', null, tokenA)).data.list;
    const pend = list.find((e) => e.status === 'pending' && e.postId === 'p1');
    const b = jsonOf(await req('POST', `/api/exchanges/${pend._id}/confirm`, {}, tokenA));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('结束后：另一条待开始也能正常开始 → started', async () => {
    const b1 = jsonOf(await req('POST', `/api/exchanges/${exC}/start`, {}, tokenC));
    assert.strictEqual(b1.data.status, 'active');
    const b2 = jsonOf(await req('POST', `/api/exchanges/${exC}/start`, {}, tokenA));
    assert.strictEqual(b2.data.status, 'started');
  });

  // ================= 取消留言 =================
  // 注意：此处换用 D（而不是 C）—— A 与 C 之间已有一摊进行中（exC），
  // 按「同一对用户同时只能有一摊进行中」规则，A 已不能再确认 C 的新申请。
  console.log('取消留言 POST /api/exchanges/:id/cancel-start');

  const cr2 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p2' }, tokenD));
  const ex2 = cr2.data._id;
  await req('POST', `/api/exchanges/${ex2}/confirm`, {}, tokenA);

  await t('教学者先点开始 → startBy=[A]', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenA));
    assert.deepStrictEqual(b.data.startBy, [oA]);
  });

  await t('学员「临时有事」→ 撤回开始并留下留言', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/cancel-start`, { text: '这周有考试，下周再约' }, tokenD));
    assert.strictEqual(b.data.status, 'active');
    assert.deepStrictEqual(b.data.startBy, [], '开始表态被撤回');
    const last = b.data.cancelNotes[b.data.cancelNotes.length - 1];
    assert.strictEqual(last.openid, oD);
    assert.strictEqual(last.text, '这周有考试，下周再约');
  });

  await t('教学者侧能读到对方的取消留言', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenA)).data;
    assert.ok(b.peerCancelNote, '应有对方留言');
    assert.strictEqual(b.peerCancelNote.text, '这周有考试，下周再约');
  });

  await t('留空 → 使用默认话术', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/cancel-start`, {}, tokenD));
    const last = b.data.cancelNotes[b.data.cancelNotes.length - 1];
    assert.ok(last.text.length > 0, '默认话术不应为空');
  });

  await t('撤回后双方可以再次开始', async () => {
    const b1 = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenD));
    assert.strictEqual(b1.data.status, 'active');
    const b2 = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenA));
    assert.strictEqual(b2.data.status, 'started');
  });

  await t('已 started 不能改约 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${ex2}/cancel-start`, {}, tokenD);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('非当事方改约 → 403', async () => {
    // p4 尚未被申请过，C 申请后由 B（第三方）尝试改约
    const cr3 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p4' }, tokenC));
    assert.strictEqual(cr3.code, 0);
    const r = await req('POST', `/api/exchanges/${cr3.data._id}/cancel-start`, {}, tokenB);
    assert.strictEqual(r.statusCode, 403);
  });

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
