/**
 * skillswap-api · 业务 HTTP 云函数入口
 *
 * 触发方式：CloudBase「HTTP 访问服务」
 * 约定：event 内含 path / httpMethod / headers / queryStringParameters / body
 * 返回：{ statusCode, headers, body }（由 HTTP 访问服务转成 HTTP 响应）
 */

const { createRouter } = require('./lib/router');
const { AppError, C, ok, fail, toHttpResponse } = require('./lib/resp');
const config = require('./config');

const router = createRouter();

// 路由挂载（后续阶段逐个填充）
[].concat(
  require('./routes/auth'),
  require('./routes/users'),
  require('./routes/posts'),
  require('./routes/exchanges'),
  require('./routes/admin')
).forEach((r) => {
  if (r.method === 'ANY') router.any(r.path, r.handler);
  else if (r.method === 'GET') router.get(r.path, r.handler);
  else router.post(r.path, r.handler);
});

/**
 * 路径归一化：兼容 HTTP 访问服务是否带上函数名前缀
 *   /skillswap-api/api/health  → /api/health
 *   /api/health                → /api/health
 *   /health                    → /api/health
 */
function normalizePath(rawPath) {
  let p = String(rawPath || '/');
  p = p.replace(/^\/skillswap-api/, '');
  if (p === '' || p === '/') p = '/api/health';
  if (!p.startsWith('/api')) p = '/api' + p;
  if (p === '/api') p = '/api/health';
  return p.replace(/\/+$/, '') || '/api/health';
}

/** 健康检查：阶段 0 联通性验证用，同时回显配置项是否已就绪（不回显值） */
router.get('/api/health', () =>
  ok({
    service: 'skillswap-api',
    time: new Date().toISOString(),
    node: process.version,
    envId: process.env.TCB_ENV || '(由运行时注入)',
    configured: {
      WX_APPID: !!config.WX_APPID,
      WX_SECRET: !!config.WX_SECRET,
      TOKEN_SECRET: !!config.TOKEN_SECRET,
      ADMIN_PASS_HASH: !!config.ADMIN_PASS_HASH,
      TMS: config.isTmsEnabled(),
      SANDBOX: config.isSandbox(),
    },
    routes: [
      'POST /api/auth/login', 'GET /api/auth/me', 'POST /api/auth/profile',
      'POST /api/auth/test-login(sandbox)',
      'GET /api/posts', 'GET /api/posts/mine', 'GET /api/posts/related',
      'GET /api/posts/counts', 'GET /api/posts/tags', 'GET /api/posts/:id/reviews',
      'GET /api/posts/:id',
      'POST /api/posts', 'POST /api/posts/:id/republish',
      'GET /api/users/:openid/profile', 'GET /api/users/:openid/reviews',
      'POST /api/exchanges', 'GET /api/exchanges/received',
      'POST /api/exchanges/:id/confirm', 'POST /api/exchanges/:id/reject',
      'POST /api/exchanges/:id/start', 'POST /api/exchanges/:id/cancel-start',
      'POST /api/exchanges/:id/cancel',
      'GET /api/exchanges', 'GET /api/exchanges/:id',
      'POST /api/exchanges/:id/complete', 'POST /api/exchanges/:id/evaluate',
      'POST /api/admin/login', 'GET /api/admin/stats', 'GET /api/admin/posts',
      'POST /api/admin/posts/:id/ai-audit', 'POST /api/admin/posts/:id/review',
      'POST /api/admin/posts/:id/takedown',
      'GET /api/admin/users', 'GET /api/admin/users/:openid',
      'POST /api/admin/users/:openid/ban', 'POST /api/admin/seed',
    ],
  })
);

function parseBody(event) {
  if (event.body == null || event.body === '') return {};
  let raw = event.body;
  if (event.isBase64Encoded) {
    try {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    } catch (e) {
      return {};
    }
  }
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    const params = {};
    raw.split('&').forEach((kv) => {
      if (!kv) return;
      const i = kv.indexOf('=');
      const k = i < 0 ? kv : kv.slice(0, i);
      const v = i < 0 ? '' : kv.slice(i + 1);
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    });
    return params;
  }
}

exports.main = async function (event = {}) {
  const method = (event.httpMethod || event.method || 'GET').toUpperCase();

  // CORS 预检
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: '',
    };
  }

  const req = {
    method,
    rawPath: event.path || '/',
    path: normalizePath(event.path),
    query: event.queryStringParameters || event.query || {},
    headers: event.headers || {},
    body: parseBody(event),
  };

  try {
    const body = await router.handle(req);
    return toHttpResponse(body && typeof body.code === 'number' ? body : ok(body));
  } catch (e) {
    if (e instanceof AppError) {
      const b = fail(e.code, e.message, e.extra);
      return toHttpResponse(b);
    }
    console.error('[skillswap-api] 未处理异常', e);
    return toHttpResponse(fail(C.INTERNAL, e && e.message ? e.message : '服务器内部错误'));
  }
};
