/**
 * 切换测试账号（沙盒多账号）冒烟测试
 * 覆盖：
 *   - test-login 仅在 SANDBOX 模式可用（非沙盒 403）
 *   - uid 合法性校验（空 / 非法字符）
 *   - test-login 自动建号并给默认昵称
 *   - 用两个测试账号跑通「真实」多账号交换全链路：
 *     A 发帖 → B 发起 → A 确认 → 双方完成 → 互评 → 对方好评累计
 * 运行：node tests/stage4-sandbox-account.test.js
 */

const assert = require('assert');
const path = require('path');
const { install } = require('./helpers/mock-cloudbase');

const API_DIR = path.resolve(__dirname, '../cloudbase/functions/skillswap-api');

let passed = 0,
  failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.log('  ✗ ' + name + ' → ' + (e && e.stack ? e.stack : e));
    failed++;
  }
}
function clearApiCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.startsWith(API_DIR)) delete require.cache[k];
  });
}
function loadApi() {
  clearApiCache();
  return require(path.join(API_DIR, 'index.js')).main;
}
function jsonOf(res) {
  return JSON.parse(res.body);
}

function makeReq(main) {
  return function req(method, p, body, headers, token) {
    const h = Object.assign({}, headers);
    if (token) h.Authorization = 'Bearer ' + token;
    return main({
      httpMethod: method,
      path: p,
      headers: h,
      queryStringParameters: {},
      body: body == null ? '' : JSON.stringify(body),
      isBase64Encoded: false,
    });
  };
}

(async () => {
  console.log('\n[切换测试账号] 沙盒多账号交换链路 冒烟测试\n');

  // ---------- 区块 A：非沙盒模式禁用 test-login ----------
  console.log('非沙盒模式');
  {
    const mock = install({});
    const main = loadApi();
    const req = makeReq(main);

    await t('非沙盒模式下 POST /api/auth/test-login → 403', async () => {
      const r = await req('POST', '/api/auth/test-login', { uid: 'testA' });
      assert.strictEqual(r.statusCode, 403);
    });
  }

  // ---------- 区块 B：沙盒模式可用 + 完整多账号链路 ----------
  console.log('沙盒模式（多账号交换全链路）');
  const mock = install({ sandbox: true });
  const main = loadApi();
  const req = makeReq(main);

  let tokenA, tokenB;
  await t('test-login 创建 testA 并给默认昵称', async () => {
    const b = jsonOf(await req('POST', '/api/auth/test-login', { uid: 'testA' }, null, null));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.user.openid, 'sandbox:testA');
    assert.strictEqual(b.data.user.nickname, 'testA');
    tokenA = b.data.token;
  });

  await t('test-login 创建 testB', async () => {
    const b = jsonOf(await req('POST', '/api/auth/test-login', { uid: 'testB' }, null, null));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.user.openid, 'sandbox:testB');
    tokenB = b.data.token;
  });

  await t('uid 为空 → 400', async () => {
    const r = await req('POST', '/api/auth/test-login', { uid: '' });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('uid 含非法字符 → 400', async () => {
    const r = await req('POST', '/api/auth/test-login', { uid: 'a b@1' });
    assert.strictEqual(r.statusCode, 400);
  });

  // 预置一篇 testA 发布的 passed 帖
  mock.stores.posts.push({
    _id: 'post_s1',
    title: '教高数',
    type: 'teach',
    category: '学业辅导',
    content: '高数辅导',
    tags: ['高数'],
    authorId: 'sandbox:testA',
    authorName: 'testA',
    authorAvatar: '#2B62E0',
    status: 'passed',
    createTime: Date.now() - 3000,
    updateTime: Date.now() - 3000,
  });

  let exId;
  await t('testB 对 testA 的帖发起申请 → pending', async () => {
    const b = jsonOf(await req('POST', '/api/exchanges', { postId: 'post_s1' }, null, tokenB));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending');
    exId = b.data._id;
  });

  await t('testA（帖主）收到申请，myRole=target', async () => {
    const b = jsonOf(await req('GET', '/api/exchanges/received', null, null, tokenA));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0].myRole, 'target');
  });

  await t('testA 确认 → active', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/confirm`, {}, null, tokenA));
    assert.strictEqual(b.data.status, 'active');
  });

  await t('待开始阶段点「标记完成」→ 409（必须先开始）', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('双方各点一次「开始」→ started', async () => {
    await req('POST', `/api/exchanges/${exId}/start`, {}, null, tokenB);
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/start`, {}, null, tokenA));
    assert.strictEqual(b.data.status, 'started');
  });

  await t('testB（仅一方）点完成 → 仍是 started', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenB));
    assert.strictEqual(b.data.status, 'started');
  });

  await t('testA（另一方）点完成 → completed', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/complete`, {}, null, tokenA));
    assert.strictEqual(b.data.status, 'completed');
  });

  await t('testB（学员）评价满意 → testA 好评+1', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/evaluate`, { satisfied: true }, null, tokenB));
    assert.strictEqual(b.data.rating, 'satisfied');
    assert.strictEqual(b.data.role, 'learner');
    const uA = mock.stores.users.find((u) => u._openid === 'sandbox:testA');
    assert.strictEqual(uA.goodCount, 1);
    assert.strictEqual(uA.totalCount, 1);
  });

  await t('testA（教学者）写评语 → 不计分（testB 统计保持 0）', async () => {
    const b = jsonOf(await req('POST', `/api/exchanges/${exId}/evaluate`, { comment: '学得很快' }, null, tokenA));
    assert.strictEqual(b.data.role, 'teacher');
    assert.strictEqual(b.data.rating, null, '教学者不参与满意/不满意');
    assert.strictEqual(b.data.comment, '学得很快');
    const uB = mock.stores.users.find((u) => u._openid === 'sandbox:testB');
    assert.strictEqual(uB.goodCount || 0, 0, '教学者评语不计分');
    assert.strictEqual(uB.totalCount || 0, 0);
  });

  await t('testB 重复评价 → 409', async () => {
    const r = await req('POST', `/api/exchanges/${exId}/evaluate`, { satisfied: true }, null, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  console.log(`\n切换测试账号测试：${passed} 通过 / ${failed} 失败\n`);
  process.exit(failed ? 1 : 0);
})();
