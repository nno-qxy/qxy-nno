/**
 * 阶段 3 逻辑层冒烟测试
 * 覆盖：G-01 管理员登录（成功 / 失败计数 / 5 次锁定 30 分钟）、
 *       G-02 待审列表（默认 pending / 状态筛选 / 游标分页）、
 *       G-03 AI 预审（本地词表命中 / TMS 命中 / 未配 TMS 降级）、
 *       G-04 通过 / 驳回（驳回必填原因 / 重复审核冲突）
 * 运行：node tests/stage3.test.js
 *
 * 复用 helpers/mock-cloudbase.js（内存数据库 + mock 微信/TMS + 投影校验）
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const { install } = require('./helpers/mock-cloudbase');

const API_DIR = path.resolve(__dirname, '../cloudbase/functions/skillswap-api');

// 测试用管理员口令（与脚本 scripts/gen-admin-hash.js 同格式 pbkdf2$iter$salt$hash）
const ADMIN_PWD = 'Test@1234';
function makeHash(pwd) {
  const iter = 100000;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pwd, salt, iter, 32, 'sha256').toString('hex');
  return `pbkdf2$${iter}$${salt}$${hash}`;
}
const ADMIN_PASS_HASH = makeHash(ADMIN_PWD);

// ---------- 测试计数 ----------
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' → ' + (e && e.stack || e)); failed++; }
}

// 清空并重新加载业务模块（让 config 重新读环境变量）
function clearApiCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.startsWith(API_DIR)) delete require.cache[k];
  });
}
function loadApi() {
  clearApiCache();
  return require(path.join(API_DIR, 'index.js')).main;
}

function jsonOf(res) { return JSON.parse(res.body); }

// ================= 阶段 A：未配置 TMS（全程降级） =================
(async () => {
  console.log('\n[阶段3] skillswap-api · 管理端审核 冒烟测试\n');

  const mock = install({ adminPassHash: ADMIN_PASS_HASH, adminUser: 'admin' });
  let main = loadApi();

  // 工具：带 token 的请求（自动把路径里的 ?a=b 解析为 queryStringParameters）
  function req(method, p, body, headers) {
    const h = Object.assign({}, headers);
    let path = p;
    let qp = {};
    if (p.includes('?')) {
      const [pp, qs] = p.split('?');
      path = pp;
      qs.split('&').filter(Boolean).forEach((kv) => {
        const [k, v] = kv.split('=');
        qp[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return main({
      httpMethod: method, path, headers: h,
      queryStringParameters: qp, body: body == null ? '' : JSON.stringify(body),
      isBase64Encoded: false,
    });
  }

  // ---------- G-01 登录 ----------
  console.log('G-01 管理员登录');

  await t('错误密码 → 401 且提示剩余次数', async () => {
    const r = await req('POST', '/api/admin/login', { username: 'admin', password: 'wrong' });
    assert.strictEqual(r.statusCode, 401);
    const b = jsonOf(r);
    assert.strictEqual(b.code, 401);
    assert.strictEqual(b.data.remain, 4);
  });

  await t('连续 5 次错误 → 第 5 次锁定 429', async () => {
    // 第 2~4 次
    for (let i = 2; i <= 4; i++) {
      const r = await req('POST', '/api/admin/login', { username: 'admin', password: 'wrong' });
      assert.strictEqual(r.statusCode, 401, '第' + i + '次应仍 401');
    }
    const r5 = await req('POST', '/api/admin/login', { username: 'admin', password: 'wrong' });
    assert.strictEqual(r5.statusCode, 429, '第 5 次应锁定');
    assert.ok(/锁定/.test(jsonOf(r5).msg));
  });

  await t('锁定期间即使密码正确也拒绝', async () => {
    const r = await req('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PWD });
    assert.strictEqual(r.statusCode, 429);
  });

  // 重置失败记录，便于后续正确登录
  mock.stores.configs.length = 0;

  await t('正确账号密码 → 200 且返回 token / username / expiresIn', async () => {
    const r = await req('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PWD });
    assert.strictEqual(r.statusCode, 200);
    const b = jsonOf(r);
    assert.ok(b.data.token && typeof b.data.token === 'string');
    assert.strictEqual(b.data.username, 'admin');
    assert.ok(b.data.expiresIn > 0);
  });

  let adminToken;
  {
    const r = await req('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PWD });
    adminToken = jsonOf(r).data.token;
  }

  // ---------- G-02 待审列表 ----------
  console.log('G-02 待审列表');

  const baseT = Date.now();
  mock.stores.posts.push(
    { _id: 'p_pend1', title: '教高数', type: 'teach', category: '学业辅导', content: '高考数学 120+ 选手辅导', tags: ['高数'], authorId: 'u_a', authorName: '小A', authorAvatar: '#2B62E0', status: 'pending', createTime: baseT - 3000, updateTime: baseT - 3000 },
    { _id: 'p_pend2', title: '教吉他', type: 'teach', category: '文艺特长', content: '零基础民谣吉他', tags: ['吉他'], authorId: 'u_b', authorName: '小B', authorAvatar: '#7A3FE0', status: 'pending', createTime: baseT - 2000, updateTime: baseT - 2000 },
    { _id: 'p_pass', title: '教剪映', type: 'teach', category: '数码技能', content: '剪映入门', tags: ['剪映'], authorId: 'u_c', authorName: '小C', authorAvatar: '#2B62E0', status: 'passed', createTime: baseT - 1000, updateTime: baseT - 1000 },
    { _id: 'p_rej', title: '求雅思搭子', type: 'learn', category: '语言交流', content: '找雅思口语搭子', tags: ['雅思'], authorId: 'u_d', authorName: '小D', authorAvatar: '#7A3FE0', status: 'rejected', rejectReason: '标题宽泛', createTime: baseT - 500, updateTime: baseT - 500 },
  );

  await t('未带 admin token → 401', async () => {
    const r = await req('GET', '/api/admin/posts');
    assert.strictEqual(r.statusCode, 401);
  });

  await t('默认查询只返回 pending（2 条，按 createTime desc）', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts', null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.list.length, 2);
    assert.ok(b.data.list.every((p) => p.status === 'pending'));
    assert.ok(b.data.list[0].createTime >= b.data.list[1].createTime, '应 desc 排序');
    assert.ok(b.data.list.every((p) => p.rejectReason === undefined), '列表不返回驳回原因（列表投影不含 rejectReason）');
  });

  await t('status=passed 筛选 → 仅 1 条 p_pass', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=passed', null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0]._id, 'p_pass');
  });

  await t('status=rejected → 带 rejectReason', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=rejected', null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0].rejectReason, '标题宽泛');
  });

  await t('非法 status → 400', async () => {
    const r = await req('GET', '/api/admin/posts?status=xxx', null, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('游标分页：cursor 后只返回更早的帖子', async () => {
    const all = jsonOf(await req('GET', '/api/admin/posts', null, { Authorization: 'Bearer ' + adminToken })).data.list;
    const cursor = all[0].createTime;
    const b = jsonOf(await req('GET', '/api/admin/posts?cursor=' + cursor, null, { Authorization: 'Bearer ' + adminToken }));
    assert.ok(b.data.list.every((p) => p.createTime < cursor));
  });

  // ---------- G-03 AI 预审（未配 TMS → 降级） ----------
  console.log('G-03 AI 预审');

  await t('本地词表命中 → Block / source=local', async () => {
    mock.stores.posts.push(
      { _id: 'p_bad', title: '代写论文', type: 'learn', category: '学业辅导', content: '有偿代写', tags: [], authorId: 'u_e', authorName: '小E', authorAvatar: '', status: 'pending', createTime: baseT - 100, updateTime: baseT - 100 },
    );
    const b = jsonOf(await req('POST', '/api/admin/posts/p_bad/ai-audit', {}, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.suggestion, 'Block');
    assert.strictEqual(b.data.source, 'local');
    assert.ok(b.data.word, '应带回命中词');
  });

  await t('未配 TMS 且本地未命中 → 降级 Review（请人工复核）/ degraded=true', async () => {
    const b = jsonOf(await req('POST', '/api/admin/posts/p_pend1/ai-audit', {}, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.suggestion, 'Review', '未配 TMS 不能给「建议通过」，应转人工');
    assert.strictEqual(b.data.degraded, true);
  });

  await t('本地风控词命中（内部资料）→ Review / source=local', async () => {
    mock.stores.posts.push(
      { _id: 'p_risk', title: '出考研内部资料', type: 'teach', category: '学业辅导', content: '各科内部资料打包', tags: [], authorId: 'u_g', authorName: '小G', authorAvatar: '', status: 'pending', createTime: baseT - 60, updateTime: baseT - 60 },
    );
    const b = jsonOf(await req('POST', '/api/admin/posts/p_risk/ai-audit', {}, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.suggestion, 'Review');
    assert.strictEqual(b.data.source, 'local');
    assert.strictEqual(b.data.word, '内部资料');
  });

  await t('不存在的帖子 → 404', async () => {
    const r = await req('POST', '/api/admin/posts/nope/ai-audit', {}, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 404);
  });

  // ---------- G-04 通过 / 驳回 ----------
  console.log('G-04 通过 / 驳回');

  await t('驳回不填原因 → 400', async () => {
    const r = await req('POST', '/api/admin/posts/p_pend1/review', { action: 'reject' }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('通过 → status 变 passed，记录 reviewer', async () => {
    const b = jsonOf(await req('POST', '/api/admin/posts/p_pend1/review', { action: 'pass' }, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'passed');
    const stored = mock.stores.posts.find((p) => p._id === 'p_pend1');
    assert.strictEqual(stored.status, 'passed');
    assert.strictEqual(stored.reviewer, 'admin');
    assert.ok(stored.reviewTime > 0);
  });

  await t('驳回填原因 → status 变 rejected，存 rejectReason', async () => {
    const b = jsonOf(await req('POST', '/api/admin/posts/p_pend2/review', { action: 'reject', reason: '内容不够具体，请补充可提供的技能细节' }, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.status, 'rejected');
    assert.strictEqual(b.data.rejectReason, '内容不够具体，请补充可提供的技能细节');
    const stored = mock.stores.posts.find((p) => p._id === 'p_pend2');
    assert.strictEqual(stored.status, 'rejected');
  });

  await t('重复审核已 passed 的帖子 → 409 冲突', async () => {
    const r = await req('POST', '/api/admin/posts/p_pend1/review', { action: 'pass' }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 409);
  });

  await t('原因超过 100 字 → 400', async () => {
    const longReason = '字'.repeat(101);
    const r = await req('POST', '/api/admin/posts/p_pend1/review', { action: 'reject', reason: longReason }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 400);
  });

  // ---------- 数据看板 stats ----------
  console.log('数据看板 stats');

  await t('GET /api/admin/stats 未带 token → 401', async () => {
    const r = await req('GET', '/api/admin/stats');
    assert.strictEqual(r.statusCode, 401);
  });

  await t('stats 返回完整聚合结构且计数正确', async () => {
    mock.stores.users.push(
      { _openid: 'u_a', nickname: '小A', goodCount: 3, totalCount: 4, avatarColor: '#2B62E0', status: 'active', createTime: baseT },
      { _openid: 'u_b', nickname: '小B', goodCount: 1, totalCount: 2, avatarColor: '#7A3FE0', status: 'banned', createTime: baseT - 86400000 },
    );
    mock.stores.exchanges.push(
      { _id: 'e1', status: 'pending', createTime: baseT },
      { _id: 'e2', status: 'active', createTime: baseT },
      { _id: 'e3', status: 'completed', createTime: baseT },
    );
    const b = jsonOf(await req('GET', '/api/admin/stats', null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.code, 0);

    // 计数：此刻 posts = p_pend1(passed) p_pend2(rejected) p_pass(passed) p_rej(rejected) p_bad(pending) p_risk(pending)
    assert.strictEqual(b.data.users.total, 2);
    assert.strictEqual(b.data.users.banned, 1);
    assert.ok(b.data.users.today >= 1, '今天注册的用户应计入');
    assert.strictEqual(b.data.posts.pending, 2);
    assert.strictEqual(b.data.posts.passed, 2);
    assert.strictEqual(b.data.posts.rejected, 2);
    assert.strictEqual(b.data.posts.offline, 0);
    assert.strictEqual(b.data.exchanges.pending, 1);
    assert.strictEqual(b.data.exchanges.active, 1);
    assert.strictEqual(b.data.exchanges.completed, 1);

    // 聚合
    assert.strictEqual(b.data.trend.length, 7, '趋势应为 7 天');
    assert.ok(b.data.trend[6].count >= 1, '今天应有新发布');
    const tagNames = b.data.topTags.map((x) => x.tag);
    assert.ok(tagNames.includes('高数') && tagNames.includes('剪映'), 'topTags 应含 passed 帖的标签');
    assert.ok(b.data.topCategories.length >= 1, '应有分类分布');
    assert.strictEqual(b.data.topUsers[0].name, '小A', '好评最多的用户应排第一');
  });

  // ---------- G-09 帖子管理（全量检索 + 下架 / 恢复） ----------
  console.log('G-09 帖子管理');

  await t('未带 admin token → 401', async () => {
    const r = await req('GET', '/api/admin/posts?status=all');
    assert.strictEqual(r.statusCode, 401);
  });

  await t('status=all → 返回全部帖子（不限状态）', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=all', null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.list.length, 6);
  });

  await t('keyword 模糊匹配标题 → 命中「教高数」', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=all&keyword=' + encodeURIComponent('高数'), null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0]._id, 'p_pend1');
  });

  await t('category 筛选 → 仅「数码技能」', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=all&category=' + encodeURIComponent('数码技能'), null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0]._id, 'p_pass');
  });

  await t('type=learn → 仅「我想学」帖', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=all&type=learn', null, { Authorization: 'Bearer ' + adminToken }));
    assert.ok(b.data.list.length >= 1);
    assert.ok(b.data.list.every((p) => p.type === 'learn'));
  });

  await t('非法 category / type → 400', async () => {
    const r1 = await req('GET', '/api/admin/posts?status=all&category=' + encodeURIComponent('不存在的分类'), null, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r1.statusCode, 400);
    const r2 = await req('GET', '/api/admin/posts?status=all&type=bogus', null, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r2.statusCode, 400);
  });

  await t('size=2 → 只返回 2 条且带 nextCursor', async () => {
    const b = jsonOf(await req('GET', '/api/admin/posts?status=all&size=2', null, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.list.length, 2);
    assert.ok(b.data.nextCursor, '满页应返回 nextCursor');
  });

  await t('下架已通过帖 → offline 且记录原因与操作人', async () => {
    const b = jsonOf(await req('POST', '/api/admin/posts/p_pass/takedown', { action: 'offline', reason: '涉嫌广告' }, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'offline');
    const stored = mock.stores.posts.find((p) => p._id === 'p_pass');
    assert.strictEqual(stored.status, 'offline');
    assert.strictEqual(stored.offlineReason, '涉嫌广告');
    assert.strictEqual(stored.reviewer, 'admin');
    assert.ok(stored.offlineTime > 0);
  });

  await t('下架非上架状态的帖 → 409', async () => {
    const r = await req('POST', '/api/admin/posts/p_bad/takedown', { action: 'offline' }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 409);
  });

  await t('恢复已下架帖 → 回到 passed 并清空下架原因', async () => {
    const b = jsonOf(await req('POST', '/api/admin/posts/p_pass/takedown', { action: 'restore' }, { Authorization: 'Bearer ' + adminToken }));
    assert.strictEqual(b.data.status, 'passed');
    const stored = mock.stores.posts.find((p) => p._id === 'p_pass');
    assert.strictEqual(stored.status, 'passed');
    assert.strictEqual(stored.offlineReason, '');
  });

  await t('恢复未下架的帖 → 409', async () => {
    const r = await req('POST', '/api/admin/posts/p_rej/takedown', { action: 'restore' }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r.statusCode, 409);
  });

  await t('非法 action → 400；帖子不存在 → 404', async () => {
    const r1 = await req('POST', '/api/admin/posts/p_pass/takedown', { action: 'delete' }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r1.statusCode, 400);
    const r2 = await req('POST', '/api/admin/posts/nope/takedown', { action: 'offline' }, { Authorization: 'Bearer ' + adminToken });
    assert.strictEqual(r2.statusCode, 404);
  });

  // ================= 阶段 B：配置 TMS（重新加载 env） =================
  console.log('\nG-03（TMS 已配置）分支');

  const mock2 = install({
    adminPassHash: ADMIN_PASS_HASH,
    adminUser: 'admin',
    tms: { Suggestion: 'Block', Label: 'Porn', Score: 95 },
  });
  main = loadApi();

  // 重新登录拿 token（新 mock 的独立失败计数，但这里登录成功不影响）
  let token2;
  {
    const r = await req('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PWD });
    token2 = jsonOf(r).data.token;
  }

  await t('TMS 返回 Block → suggestion=Block / source=tms / degraded=false', async () => {
    mock2.stores.posts.push(
      { _id: 'p_tms', title: '正常技能帖', type: 'teach', category: '学业辅导', content: '教高数，无违规词', tags: [], authorId: 'u_f', authorName: '小F', authorAvatar: '', status: 'pending', createTime: baseT - 50, updateTime: baseT - 50 },
    );
    const b = jsonOf(await req('POST', '/api/admin/posts/p_tms/ai-audit', {}, { Authorization: 'Bearer ' + token2 }));
    assert.strictEqual(b.data.suggestion, 'Block');
    assert.strictEqual(b.data.source, 'tms');
    assert.strictEqual(b.data.degraded, false);
    assert.strictEqual(b.data.label, 'Porn');
  });

  // ---------- 汇总 ----------
  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})();
