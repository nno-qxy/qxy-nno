/**
 * 阶段 5 逻辑层测试：管理端用户管理
 * 覆盖：G-06 用户搜索（无 keyword 全量 / 有 keyword 四类命中 / 游标分页）、
 *       G-07 用户详情（信息 + 发布列表 + 交换记录 / 不存在 404）、
 *       G-08 封禁/解封（状态切换 / passed 帖下架 / bannedPosts 记录 / 解封精确恢复 / 重复操作 409）、
 *       所有接口非 admin 返回 401。
 * 运行：node tests/stage5.test.js
 * 复用 helpers/mock-cloudbase.js（已增强 $or 与正则匹配）
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const { install } = require('./helpers/mock-cloudbase');

const API_DIR = path.resolve(__dirname, '../cloudbase/functions/skillswap-api');

const ADMIN_PWD = 'Test@1234';
function makeHash(pwd) {
  const iter = 100000;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pwd, salt, iter, 32, 'sha256').toString('hex');
  return `pbkdf2$${iter}$${salt}$${hash}`;
}
const ADMIN_PASS_HASH = makeHash(ADMIN_PWD);

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' → ' + (e && e.stack || e)); failed++; }
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
function jsonOf(res) { return JSON.parse(res.body); }

(async () => {
  console.log('\n[阶段5] skillswap-api · 管理端用户管理 G-06/07/08 测试\n');

  const mock = install({ adminPassHash: ADMIN_PASS_HASH, adminUser: 'admin', tms: null });
  let main = loadApi();
  const stores = mock.stores;

  // 带 token 的请求（query 解析进 queryStringParameters）
  function req(method, p, body, headers) {
    const h = Object.assign({}, headers);
    let path = p; let qp = {};
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
  async function adminToken() {
    const r = jsonOf(await req('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PWD }));
    return r.data.token;
  }

  // ----- 预置数据：两个学生用户 + 帖子 + 交换 -----
  const now = Date.now();
  const uA = { _openid: 'oA', role: 'user', nickname: '小A同学', realName: '张三', studentId: '20210001',
    grade: '大三', major: '软件工程', tags: ['英语'], contact: 'wx_a', status: 'active',
    goodCount: 3, totalCount: 4, createTime: now - 3000, updateTime: now - 3000 };
  const uB = { _openid: 'oB', role: 'user', nickname: '小B', realName: '李四', studentId: '20210002',
    grade: '大二', major: '设计', tags: ['吉他'], contact: 'wx_b', status: 'active',
    goodCount: 1, totalCount: 2, createTime: now - 2000, updateTime: now - 2000 };
  stores.users.push(uA, uB);

  const postA = { _id: 'pa1', title: '教英语六级', type: 'teach', category: '学业辅导',
    content: '英语辅导', tags: ['英语'], authorId: 'oA', authorName: '小A同学', authorAvatar: '#2B62E0',
    status: 'passed', createTime: now - 1000, updateTime: now - 1000 };
  stores.posts.push(postA);

  const exA = { _id: 'ex1', postId: 'pa1', postTitle: '教英语六级', applicantId: 'oA', targetId: 'oB',
    status: 'active', completedBy: [], evaluations: [], createTime: now - 500, updateTime: now - 500 };
  stores.exchanges.push(exA);

  const tok = await adminToken();
  assert.ok(tok, '管理员登录拿到 token');

  // ===== G-06 用户搜索 =====
  console.log('  — G-06 用户搜索 —');
  await t('无 keyword 返回全部用户', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users', null, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.code, 0, '应成功');
    const openids = (r.data.list || []).map((x) => x._openid);
    assert.ok(openids.includes('oA') && openids.includes('oB'), '应包含 fixture 用户');
  });

  await t('keyword 命中 nickname（小）', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users?keyword=' + encodeURIComponent('小'), null, { Authorization: 'Bearer ' + tok }));
    const nicks = (r.data.list || []).map((x) => x.nickname);
    assert.ok(nicks.includes('小A同学') && nicks.includes('小B'), '应命中两个“小”开头昵称');
  });

  await t('keyword 命中 realName（张三）', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users?keyword=' + encodeURIComponent('张三'), null, { Authorization: 'Bearer ' + tok }));
    const ids = (r.data.list || []).map((x) => x._openid);
    assert.deepStrictEqual(ids, ['oA'], '应只命中 oA');
  });

  await t('keyword 命中 studentId（20210002）', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users?keyword=20210002', null, { Authorization: 'Bearer ' + tok }));
    const ids = (r.data.list || []).map((x) => x._openid);
    assert.deepStrictEqual(ids, ['oB'], '应只命中 oB');
  });

  await t('keyword 命中 openid（oA）', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users?keyword=oA', null, { Authorization: 'Bearer ' + tok }));
    const ids = (r.data.list || []).map((x) => x._openid);
    assert.deepStrictEqual(ids, ['oA'], '应只命中 oA');
  });

  await t('游标分页：cursor 早于 oB 仅返回更早的 oA', async () => {
    // 列表按 createTime desc：admin(≈now) > oB(now-2000) > oA(now-3000)
    // 下一页游标取 cursor=now-2500 → 只返回 createTime<now-2500 的 oA
    const r = jsonOf(await req('GET', '/api/admin/users?cursor=' + (now - 2500), null, { Authorization: 'Bearer ' + tok }));
    const ids = (r.data.list || []).map((x) => x._openid);
    assert.ok(ids.includes('oA'), 'oA(createTime=now-3000) 应被游标保留');
    assert.ok(!ids.includes('oB'), 'oB(createTime=now-2000) 应被游标排除');
  });

  // ===== G-07 用户详情 =====
  console.log('  — G-07 用户详情 —');
  await t('详情返回 user + posts + exchanges', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users/oA', null, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.code, 0, '应成功');
    assert.strictEqual(r.data.user.nickname, '小A同学', '用户基本信息');
    assert.strictEqual(r.data.posts.length, 1, '应含 1 篇发布');
    assert.strictEqual(r.data.posts[0]._id, 'pa1');
    assert.strictEqual(r.data.exchanges.length, 1, '应含 1 条交换记录');
    assert.strictEqual(r.data.exchanges[0]._id, 'ex1');
  });

  await t('不存在的用户返回 404', async () => {
    const r = await req('GET', '/api/admin/users/ghost', null, { Authorization: 'Bearer ' + tok });
    assert.strictEqual(r.statusCode, 404);
  });

  // ===== G-08 封禁/解封 =====
  console.log('  — G-08 封禁/解封 —');
  await t('封禁 oA：状态变 banned + passed 帖下架 + 记录 bannedPosts', async () => {
    const r = jsonOf(await req('POST', '/api/admin/users/oA/ban', { action: 'ban' }, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.code, 0, '应成功');
    assert.strictEqual(r.data.status, 'banned');
    assert.strictEqual(r.data.offlinePosts, 1, '应下架 1 篇 passed 帖');
    const u = stores.users.find((x) => x._openid === 'oA');
    assert.strictEqual(u.status, 'banned');
    assert.deepStrictEqual(u.bannedPosts, ['pa1'], '应记录被下架帖子');
    const p = stores.posts.find((x) => x._id === 'pa1');
    assert.strictEqual(p.status, 'offline', '帖子应被下架');
  });

  await t('重复封禁返回 409', async () => {
    const r = await req('POST', '/api/admin/users/oA/ban', { action: 'ban' }, { Authorization: 'Bearer ' + tok });
    assert.strictEqual(r.statusCode, 409);
  });

  await t('解封 oA：状态恢复 active + 仅恢复 bannedPosts 中的帖', async () => {
    const r = jsonOf(await req('POST', '/api/admin/users/oA/ban', { action: 'unban' }, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.code, 0, '应成功');
    assert.strictEqual(r.data.status, 'active');
    assert.strictEqual(r.data.restoredPosts, 1, '应恢复 1 篇');
    const u = stores.users.find((x) => x._openid === 'oA');
    assert.strictEqual(u.status, 'active');
    assert.deepStrictEqual(u.bannedPosts, [], '解封后清空记录');
    const p = stores.posts.find((x) => x._id === 'pa1');
    assert.strictEqual(p.status, 'passed', '帖子应恢复上架');
  });

  await t('未封禁用户解封返回 409', async () => {
    const r = await req('POST', '/api/admin/users/oB/ban', { action: 'unban' }, { Authorization: 'Bearer ' + tok });
    assert.strictEqual(r.statusCode, 409);
  });

  // ===== 鉴权 =====
  console.log('  — 鉴权 —');
  await t('无 token 访问用户搜索返回 401', async () => {
    const r = await req('GET', '/api/admin/users');
    assert.strictEqual(r.statusCode, 401);
  });
  await t('无 token 访问用户详情返回 401', async () => {
    const r = await req('GET', '/api/admin/users/oA');
    assert.strictEqual(r.statusCode, 401);
  });

  // ===== G-06 用户列表 size 参数（管理端一屏看全，2026-09-11 修复）=====
  console.log('  — G-06 size 参数 —');
  for (let i = 1; i <= 12; i++) {
    stores.users.push({
      _openid: 'bulk_' + i, role: 'user', nickname: '批量' + i, realName: 'B' + i,
      studentId: '2023' + String(i).padStart(4, '0'), status: 'active',
      goodCount: 0, totalCount: 0,
      createTime: now - 10000 - i * 10, updateTime: now - 10000 - i * 10,
    });
  }
  const totalUsers = () => stores.users.filter((u) => u.role === 'user').length;

  await t('默认不带 size 只返回 PAGE_SIZE(10) 条并给出 nextCursor', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users', null, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.data.list.length, 10, '默认应只返回 10 条');
    assert.ok(r.data.nextCursor, '还有更多用户时应给出 nextCursor');
  });

  await t('size=100 一次返回全部用户且 nextCursor 为空', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users?size=100', null, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.data.list.length, totalUsers(), 'size=100 应一次返回全部用户');
    assert.strictEqual(r.data.nextCursor, null, '已无更多时 nextCursor 应为 null');
  });

  await t('size 越界被夹紧（9999 → 上限 100，不报错）', async () => {
    const r = jsonOf(await req('GET', '/api/admin/users?size=9999', null, { Authorization: 'Bearer ' + tok }));
    assert.strictEqual(r.code, 0, '越界 size 应被夹紧而非报错');
    assert.strictEqual(r.data.list.length, totalUsers(), '上限 100 仍应覆盖全部测试用户');
  });

  console.log(`\n[阶段5] 通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
