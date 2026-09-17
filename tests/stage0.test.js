/**
 * 阶段 0 逻辑层冒烟测试
 * 用内存 mock 替代 @cloudbase/node-sdk 与 https，直接在 Node 里跑通：
 *   /api/health、CORS 预检、登录建号、token 校验、/auth/me、资料保存、404、401
 * 运行：node tests/stage0.test.js
 */

const assert = require('assert');
const Module = require('module');

// ---------- 1. mock 文档型数据库 ----------
const stores = { users: [], posts: [], exchanges: [], configs: [] };
let seq = 0;

function matchFilter(f) {
  return (d) => Object.keys(f || {}).every((k) => d[k] === f[k]);
}

function makeCollection(name) {
  const store = stores[name];
  let filter = {};
  const api = {
    where(f) { filter = f || {}; return api; },
    limit() { return api; },
    orderBy() { return api; },
    field() { return api; },
    skip() { return api; },
    async get() { return { data: store.filter(matchFilter(filter)).map((d) => JSON.parse(JSON.stringify(d))) }; },
    async count() { return { total: store.filter(matchFilter(filter)).length }; },
    async add(doc) {
      const d = Object.assign({ _id: 'id_' + ++seq }, doc);
      store.push(d);
      return { _id: d._id };
    },
    async update(patch) {
      let n = 0;
      store.forEach((d) => {
        if (matchFilter(filter)(d)) { Object.assign(d, JSON.parse(JSON.stringify(patch))); n++; }
      });
      return { stats: { updated: n } };
    },
  };
  return api;
}

const mockSdk = {
  SYMBOL_CURRENT_ENV: 'mock-env',
  init() {
    return { database: () => ({ collection: (name) => makeCollection(name), command: {} }) };
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
      // 真实 https.get 是异步回调，这里同步调用即可满足测试
      process.nextTick(() => cb(fakeRes(body)));
      return { on() {}, destroy() {}, setTimeout() {} };
    }
    throw new Error('未预期的 https 请求: ' + u);
  },
  request() { throw new Error('本测试不覆盖 TMS'); },
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
process.env.TOKEN_SECRET = 'test_token_secret';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS_HASH = 'x';
delete process.env.TMS_SECRET_ID;
delete process.env.TMS_SECRET_KEY;

const { main } = require('../cloudbase/functions/skillswap-api/index.js');

// ---------- 4. 测试工具 ----------
let passed = 0, failed = 0;
function req(method, path, body, headers) {
  return main({
    httpMethod: method,
    path,
    headers: headers || {},
    queryStringParameters: {},
    body: body == null ? '' : JSON.stringify(body),
    isBase64Encoded: false,
  });
}
function jsonOf(res) { return JSON.parse(res.body); }

async function t(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' → ' + e.message); failed++; }
}

(async () => {
  console.log('\n[阶段0] skillswap-api 逻辑层冒烟测试\n');

  await t('GET /api/health 返回 ok 且回显配置就绪状态', async () => {
    const res = await req('GET', '/api/health');
    assert.strictEqual(res.statusCode, 200);
    const b = jsonOf(res);
    assert.strictEqual(b.code, 0, 'code 应为 0');
    assert.strictEqual(b.data.configured.WX_APPID, true);
    assert.strictEqual(b.data.configured.TOKEN_SECRET, true);
    assert.strictEqual(b.data.configured.TMS, false, '未配置密钥时 TMS 应为 false');
  });

  await t('路径归一化：/skillswap-api/api/health 与 /health 都能命中', async () => {
    const a = jsonOf(await req('GET', '/skillswap-api/api/health'));
    const b = jsonOf(await req('GET', '/health'));
    assert.strictEqual(a.code, 0);
    assert.strictEqual(b.code, 0);
  });

  await t('OPTIONS 预检返回 204 且带 CORS 头', async () => {
    const res = await req('OPTIONS', '/api/health');
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], '*');
  });

  let token = '';
  await t('POST /api/auth/login 首次登录自动建号并返回 token', async () => {
    const res = await req('POST', '/api/auth/login', { code: 'CODE_A' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const b = jsonOf(res);
    assert.strictEqual(b.code, 0);
    assert.ok(b.data.token, '应返回 token');
    assert.strictEqual(b.data.user.openid, 'openid_from_CODE_A');
    assert.strictEqual(b.data.user.profileCompleted, false, '首次登录资料未完善');
    token = b.data.token;
  });

  await t('users 集合确实写入了一条记录', async () => {
    assert.strictEqual(stores.users.length, 1);
    assert.strictEqual(stores.users[0]._openid, 'openid_from_CODE_A');
    assert.strictEqual(stores.users[0].status, 'active');
  });

  await t('重复登录不产生重复用户', async () => {
    await req('POST', '/api/auth/login', { code: 'CODE_A' });
    assert.strictEqual(stores.users.length, 1, '用户数应仍为 1');
  });

  await t('GET /api/auth/me 带 token 可读取本人信息', async () => {
    const res = await req('GET', '/api/auth/me', null, { Authorization: 'Bearer ' + token });
    const b = jsonOf(res);
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.data.user.openid, 'openid_from_CODE_A');
  });

  await t('GET /api/auth/me 无 token 返回 401', async () => {
    const res = await req('GET', '/api/auth/me');
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(jsonOf(res).code, 401);
  });

  await t('篡改 token 返回 401', async () => {
    const bad = token.slice(0, -3) + 'xxx';
    const res = await req('GET', '/api/auth/me', null, { Authorization: 'Bearer ' + bad });
    assert.strictEqual(res.statusCode, 401);
  });

  await t('POST /api/auth/profile 保存学号姓名，profileCompleted 变 true', async () => {
    const res = await req('POST', '/api/auth/profile', {
      studentId: '2023010101', realName: '齐明', grade: '大三',
      major: '计算机科学与技术', tags: ['考研', '高数'], contact: '138****0001',
    }, { Authorization: 'Bearer ' + token });
    const b = jsonOf(res);
    assert.strictEqual(b.code, 0, b.msg);
    assert.strictEqual(b.data.user.profileCompleted, true);
    assert.strictEqual(stores.users[0].studentId, '2023010101');
  });

  await t('学号格式非法（字母/过短）返回 400', async () => {
    const res = await req('POST', '/api/auth/profile', { studentId: 'abc' },
      { Authorization: 'Bearer ' + token });
    assert.strictEqual(res.statusCode, 400);
    assert.ok(jsonOf(res).msg.includes('学号'));
  });

  await t('微信返回 errcode 时登录失败且不建号', async () => {
    const before = stores.users.length;
    const res = await req('POST', '/api/auth/login', { code: 'BAD_CODE' });
    assert.strictEqual(res.statusCode, 400, '无效 code 应映射为 400 而非 500');
    assert.ok(jsonOf(res).msg.includes('登录凭证'), '提示应可读: ' + jsonOf(res).msg);
    assert.strictEqual(stores.users.length, before);
  });

  await t('缺少 code 返回 400', async () => {
    const res = await req('POST', '/api/auth/login', {});
    assert.strictEqual(res.statusCode, 400);
  });

  await t('未实现的接口返回 404 且带清晰路径', async () => {
    const res = await req('GET', '/api/not-exist');
    assert.strictEqual(res.statusCode, 404);
    assert.ok(jsonOf(res).msg.includes('/api/not-exist'));
  });

  console.log('\n结果：通过 ' + passed + ' 项，失败 ' + failed + ' 项\n');
  process.exit(failed ? 1 : 0);
})();
