/**
 * 阶段 10 逻辑层冒烟测试：交换结束后的「再次申请」
 *
 * 背景（线上真实缺陷）：
 *   exchanges 集合上曾建有 postId + applicantId 的**唯一索引**，而 create() 的去重判断
 *   是「只查 limit(1) 那一条，再在内存里看它是不是 pending/active/started」。
 *   于是交换 completed 之后再申请同一帖时：
 *     · 去重判断放行（查到的第一条正好是已结束的旧记录）→
 *     · 插入被唯一索引顶掉 → 整屏弹出 E11000 duplicate key 原始报错。
 *
 * 修订后的规则：
 *   - 同一对 (postId, applicantId) 同时只允许一笔「未结束」的交换（pending/active/started）→ 重复发起 409；
 *   - completed / cancelled / rejected 之后可以再次申请同一帖，生成新记录，旧记录保留作历史；
 *   - 去重判断的 status 条件必须下推到数据库查询（同一对可能有多条历史记录）。
 *   - 数据库侧 postId+applicantId 必须是**普通**复合索引，不能是唯一索引；
 *     真被唯一索引拦下时，后端也要把 E11000 兜底成可读的 409，不能把原始堆栈抛给用户。
 *
 * 运行：node tests/stage10-reapply.test.js
 */

const assert = require('assert');
const fs = require('fs');
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
  console.log('\n[阶段10] skillswap-api · 交换结束后再次申请 冒烟测试\n');

  const mock = install({ adminPassHash: 'x' });
  const main = loadApi();

  const oA = 'openid_from_T10_A'; // 帖主
  const oB = 'openid_from_T10_B'; // 申请人
  const oC = 'openid_from_T10_C'; // 另一个申请人

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

  const tokenA = await loginAs('T10_A');
  const tokenB = await loginAs('T10_B');
  const tokenC = await loginAs('T10_C');

  const t0 = Date.now();
  const mkPost = (id, title, tag, ts) => ({
    _id: id, title, type: 'teach', category: '学业辅导', content: title, tags: [tag],
    authorId: oA, authorName: '老师A', authorAvatar: '#2B62E0', status: 'passed',
    createTime: ts, updateTime: ts,
  });
  mock.stores.posts.push(
    mkPost('r1', '教高数', '高数', t0 - 9000), // 正常走完成
    mkPost('r2', '教线代', '线代', t0 - 8000), // 走取消
    mkPost('r3', '教英语', '英语', t0 - 7000), // 走拒绝
    mkPost('r4', '教吉他', '吉他', t0 - 6000), // 挂着一笔 pending
    mkPost('r5', '教摄影', '摄影', t0 - 5000), // 多人分别申请
    mkPost('r6', '教绘画', '绘画', t0 - 4000)  // 完成 → 再次申请 → 再完成
  );

  /** 造一笔走到指定终态的交换：返回 exchangeId */
  async function makeExchange(postId, token, target = 'completed') {
    const cr = jsonOf(await req('POST', '/api/exchanges', { postId }, token));
    assert.strictEqual(cr.code, 0, '造数：发起申请应成功');
    const id = cr.data._id;
    if (target === 'pending') return id;
    if (target === 'rejected') {
      // 注意：reject 只允许在 pending 阶段做（decide 会校验 status），先 confirm 反而做不成
      const r = jsonOf(await req('POST', `/api/exchanges/${id}/reject`, {}, tokenA));
      assert.strictEqual(r.data.status, 'rejected', '造数：应进入 rejected');
      return id;
    }
    await req('POST', `/api/exchanges/${id}/confirm`, {}, tokenA);
    if (target === 'active') return id;
    if (target === 'cancelled') {
      await req('POST', `/api/exchanges/${id}/cancel`, {}, token);
      const r = jsonOf(await req('POST', `/api/exchanges/${id}/cancel`, {}, tokenA));
      assert.strictEqual(r.data.status, 'cancelled', '造数：应进入 cancelled');
      return id;
    }
    // completed：双方开始 + 双方标记完成
    await req('POST', `/api/exchanges/${id}/start`, {}, token);
    await req('POST', `/api/exchanges/${id}/start`, {}, tokenA);
    await req('POST', `/api/exchanges/${id}/complete`, {}, token);
    const done = jsonOf(await req('POST', `/api/exchanges/${id}/complete`, {}, tokenA));
    assert.strictEqual(done.data.status, 'completed', '造数：应进入 completed');
    return id;
  }

  // ================== 进行中的申请仍然拦截 ==================
  console.log('未结束的申请仍然 409');

  const pendId = await makeExchange('r4', tokenB, 'pending');

  await t('pending 中重复申请同一帖 → 409', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'r4' }, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('其他人申请同一帖不受影响 → 200', async () => {
    const r = await req('POST', '/api/exchanges', { postId: 'r4' }, tokenC);
    assert.strictEqual(r.statusCode, 200);
  });

  await t('active 中重复申请同一帖 → 409', async () => {
    const id = await makeExchange('r5', tokenB, 'active');
    assert.ok(id);
    const r = await req('POST', '/api/exchanges', { postId: 'r5' }, tokenB);
    assert.strictEqual(r.statusCode, 409);
  });

  await t('started 中重复申请同一帖 → 409', async () => {
    const cr = jsonOf(await req('POST', '/api/exchanges', { postId: 'r6' }, tokenB));
    const id = cr.data._id;
    await req('POST', `/api/exchanges/${id}/confirm`, {}, tokenA);
    await req('POST', `/api/exchanges/${id}/start`, {}, tokenB);
    const r = await req('POST', '/api/exchanges', { postId: 'r6' }, tokenB);
    assert.strictEqual(r.statusCode, 409);
    // 收尾：补齐开始 + 完成，留给后面「完成后再申请」用
    await req('POST', `/api/exchanges/${id}/start`, {}, tokenA);
    await req('POST', `/api/exchanges/${id}/complete`, {}, tokenB);
    await req('POST', `/api/exchanges/${id}/complete`, {}, tokenA);
    const d = jsonOf(await req('GET', `/api/exchanges/${id}`, null, tokenB));
    assert.strictEqual(d.data.status, 'completed');
  });

  // ================== 终态之后可以再次申请 ==================
  console.log('\n终态之后再次申请');

  await t('completed 后再申请同一帖 → 200，且生成新记录', async () => {
    const before = jsonOf(await req('GET', '/api/exchanges', null, tokenB)).data.list
      .filter((e) => e.postId === 'r6');
    const r = await req('POST', '/api/exchanges', { postId: 'r6', message: '再约一次' }, tokenB);
    assert.strictEqual(r.statusCode, 200, '不应再被唯一索引/去重拦住');
    const b = jsonOf(r);
    assert.strictEqual(b.data.status, 'pending');
    const after = jsonOf(await req('GET', '/api/exchanges', null, tokenB)).data.list
      .filter((e) => e.postId === 'r6');
    assert.strictEqual(after.length, before.length + 1, '旧记录要保留，不能覆盖');
    assert.ok(after.some((e) => e._id === b.data._id), '新记录应在列表里');
    assert.ok(after.some((e) => e.status === 'completed'), '已完成的历史记录仍在');
  });

  await t('cancelled 后再申请同一帖 → 200', async () => {
    const oldId = await makeExchange('r2', tokenB, 'cancelled');
    const d = jsonOf(await req('GET', `/api/exchanges/${oldId}`, null, tokenB));
    assert.strictEqual(d.data.status, 'cancelled');
    const r = await req('POST', '/api/exchanges', { postId: 'r2' }, tokenB);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(jsonOf(r).data.status, 'pending');
  });

  await t('rejected 后再申请同一帖 → 200', async () => {
    await makeExchange('r3', tokenB, 'rejected');
    const r = await req('POST', '/api/exchanges', { postId: 'r3' }, tokenB);
    assert.strictEqual(r.statusCode, 200);
  });

  await t('再次申请后仍可完整走一遍闭环（申请→确认→开始→完成）', async () => {
    const cr = jsonOf(await req('POST', '/api/exchanges', { postId: 'r1' }, tokenB));
    const id1 = cr.data._id;
    await req('POST', `/api/exchanges/${id1}/confirm`, {}, tokenA);
    await req('POST', `/api/exchanges/${id1}/start`, {}, tokenB);
    await req('POST', `/api/exchanges/${id1}/start`, {}, tokenA);
    await req('POST', `/api/exchanges/${id1}/complete`, {}, tokenB);
    const done = jsonOf(await req('POST', `/api/exchanges/${id1}/complete`, {}, tokenA));
    assert.strictEqual(done.data.status, 'completed');

    // 第二轮：同一帖同一人再申请一次，仍然能走到 completed
    const cr2 = jsonOf(await req('POST', '/api/exchanges', { postId: 'r1' }, tokenB));
    assert.strictEqual(cr2.data.status, 'pending');
    const id2 = cr2.data._id;
    assert.notStrictEqual(id2, id1);
    await req('POST', `/api/exchanges/${id2}/confirm`, {}, tokenA);
    await req('POST', `/api/exchanges/${id2}/start`, {}, tokenB);
    await req('POST', `/api/exchanges/${id2}/start`, {}, tokenA);
    await req('POST', `/api/exchanges/${id2}/complete`, {}, tokenB);
    const done2 = jsonOf(await req('POST', `/api/exchanges/${id2}/complete`, {}, tokenA));
    assert.strictEqual(done2.data.status, 'completed');
  });

  await t('第二轮交换的评价独立计分（旧记录不参与去重、不覆盖）', async () => {
    const list = jsonOf(await req('GET', '/api/exchanges', null, tokenB)).data.list
      .filter((e) => e.postId === 'r1' && e.status === 'completed');
    assert.strictEqual(list.length, 2, '两轮都应在列表里');
    const target = list[0];
    const r = jsonOf(await req('POST', `/api/exchanges/${target._id}/evaluate`, { rating: 'satisfied' }, tokenB));
    assert.strictEqual(r.code, 0);
    const ua = mock.stores.users.find((u) => u._openid === oA);
    assert.ok(ua.totalCount >= 1, '好评统计应累计');
  });

  await t('同一对 (postId, applicantId) 允许存在多条历史记录', async () => {
    const rows = mock.stores.exchanges.filter((e) => e.postId === 'r1' && e.applicantId === oB);
    assert.ok(rows.length >= 2);
    assert.ok(new Set(rows.map((e) => e._id)).size === rows.length, '每条记录 _id 唯一');
  });

  // ================== 历史库隐患防护 ==================
  console.log('\n历史库隐患防护');

  await t('插入被历史唯一索引拦下时（E11000）→ 兜底成可读 409，不透出原始报错', async () => {
    // 打桩：lib/db.js 按集合名缓存了 collection 对象，替换它缓存的 add 即可模拟「库上仍有唯一索引」
    const dbmod = require(path.join(API_DIR, 'lib/db'));
    const col = dbmod.db(dbmod.COLLECTIONS.EXCHANGES);
    const orig = col.add;
    col.add = async () => {
      throw new Error(
        'E11000 duplicate key error collection: tnt-xxx.exchanges '
        + 'index: postId_applicantId_unique dup key: { postId: "r5", applicantId: "sandbox:testA" }'
      );
    };
    try {
      const r = await req('POST', '/api/exchanges', { postId: 'r5' }, tokenC);
      const b = jsonOf(r);
      assert.strictEqual(r.statusCode, 409, '应转成业务冲突码');
      assert.ok(/已对该帖子发起过申请/.test(b.msg || ''), '应给出可读提示：' + b.msg);
      assert.ok(!/E11000|duplicate key/.test(b.msg || ''), '不能把数据库原始报错透给用户');
    } finally {
      col.add = orig;
    }
  });

  await t('索引文档里 postId+applicantId 必须标注为普通索引（防回退成唯一索引）', async () => {
    const p = path.resolve(__dirname, '../cloudbase/db/indexes.md');
    const src = fs.readFileSync(p, 'utf8');
    const line = src.split('\n').find((l) => /\|\s*exchanges\s*\|/.test(l) && /postId/.test(l) && /applicantId/.test(l));
    assert.ok(line, 'indexes.md 应记录 exchanges 的 postId+applicantId 索引');
    // 表格第 3 列是索引类型；写成「唯一」会让「交换完成后再次申请」重新报 E11000
    const typeCell = line.split('|')[3].trim();
    assert.ok(typeCell.startsWith('普通'), '该索引的「类型」列应为普通索引，实际是「' + typeCell + '」');
    assert.ok(/切勿设为唯一|不能是唯一/.test(src), '文档里要写明这个索引不能建成唯一索引的原因');
  });

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
