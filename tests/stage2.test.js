/**
 * 阶段 2 逻辑层冒烟测试
 * 覆盖：Z-03 广场、Z-04 发布、Z-06 内容安全（双层）、Z-12 我的发布 + 驳回重提
 * 运行：node tests/stage2.test.js
 *
 * mock 设计：和 stage0 共享一套内存数据库约定，但本测试需要
 *   - orderBy 真的按 createTime desc 排序
 *   - field() 投影只返回指定字段
 *   - 不需要 doc()（生产代码避免用 doc().update，统一 where().update()）
 */

const assert = require('assert');
const Module = require('module');

// ---------- 1. 增强 mock 文档型数据库 ----------
const stores = { users: [], posts: [], exchanges: [], configs: [] };
let seq = 0;

function matchFilter(f) {
  return (d) => Object.keys(f || {}).every((k) => {
    const fv = f[k];
    // 支持 command 语义：$in（数组字段含其一）/ $ne（不等于）
    if (fv && typeof fv === 'object' && !Array.isArray(fv)) {
      if ('$in' in fv) {
        const arr = Array.isArray(d[k]) ? d[k] : [d[k]];
        return arr.some((x) => fv.$in.includes(x));
      }
      if ('$ne' in fv) return d[k] !== fv.$ne;
    }
    return d[k] === fv;
  });
}

function makeCollection(name) {
  const store = stores[name];
  // 每次返回新对象（但 db.js 内部会缓存，跨请求 chain 是同一个），
  // 所以下面 where() 主动重置 fields/order/limit，避免列表查询的 field 投影污染后续详情
  const chain = {
    store, name,
    filter: {}, order: null, limitN: Infinity, fields: null,
  };
  const api = {
    where(f) {
      chain.filter = f || {};
      chain.fields = null;     // 重置：模拟"where() 是新查询"
      chain.order = null;
      chain.limitN = Infinity;
      return api;
    },
    limit(n) { chain.limitN = n; return api; },
    orderBy(k, dir) { chain.order = `${k}_${dir || 'asc'}`; return api; },
    field(f) {
      chain.fields = f;
      // 模拟 MongoDB 投影规则：要么全 true 要么全 false（_id 例外）
      // 混用会抛 BadValue → 这种真 bug 必须被 mock 抓到
      const vals = Object.values(f || {});
      const bools = vals.filter((v) => typeof v === 'boolean');
      const hasTrue = bools.some((v) => v === true);
      const hasFalse = bools.some((v) => v === false);
      if (hasTrue && hasFalse) {
        throw new Error('Projection cannot have a mix of inclusion and exclusion');
      }
      return api;
    },
    skip() { return api; },
    async get() {
      let arr = store.filter(matchFilter(chain.filter));
      if (chain.order) {
        const [k, dir] = chain.order.split('_');
        arr = arr.slice().sort((a, b) => {
          if (a[k] === b[k]) return 0;
          return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        });
      }
      if (chain.limitN !== Infinity) arr = arr.slice(0, chain.limitN);
      let out = arr.map((d) => JSON.parse(JSON.stringify(d)));
      if (chain.fields) {
        out = out.map((d) => {
          const o = {};
          Object.keys(d).forEach((k) => { if (chain.fields[k]) o[k] = d[k]; });
          return o;
        });
      }
      return { data: out };
    },
    async add(doc) {
      const d = Object.assign({ _id: 'id_' + (++seq) }, doc);
      store.push(d);
      return { _id: d._id, ...doc };
    },
    async update(patch) {
      let n = 0;
      store.forEach((d) => {
        if (matchFilter(chain.filter)(d)) { Object.assign(d, JSON.parse(JSON.stringify(patch))); n++; }
      });
      return { stats: { updated: n } };
    },
    // 与真实 SDK 一致：返回 { total }（供 /api/posts/counts 徽标计数用）
    async count() {
      return { total: store.filter(matchFilter(chain.filter)).length };
    },
  };
  return api;
}

const mockSdk = {
  SYMBOL_CURRENT_ENV: 'mock-env',
  init() {
    return {
      database: () => ({
        collection: (name) => makeCollection(name),
        command: { in: (a) => ({ $in: a }), neq: (v) => ({ $ne: v }) },
      }),
    };
  },
};

// ---------- 2. mock https（只拦微信 code2Session） ----------
function fakeRes(body) {
  return {
    on(ev, fn) {
      if (ev === 'data') fn(body);
      if (ev === 'end') fn();
    },
  };
}
const mockHttps = {
  get(url, opts, cb) {
    const u = String(url);
    if (u.includes('jscode2session')) {
      const code = (u.match(/js_code=([^&]+)/) || [])[1];
      const body = code === 'BAD_CODE'
        ? JSON.stringify({ errcode: 40029, errmsg: 'invalid code' })
        : JSON.stringify({ openid: 'openid_from_' + code, session_key: 'sk' });
      process.nextTick(() => cb(fakeRes(body)));
      return { on() {}, destroy() {}, setTimeout() {} };
    }
    throw new Error('未预期的 https.get: ' + u);
  },
  // TMS 走的是 https.request，post 走这里
  request() {
    return {
      on() {}, end() {}, write() {}, destroy() {},
    };
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') return mockSdk;
  if (request === 'https') return mockHttps;
  return origLoad.apply(this, arguments);
};

// ---------- 3. 环境变量 ----------
process.env.WX_APPID = 'wx_test_appid';
process.env.WX_SECRET = 'wx_test_secret';
process.env.TOKEN_SECRET = 'stage2_token_secret';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS_HASH = 'x';
delete process.env.TMS_SECRET_ID;
delete process.env.TMS_SECRET_KEY;  // 不配 TMS，让其降级为本地词表兜底

const { main } = require('../cloudbase/functions/skillswap-api/index.js');
const postsRoute = require('../cloudbase/functions/skillswap-api/routes/posts.js');

// ---------- 4. 测试工具 ----------
let passed = 0, failed = 0;
function req(method, path, body, headers) {
  let pathWithQ = path;
  if (path.includes('?') && body == null) {
    const [p, qs] = path.split('?');
    const qp = {};
    qs.split('&').filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split('=');
      qp[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return main({
      httpMethod: method, path: p, headers: headers || {},
      queryStringParameters: qp, body: '', isBase64Encoded: false,
    });
  }
  return main({
    httpMethod: method, path, headers: headers || {},
    queryStringParameters: {}, body: body == null ? '' : JSON.stringify(body),
    isBase64Encoded: false,
  });
}
function jsonOf(res) { return JSON.parse(res.body); }

async function t(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' → ' + (e && e.stack || e)); failed++; }
}

async function loginAs(code) {
  const r = jsonOf(await req('POST', '/api/auth/login', { code }));
  return r.data.token;
}

// ---------- 5. 测试用例 ----------
(async () => {
  console.log('\n[阶段2] skillswap-api · 广场/发布/我的发布 冒烟测试\n');

  // ----- 预置：登录两个用户 + 手工塞 3 条 fixture 帖子 -----
  const tokenA = await loginAs('USER_A');
  const tokenB = await loginAs('USER_B');
  const openidA = 'openid_from_USER_A';
  const openidB = 'openid_from_USER_B';

  // 模拟「已完善资料」：给 A/B 补真实姓名 + 学号（发布前资料校验依赖这两项）
  stores.users.filter((u) => u._openid === openidA).forEach((u) => { u.realName = '小A'; u.studentId = '20210001'; });
  stores.users.filter((u) => u._openid === openidB).forEach((u) => { u.realName = '小B'; u.studentId = '20210002'; });

  // C 是一个「仅登录、未完善资料」的用户，用于验证发布前拦截
  const tokenC = await loginAs('USER_C');
  const openidC = 'openid_from_USER_C';

  // 直接写库：1 篇 A 的 passed、1 篇 A 的 rejected、1 篇 B 的 passed
  const baseT = Date.now();
  stores.posts.push(
    { _id: 'p1', title: '教高数', type: 'teach', category: '学业辅导',
      content: '高考数学 120+ 选手，可以辅导高数', tags: ['高数', '线性代数'],
      authorId: openidA, authorName: 'A', authorAvatar: '#2B62E0',
      status: 'passed', createTime: baseT - 3000, updateTime: baseT - 3000 },
    { _id: 'p2', title: '求雅思口语搭子', type: 'learn', category: '语言交流',
      content: '想找一个人每天用英语对话 30 分钟', tags: ['雅思', '口语'],
      authorId: openidA, authorName: 'A', authorAvatar: '#2B62E0',
      status: 'rejected', rejectReason: '标题过于宽泛',
      createTime: baseT - 2000, updateTime: baseT - 2000 },
    { _id: 'p3', title: '教你剪映', type: 'teach', category: '数码技能',
      content: '从零开始教你剪映，3 节课包会', tags: ['剪映', '短视频'],
      authorId: openidB, authorName: 'B', authorAvatar: '#7A3FE0',
      status: 'passed', createTime: baseT - 1000, updateTime: baseT - 1000 },
  );

  // ===== Z-03 广场列表 =====

  await t('GET /api/posts 公开返回 2 条 passed（不含 rejected）', async () => {
    const b = jsonOf(await req('GET', '/api/posts'));
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.list.length, 2);
    assert.ok(b.data.list.every((p) => p.status === 'passed'), '必须只含 passed');
    assert.ok(b.data.list.every((p) => p.rejectReason === undefined), '列表不返回驳回原因');
  });

  await t('GET /api/posts 按 type=teach 过滤剩 2 条（p1 + p3）', async () => {
    const b = jsonOf(await req('GET', '/api/posts?type=teach'));
    assert.strictEqual(b.data.list.length, 2);
    assert.ok(b.data.list.every((p) => p.type === 'teach'));
  });

  await t('GET /api/posts 按 category=数码技能 过滤剩 1 条', async () => {
    const b = jsonOf(await req('GET', '/api/posts?category=' + encodeURIComponent('数码技能')));
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0].category, '数码技能');
  });

  await t('GET /api/posts?type=bogus 返回 400', async () => {
    const r = await req('GET', '/api/posts?type=bogus');
    assert.strictEqual(r.statusCode, 400);
  });

  await t('GET /api/posts cursor 翻页：从中间值往后翻', async () => {
    const all = jsonOf(await req('GET', '/api/posts')).data.list;
    // 取第 1 条 createTime 作为 cursor，应该只返回 createTime 更小的
    const cursor = all[0].createTime;
    const b = jsonOf(await req('GET', '/api/posts?cursor=' + cursor));
    assert.ok(b.data.list.every((p) => p.createTime < cursor), 'cursor 后的 createTime 应更小');
  });

  // ===== Z-12 我的发布 =====

  await t('GET /api/posts/mine 未登录 401', async () => {
    const r = await req('GET', '/api/posts/mine');
    assert.strictEqual(r.statusCode, 401);
  });

  await t('GET /api/posts/mine A 看到 2 条（passed + rejected）', async () => {
    const r = await req('GET', '/api/posts/mine', null, { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.list.length, 2);
    assert.ok(b.data.list.every((p) => p.authorId === openidA));
  });

  await t('GET /api/posts/mine?status=rejected 只看到 A 的驳回帖', async () => {
    const r = await req('GET', '/api/posts/mine?status=rejected', null, { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.data.list.length, 1);
    assert.strictEqual(b.data.list[0]._id, 'p2');
  });

  // ===== Z-03 详情 =====

  await t('GET /api/posts/:id 未登录看 passed 200', async () => {
    const r = await req('GET', '/api/posts/p1');
    assert.strictEqual(r.statusCode, 200);
    const b = jsonOf(r);
    assert.strictEqual(b.data._id, 'p1');
  });

  await t('GET /api/posts/:id 未登录看 rejected 404', async () => {
    const r = await req('GET', '/api/posts/p2');
    assert.strictEqual(r.statusCode, 404, '非作者/管理员看不到驳回帖');
  });

  await t('GET /api/posts/:id 作者看自己的 rejected 200', async () => {
    const r = await req('GET', '/api/posts/p2', null, { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data._id, 'p2');
    assert.strictEqual(b.data.rejectReason, '标题过于宽泛', '作者能看到驳回原因');
  });

  await t('GET /api/posts/:id 别人看别人的 rejected 404', async () => {
    const r = await req('GET', '/api/posts/p2', null, { Authorization: 'Bearer ' + tokenB });
    assert.strictEqual(r.statusCode, 404);
  });

  // ===== Z-04 发布 =====

  await t('POST /api/posts 未登录 401', async () => {
    const r = await req('POST', '/api/posts', { type: 'teach', category: '学业辅导', title: '测试', content: '测试内容' });
    assert.strictEqual(r.statusCode, 401);
  });

  await t('POST /api/posts 字段不全 400', async () => {
    const r = await req('POST', '/api/posts', { type: 'teach' }, { Authorization: 'Bearer ' + tokenA });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('POST /api/posts type 不合法 400', async () => {
    const r = await req('POST', '/api/posts',
      { type: 'xxx', category: '学业辅导', title: '合法标题够长', content: '合法正文够长' },
      { Authorization: 'Bearer ' + tokenA });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('POST /api/posts 标题 4 字边界 400', async () => {
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '短', content: '合法正文够长够长够长' },
      { Authorization: 'Bearer ' + tokenA });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('POST /api/posts 词表命中 → 422', async () => {
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '代考服务', content: '高数线代考试均可代考，提供真题与答案' },
      { Authorization: 'Bearer ' + tokenA });
    assert.strictEqual(r.statusCode, 422, '应返回 422 拦截敏感词');
  });

  await t('POST /api/posts 标签超过 8 个 400', async () => {
    const tags = ['a','b','c','d','e','f','g','h','i'];
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '标签很多', content: '正文内容够长够长够长', tags },
      { Authorization: 'Bearer ' + tokenA });
    assert.strictEqual(r.statusCode, 400);
  });

  await t('POST /api/posts 成功 200，状态 pending（进入人工审核队列）', async () => {
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '教英语口语', content: '雅思 7 分，可以练口语 30 分钟', tags: ['英语','口语'] },
      { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0, '应成功');
    assert.strictEqual(b.data.status, 'pending', '机器层通过但需人工审核，应为 pending');
    assert.ok(b.data._id, '应返回 _id');
    assert.strictEqual(stores.posts.length, 4, 'posts 集合新增 1 条');
  });

  await t('POST /api/posts 资料未完善（缺姓名/学号）→ 400 拦截', async () => {
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '教英语口语', content: '雅思 7 分，可以练口语 30 分钟', tags: ['英语', '口语'] },
      { Authorization: 'Bearer ' + tokenC });
    assert.strictEqual(r.statusCode, 400, '缺资料应被拦截');
    assert.ok(/姓名与学号/.test(jsonOf(r).msg), '应提示完善姓名与学号');
    // 不应落库
    assert.ok(stores.posts.every((p) => p.authorId !== openidC), '资料缺失时不应写入任何帖子');
  });

  // ===== Z-06 风控词层：即使 TMS=Pass 也不得自动上广场 =====
  const tmsLib = require('../cloudbase/functions/skillswap-api/lib/tms.js');
  const origCheckText = tmsLib.checkText;

  await t('TMS=Pass 无风控词 → passed（混合模式自动上广场）', async () => {
    tmsLib.checkText = async () => ({ enabled: true, suggestion: 'Pass', label: 'Normal', score: 10, degraded: false });
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '教编程入门', content: 'Python 零基础入门辅导，每周两次', tags: ['编程'] },
      { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'passed', 'TMS=Pass 且无风控词应直接上广场');
  });

  await t('TMS=Pass 但命中风控词（内部资料）→ 强制 pending', async () => {
    tmsLib.checkText = async () => ({ enabled: true, suggestion: 'Pass', label: 'Normal', score: 10, degraded: false });
    const r = await req('POST', '/api/posts',
      { type: 'teach', category: '学业辅导', title: '出考研内部资料', content: '提供考研各科内部资料打包，需要的联系', tags: ['资料'] },
      { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending', '风控词命中必须进人工审核，不得自动上广场');
  });

  tmsLib.checkText = origCheckText;

  // ===== Z-07 相关推荐（基于 tags 重合度） =====

  await t('rankRelated 按 tag 重合数降序，再按 createTime 新→旧', async () => {
    const base = 1000;
    const rows = [
      { _id: 'a', tags: ['高数'], createTime: base + 1 },
      { _id: 'b', tags: ['高数', '线代'], createTime: base + 3 },
      { _id: 'c', tags: ['英语'], createTime: base + 2 }, // 无交集，垫底
      { _id: 'd', tags: ['高数', '线代', '物理'], createTime: base }, // 3 重合但时间最旧
    ];
    const out = postsRoute.rankRelated(rows, ['高数', '线代']);
    assert.deepStrictEqual(out.map((p) => p._id), ['b', 'd', 'a', 'c']);
  });

  // 预置一批带 tags 的 passed 帖（含 1 篇 pending 不应出现在推荐里）
  const baseR = Date.now();
  stores.posts.push(
    { _id: 'r1', title: '教线代', type: 'teach', category: '学业辅导', content: '线性代数辅导', tags: ['高数', '线代'], authorId: 'u_x', authorName: 'X', authorAvatar: '#2B62E0', status: 'passed', createTime: baseR - 100 },
    { _id: 'r2', title: '教微积分', type: 'teach', category: '学业辅导', content: '微积分答疑', tags: ['高数'], authorId: 'u_y', authorName: 'Y', authorAvatar: '#2B62E0', status: 'passed', createTime: baseR - 200 },
    { _id: 'r3', title: '教吉他进阶', type: 'teach', category: '文艺特长', content: '吉他', tags: ['吉他'], authorId: 'u_z', authorName: 'Z', authorAvatar: '#7A3FE0', status: 'passed', createTime: baseR - 50 },
    { _id: 'r4', title: '教高数草稿', type: 'teach', category: '学业辅导', content: '高数', tags: ['高数'], authorId: 'u_w', authorName: 'W', authorAvatar: '#2B62E0', status: 'pending', createTime: baseR },
    { _id: 'r5', title: '想学高数线代', type: 'learn', category: '学业辅导', content: '求带高数线代', tags: ['高数', '线代'], authorId: 'u_v', authorName: 'V', authorAvatar: '#7A3FE0', status: 'passed', createTime: baseR - 150 },
  );

  await t('GET /api/posts/related 返回 passed 相似帖、排除自身、按重合排序、不含敏感字段', async () => {
    // p1 是预置的 passed 帖（tags=高数/线性代数），作为「当前帖」需被 exclude
    const r = await req('GET', '/api/posts/related?tags=' + encodeURIComponent('高数,线代') + '&exclude=p1');
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    const ids = b.data.list.map((p) => p._id);
    assert.ok(ids.includes('r1'), '应含高重合的 r1');
    assert.ok(ids.includes('r2'), '应含 r2');
    assert.ok(!ids.includes('r4'), 'pending 帖不应出现在相关推荐');
    assert.ok(!ids.includes('p1'), 'exclude 应排除自身 p1');
    // 排序：r1 重合 2 个，应排在仅重合 1 个的 r2 之前
    assert.ok(ids.indexOf('r1') < ids.indexOf('r2'), '高重合应靠前');
    // 列表投影同广场（LIST_FIELDS），不应含联系方式等敏感字段
    assert.ok(b.data.list.every((p) => p.contactWechat === undefined && p.authorName !== undefined), '列表投影不含联系方式但含作者名');
  });

  // ===== Z-07+ 互补推荐（发布后推荐相反类型）=====
  await t('related?type=learn 只返回「我想学」→ 支撑「发布我能教后推荐想学帖」', async () => {
    const r = await req('GET', '/api/posts/related?tags=' + encodeURIComponent('高数,线代') + '&type=learn');
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    const ids = b.data.list.map((p) => p._id);
    assert.ok(ids.includes('r5'), '应含 learn 帖 r5');
    assert.ok(!ids.includes('r1'), '不应含 teach 帖 r1');
    assert.ok(!ids.includes('r2'), '不应含 teach 帖 r2');
    assert.ok(b.data.list.every((p) => p.type === 'learn'), '结果应全部为 learn');
  });

  await t('related?type=teach 只返回「我能教」→ 支撑「发布我想学后推荐能教帖」', async () => {
    const r = await req('GET', '/api/posts/related?tags=' + encodeURIComponent('高数') + '&type=teach');
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    const ids = b.data.list.map((p) => p._id);
    assert.ok(ids.includes('r1') && ids.includes('r2'), '应含 teach 帖 r1/r2');
    assert.ok(!ids.includes('r5'), '不应含 learn 帖 r5');
    assert.ok(b.data.list.every((p) => p.type === 'teach'), '结果应全部为 teach');
  });

  await t('related?type=bogus 非法类型返回 400', async () => {
    const r = await req('GET', '/api/posts/related?tags=' + encodeURIComponent('高数') + '&type=bogus');
    assert.strictEqual(r.statusCode, 400);
  });

  // ===== 广场意图 Tab 数量徽标（/api/posts/counts）=====

  await t('counts 只统计 passed，按 type 分别计数（all=teach+learn）', async () => {
    const b = jsonOf(await req('GET', '/api/posts/counts'));
    assert.strictEqual(b.code, 0);

    // 期望值直接由库内数据推导，避免写死数字随 fixture 变化而失效
    const passedRows = stores.posts.filter((p) => p.status === 'passed');
    const expTeach = passedRows.filter((p) => p.type === 'teach').length;
    const expLearn = passedRows.filter((p) => p.type === 'learn').length;

    assert.strictEqual(b.data.all, expTeach + expLearn, 'all 应等于 passed 总数');
    assert.strictEqual(b.data.teach, expTeach, 'teach 计数应为 passed 的教帖数');
    assert.strictEqual(b.data.learn, expLearn, 'learn 计数应为 passed 的学帖数');
    // pending/rejected 不得计入
    assert.ok(b.data.all < stores.posts.length, '未通过的帖子不应计入徽标');
  });

  await t('counts?category= 限定分类后只统计该分类', async () => {
    const cat = '学业辅导';
    const b = jsonOf(await req('GET', '/api/posts/counts?category=' + encodeURIComponent(cat)));
    assert.strictEqual(b.code, 0);
    const rows = stores.posts.filter((p) => p.status === 'passed' && p.category === cat);
    assert.strictEqual(b.data.all, rows.length, '分类内计数应为该分类 passed 数');
    assert.strictEqual(
      b.data.all,
      rows.filter((p) => p.type === 'teach').length + rows.filter((p) => p.type === 'learn').length,
      'all 应等于该分类下 teach + learn'
    );
    assert.ok(b.data.all <= jsonOf(await req('GET', '/api/posts/counts')).data.all, '分类计数不应超过全局');
  });

  await t('counts?category=bogus 非法分类返回 400', async () => {
    const r = await req('GET', '/api/posts/counts?category=bogus');
    assert.strictEqual(r.statusCode, 400);
  });

  await t('counts 不被 /api/posts/:id 抢匹配（路由顺序正确）', async () => {
    const b = jsonOf(await req('GET', '/api/posts/counts'));
    assert.strictEqual(b.code, 0);
    assert.ok(b.data && typeof b.data.teach === 'number', '应返回计数字段而非帖子详情');
  });

  // ===== Z-12 驳回重提 =====

  await t('POST /:id/republish 非作者 403', async () => {
    const r = await req('POST', '/api/posts/p2/republish', {}, { Authorization: 'Bearer ' + tokenB });
    assert.strictEqual(r.statusCode, 403);
  });

  await t('POST /:id/republish 非 rejected 状态 409', async () => {
    const r = await req('POST', '/api/posts/p1/republish', {}, { Authorization: 'Bearer ' + tokenA });
    assert.strictEqual(r.statusCode, 409);
  });

  await t('POST /:id/republish 作者 + rejected → pending（清驳回原因）', async () => {
    const r = await req('POST', '/api/posts/p2/republish', {}, { Authorization: 'Bearer ' + tokenA });
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.status, 'pending');
    const after = stores.posts.find((p) => p._id === 'p2');
    assert.strictEqual(after.status, 'pending');
    assert.strictEqual(after.rejectReason, '', '驳回原因应清空');
  });

  // ===== 收尾 =====
  console.log(`\n通过 ${passed} / 失败 ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
