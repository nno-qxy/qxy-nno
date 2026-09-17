/**
 * 阶段 6 逻辑层冒烟测试：用户公开页 + 评价体系
 * 覆盖：
 *   - GET  /api/users/:openid/profile   脱敏资料 + 在架帖子
 *   - GET  /api/users/:openid/reviews   TA 收到的评价
 *   - POST /api/exchanges/:id/evaluate  三态评分 / 学员计分 / 教学者纯评语 / 非法值
 *   - GET  /api/posts/:id/reviews       帖子评价区 + 好评率统计
 * 运行：node tests/stage6-reviews.test.js
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
  console.log('\n[阶段6] skillswap-api · 用户公开页与评价体系 冒烟测试\n');

  const mock = install({ adminPassHash: 'x' });
  const main = loadApi();

  const oA = 'openid_from_T_USER_A'; // 帖主 / 教学者
  const oB = 'openid_from_T_USER_B'; // 申请人 / 学员
  const oC = 'openid_from_T_USER_C';

  mock.stores.users.push(
    { _openid: oA, nickname: '教学者A', avatarColor: '#2B62E0', grade: '2023级', major: '计算机', tags: ['高数', '线代'], realName: '张三', studentId: '20230001', contact: 'wx_a', goodCount: 0, totalCount: 0, createTime: 1000 },
    { _openid: oB, nickname: '学员B', avatarColor: '#7A3FE0', goodCount: 0, totalCount: 0, createTime: 2000 },
    { _openid: oC, nickname: '路人C', avatarColor: '#1F8A4C', goodCount: 0, totalCount: 0, createTime: 3000 }
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

  const tokenA = await loginAs('T_USER_A');
  const tokenB = await loginAs('T_USER_B');
  const tokenC = await loginAs('T_USER_C');

  const t0 = Date.now();
  mock.stores.posts.push(
    { _id: 'rp1', title: '教高数', type: 'teach', category: '学业辅导', content: '高数辅导', tags: ['高数'], authorId: oA, authorName: '教学者A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 5000, updateTime: t0 - 5000 },
    { _id: 'rp2', title: '教线代', type: 'teach', category: '学业辅导', content: '线代辅导', tags: ['线代'], authorId: oA, authorName: '教学者A', authorAvatar: '#2B62E0', status: 'passed', createTime: t0 - 4000, updateTime: t0 - 4000 },
    { _id: 'rp_hidden', title: '待审的帖', type: 'teach', category: '学业辅导', content: 'x', tags: [], authorId: oA, status: 'pending', createTime: t0 - 3000, updateTime: t0 - 3000 },
    { _id: 'rp_other', title: '别人的帖', type: 'teach', category: '学业辅导', content: 'y', tags: [], authorId: oC, authorName: '路人C', status: 'passed', createTime: t0 - 2000, updateTime: t0 - 2000 }
  );

  // ================= 用户公开页 =================
  console.log('用户公开页 GET /api/users/:openid/profile');

  await t('返回脱敏资料 + 仅 status=passed 的帖子（按时间倒序）', async () => {
    const b = jsonOf(await req('GET', `/api/users/${oA}/profile`, null, tokenB));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.user.nickname, '教学者A');
    assert.strictEqual(b.data.user.grade, '2023级');
    assert.deepStrictEqual(b.data.user.tags, ['高数', '线代']);
    assert.strictEqual(b.data.user.realName, undefined, '不得下发真实姓名');
    assert.strictEqual(b.data.user.studentId, undefined, '不得下发学号');
    assert.strictEqual(b.data.user.contact, undefined, '不得下发联系方式');
    const ids = b.data.posts.map((p) => p._id);
    assert.deepStrictEqual(ids, ['rp2', 'rp1'], '只含 passed 且按时间倒序');
  });

  await t('不存在的用户 → 404', async () => {
    const r = await req('GET', '/api/users/no_such_user/profile', null, tokenB);
    assert.strictEqual(r.statusCode, 404);
  });

  // ================= 完成一次交换（A 教 B） =================
  const cr = jsonOf(await req('POST', '/api/exchanges', { postId: 'rp1', message: '想学高数' }, tokenB));
  const exId = cr.data._id;
  await req('POST', `/api/exchanges/${exId}/confirm`, {}, tokenA);
  // 先双方各点一次「开始」→ started，之后才能标记完成（新规则）
  await req('POST', `/api/exchanges/${exId}/start`, {}, tokenA);
  await req('POST', `/api/exchanges/${exId}/start`, {}, tokenB);
  await req('POST', `/api/exchanges/${exId}/complete`, {}, tokenA);
  await req('POST', `/api/exchanges/${exId}/complete`, {}, tokenB);

  console.log('评价：学员三态 + 教学者纯评语');

  await t('学员 B 提交「满意 + 评语」→ A 好评 +1', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/evaluate`, { rating: 'satisfied', comment: '讲得很清楚' }, tokenB));
    assert.strictEqual(b.data.role, 'learner');
    assert.strictEqual(b.data.rating, 'satisfied');
    assert.strictEqual(b.data.comment, '讲得很清楚');
    const a = mock.stores.users.find((u) => u._openid === oA);
    assert.strictEqual(a.goodCount, 1);
    assert.strictEqual(a.totalCount, 1);
  });

  await t('教学者 A 提交评语（带 rating 也被忽略）→ 不计分', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/evaluate`, { rating: 'satisfied', comment: '学得很快' }, tokenA));
    assert.strictEqual(b.data.role, 'teacher');
    assert.strictEqual(b.data.rating, null, '教学者不参与满意/不满意');
    assert.strictEqual(b.data.comment, '学得很快');
    const bu = mock.stores.users.find((u) => u._openid === oB);
    assert.strictEqual(bu.totalCount || 0, 0, '教学者评语不计入对方评价数');
  });

  await t('非法 rating → 400', async () => {
    const c2 = jsonOf(await req('POST', '/api/exchanges', { postId: 'rp2' }, tokenB));
    const id2 = c2.data._id;
    await req('POST', `/api/exchanges/${id2}/confirm`, {}, tokenA);
    await req('POST', `/api/exchanges/${id2}/start`, {}, tokenA);
    await req('POST', `/api/exchanges/${id2}/start`, {}, tokenB);
    await req('POST', `/api/exchanges/${id2}/complete`, {}, tokenA);
    await req('POST', `/api/exchanges/${id2}/complete`, {}, tokenB);
    const r = await req('POST', `/api/exchanges/${id2}/evaluate`, { rating: 'meh' }, tokenB);
    assert.strictEqual(r.statusCode, 400);
  });

  await t('学员选「暂不评价」（rating=none）→ 不进入好评率分母', async () => {
    // 换一条 B 尚未申请过的帖（rp_other 属 C，B 来学）
    const c4 = jsonOf(await req('POST', '/api/exchanges', { postId: 'rp_other' }, tokenB));
    const id4 = c4.data._id;
    await req('POST', `/api/exchanges/${id4}/confirm`, {}, tokenC);
    await req('POST', `/api/exchanges/${id4}/start`, {}, tokenC);
    await req('POST', `/api/exchanges/${id4}/start`, {}, tokenB);
    await req('POST', `/api/exchanges/${id4}/complete`, {}, tokenC);
    await req('POST', `/api/exchanges/${id4}/complete`, {}, tokenB);
    const before = mock.stores.users.find((u) => u._openid === oC).totalCount || 0;
    const b = jsonOf(await req('POST', `/api/exchanges/${id4}/evaluate`, { rating: 'none' }, tokenB));
    assert.strictEqual(b.data.rating, 'none');
    const after = mock.stores.users.find((u) => u._openid === oC).totalCount || 0;
    assert.strictEqual(after, before, '暂不评价不改变对方评价数');
  });

  // ================= 帖子评价区 =================
  console.log('帖子评价区 GET /api/posts/:id/reviews');

  await t('聚合该帖评价（学员评分 + 教学者评语）+ 好评率统计', async () => {
    const b = jsonOf(await req('GET', '/api/posts/rp1/reviews', null, tokenB));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.list.length, 2, '学员评价 + 教学者评语');
    assert.strictEqual(b.data.summary.satisfied, 1);
    assert.strictEqual(b.data.summary.dissatisfied, 0);
    assert.strictEqual(b.data.summary.goodRate, 100);
    const learner = b.data.list.find((x) => x.role === 'learner');
    assert.strictEqual(learner.rating, 'satisfied');
    assert.strictEqual(learner.comment, '讲得很清楚');
    assert.strictEqual(learner.evaluatorName, '学员B');
    const teacher = b.data.list.find((x) => x.role === 'teacher');
    assert.strictEqual(teacher.rating, null);
    assert.strictEqual(teacher.comment, '学得很快');
  });

  await t('新增的 /:id/reviews 不影响 /api/posts/:id 详情', async () => {
    const b = jsonOf(await req('GET', '/api/posts/rp1', null, tokenB));
    assert.strictEqual(b.data._id, 'rp1');
  });

  // ================= 用户收到的评价 =================
  console.log('用户收到的评价 GET /api/users/:openid/reviews');

  await t('A 收到的评价 = 学员那条（不含自己给别人的评语）', async () => {
    const b = jsonOf(await req('GET', `/api/users/${oA}/reviews`, null, tokenB));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0].evaluatorName, '学员B');
    assert.strictEqual(b.data.list[0].rating, 'satisfied');
    assert.strictEqual(b.data.summary.goodRate, 100);
  });

  await t('B 收到的评价 = 教学者的评语（无评分）', async () => {
    const b = jsonOf(await req('GET', `/api/users/${oB}/reviews`, null, tokenA));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0].comment, '学得很快');
    assert.strictEqual(b.data.list[0].rating, null);
  });

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
