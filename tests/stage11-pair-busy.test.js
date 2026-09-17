/**
 * 阶段 11 逻辑层冒烟测试：同一对用户「同时只能有一摊进行中」
 *
 * 背景（2026-09-15 线上 bug）：测试号 testB 申请了同一个人（testA）的两门课（两条帖），
 * 两条都先被确认成待开始，然后各自点开始，结果**两摊都进入了进行中**，
 * 「我的交换」里对同一个人出现两张「进行中」卡片，都能点标记完成。
 *
 * 根因：原来的单摊约束只按「帖子」维度（lib/exchangeState.of → postId + started），
 * 两条帖是两个不同的 postId，因此互不拦截。
 *
 * 修复：新增「用户对」维度（lib/exchangeState.pairBusy / busyPairMap，键为 pairKey），
 * 同一对用户之间同时只允许一摊 started：
 *   - confirm（pending → active）：两人之间已有进行中 → 409
 *   - start（active → started）  ：两人之间已有进行中 → 409
 *   - 列表 / 详情下发 peerBusy，前端置灰「同意交换 / 开始」并给说明文案
 * 边界：
 *   - active（待开始）不占用 —— 同一对用户可以先有多条待开始，先后开始由单摊约束控制
 *   - 只约束「同一对」：甲与乙进行中时，甲与丙、乙与丁照常
 *   - 沙盒自交换（applicantId === targetId）不参与该约束，否则单账号没法验两条自交换
 *
 * 运行：node tests/stage11-pair-busy.test.js
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
  console.log('\n[阶段11] skillswap-api · 同一对用户同时只能有一摊进行中\n');

  const mock = install({ adminPassHash: 'x' });
  const main = loadApi();

  const oA = 'openid_from_T11_A'; // 帖主 / 教学者（相当于线上 testA）
  const oB = 'openid_from_T11_B'; // 申请人 / 学员（相当于线上 testB）
  const oC = 'openid_from_T11_C'; // 另一位申请人

  mock.stores.users.push(
    { _openid: oA, nickname: '老师A', avatarColor: '#2B62E0', contact: 'wx_a', goodCount: 0, totalCount: 0 },
    { _openid: oB, nickname: '学员B', avatarColor: '#7A3FE0', contact: 'wx_b', goodCount: 0, totalCount: 0 },
    { _openid: oC, nickname: '同学C', avatarColor: '#1F8A4C', contact: 'wx_c', goodCount: 0, totalCount: 0 }
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

  const tokenA = await loginAs('T11_A');
  const tokenB = await loginAs('T11_B');
  const tokenC = await loginAs('T11_C');

  const t0 = Date.now();
  mock.stores.posts.push(
    { _id: 'p1', title: 'java全能', type: 'teach', category: '数码技能', content: 'java', tags: ['java'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 5000, updateTime: t0 - 5000 },
    { _id: 'p2', title: '111111111', type: 'teach', category: '数码技能', content: 'xx', tags: ['java'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 4000, updateTime: t0 - 4000 },
    { _id: 'p3', title: '教高数', type: 'teach', category: '学业辅导', content: '高数', tags: ['高数'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 3000, updateTime: t0 - 3000 },
    { _id: 'p4', title: '教线代', type: 'teach', category: '学业辅导', content: '线代', tags: ['线代'], authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 2000, updateTime: t0 - 2000 }
  );

  // ============ 复现线上场景：同一人对同一位帖主的两门课各申请一次 ============
  console.log('复现：同一人申请同一位帖主的两门课');

  const ex1 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p1', message: '想学 java' }, tokenB)).data._id;
  const ex2 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p2', message: '也想学这个' }, tokenB)).data._id;
  assert.ok(ex1 && ex2, '两条申请都应创建成功');

  await t('帖主可以确认第一条申请 → active', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex1}/confirm`, {}, tokenA));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('帖主也可以确认第二条申请 → active（待开始阶段不互相占用）', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex2}/confirm`, {}, tokenA));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('双方把第一条点成进行中（started）', async () => {
    await req('POST', `/api/exchanges/${ex1}/start`, {}, tokenB);
    const b = jsonOf(await req('POST', `/api/exchanges/${ex1}/start`, {}, tokenA));
    assert.strictEqual(b.data.status, 'started');
  });

  // ============ 核心断言：第二摊必须被拦住 ============
  console.log('核心：同一对用户的第二摊不能再进入进行中');

  await t('帖主开始第二条 → 409（你和 TA 之间已有进行中的交换）', async () => {
    const r = await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409, '应拦住第二摊');
    assert.ok(/你和 TA/.test(jsonOf(r).msg), '提示应说明是同一对人：' + jsonOf(r).msg);
  });

  await t('学员开始第二条 → 409（申请人侧同样拦住）', async () => {
    const r = await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenB);
    assert.strictEqual(r.statusCode, 409);
    assert.ok(/你和 TA/.test(jsonOf(r).msg));
  });

  await t('第二条仍停在 active，没有被写成 started', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenB)).data;
    assert.strictEqual(b.status, 'active');
    assert.ok(!(b.startBy || []).length, 'startBy 不应被写入');
  });

  await t('详情下发 peerBusy=true（帖主侧）', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenA)).data;
    assert.strictEqual(b.peerBusy, true, '同一对用户已有进行中');
    assert.strictEqual(b.postBusy, false, 'p2 本身没有被进行中占用，不是帖子维度的原因');
  });

  await t('详情下发 peerBusy=true（申请人侧）', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenB)).data;
    assert.strictEqual(b.peerBusy, true);
  });

  await t('已进行中的那条自己不算 peerBusy（否则卡片会自我禁用）', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${ex1}`, null, tokenA)).data;
    assert.strictEqual(b.status, 'started');
    assert.strictEqual(b.peerBusy, false);
  });

  await t('交换列表（收到的申请）里第二条带 peerBusy，供前端置灰按钮', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges/received', null, tokenA)).data.list;
    const row = list.filter((e) => e._id === ex2)[0];
    assert.ok(row, '应能在列表里找到第二条');
    assert.strictEqual(row.peerBusy, true);
  });

  await t('「我的交换」列表里：进行中那条不带 peerBusy，待开始那条带', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges', null, tokenB)).data.list;
    const row1 = list.filter((e) => e._id === ex1)[0];
    const row2 = list.filter((e) => e._id === ex2)[0];
    assert.ok(row1 && row2, '两条都应在我的交换里');
    assert.strictEqual(row1.peerBusy, false, '进行中这条不应自我置灰');
    assert.strictEqual(row2.peerBusy, true, '待开始这条应置灰');
  });

  // ============ 结束一摊后自动释放 ============
  console.log('释放：这一摊结束后，同一对的另一摊恢复正常');

  await t('双方标记完成 → completed', async () => {
    await req('POST', `/api/exchanges/${ex1}/complete`, {}, tokenA);
    const b = jsonOf(await req('POST', `/api/exchanges/${ex1}/complete`, {}, tokenB));
    assert.strictEqual(b.data.status, 'completed');
  });

  await t('第一条结束后，第二条的 peerBusy 变回 false', async () => {
    const b = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenA)).data;
    assert.strictEqual(b.peerBusy, false);
  });

  await t('第二条现在可以正常开始 → started', async () => {
    const b1 = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenB));
    assert.strictEqual(b1.data.status, 'active');
    const b2 = jsonOf(await req('POST', `/api/exchanges/${ex2}/start`, {}, tokenA));
    assert.strictEqual(b2.data.status, 'started');
  });

  // ============ 只约束「同一对」，不约束「同一个人」 ============
  console.log('边界：只约束同一对用户，不影响其他人的交换');

  const ex3 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p3' }, tokenC)).data._id;

  await t('同一帖主仍可与另一位同学确认新申请（另一对，不拦）', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${ex3}/confirm`, {}, tokenA));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('同一帖主仍可与另一位同学开始 → started（帖主可并行两摊）', async () => {
    await req('POST', `/api/exchanges/${ex3}/start`, {}, tokenC);
    const b = jsonOf(await req('POST', `/api/exchanges/${ex3}/start`, {}, tokenA));
    assert.strictEqual(b.data.status, 'started');
    // 此时 A 同时与 B、C 各有一摊进行中，证明维度是「用户对」而不是「用户」
    const asB = jsonOf(await req('GET', `/api/exchanges/${ex2}`, null, tokenB)).data;
    const asC = jsonOf(await req('GET', `/api/exchanges/${ex3}`, null, tokenC)).data;
    assert.strictEqual(asB.status, 'started');
    assert.strictEqual(asC.status, 'started');
  });

  const cr4 = jsonOf(await req('POST', '/api/exchanges', { postId: 'p4' }, tokenB));

  await t('已有一摊进行中时，同一对的新申请不能再被确认 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${cr4.data._id}/confirm`, {}, tokenA);
    assert.strictEqual(r.statusCode, 409);
    assert.ok(/你和 TA/.test(jsonOf(r).msg));
  });

  await t('新申请本身仍可提交（pending 不受限，避免用户申请入口被封死）', async () => {
    assert.strictEqual(cr4.code, 0);
    assert.strictEqual(cr4.data.status, 'pending');
  });

  // ============ 沙盒自交换不受该约束 ============
  console.log('边界：沙盒自交换（applicantId === targetId）不参与用户对约束');

  process.env.SANDBOX_MODE = 'true';
  const main2 = loadApi();
  function req2(method, p, body, token) {
    const h = token ? { Authorization: 'Bearer ' + token } : {};
    return main2({
      httpMethod: method, path: p, headers: h,
      queryStringParameters: {}, body: body == null ? '' : JSON.stringify(body),
      isBase64Encoded: false,
    });
  }
  mock.stores.posts.push(
    { _id: 's1', title: '自测帖1', type: 'teach', category: '数码技能', content: 'x', tags: ['x'], authorId: oC, authorName: '同学C', authorAvatar: '#1F8A4C', status: 'passed', createTime: t0, updateTime: t0 },
    { _id: 's2', title: '自测帖2', type: 'teach', category: '数码技能', content: 'y', tags: ['y'], authorId: oC, authorName: '同学C', authorAvatar: '#1F8A4C', status: 'passed', createTime: t0, updateTime: t0 }
  );

  await t('同一账号的两条自交换都能走通 confirm → start（不被用户对约束挡住）', async () => {
    let n = 0;
    for (const pid of ['s1', 's2']) {
      const c = jsonOf(await req2('POST', '/api/exchanges', { postId: pid }, tokenC));
      assert.strictEqual(c.code, 0, pid + ' 应能创建自交换申请');
      const cf = jsonOf(await req2('POST', `/api/exchanges/${c.data._id}/confirm`, {}, tokenC));
      assert.strictEqual(cf.data.status, 'active', pid + ' 应能确认');
      const st = jsonOf(await req2('POST', `/api/exchanges/${c.data._id}/start`, {}, tokenC));
      assert.strictEqual(st.data.status, 'started', pid + ' 自交换应一次点击即开始');
      n++;
    }
    assert.strictEqual(n, 2);
  });

  delete process.env.SANDBOX_MODE;

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
