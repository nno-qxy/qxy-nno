/**
 * 极简 HTTP 路由（不引 Express：包更小、冷启动更快、资源点更省）
 * 支持 /api/posts/:id 形式的路径参数
 */

const { C, AppError } = require('./resp');

function match(pattern, pathname) {
  const pp = pattern.split('/').filter(Boolean);
  const sp = pathname.split('/').filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

function createRouter() {
  const table = [];

  function add(method, pattern, handler) {
    table.push({ method, pattern, handler });
  }

  /**
   * @param {object} req {method, path, query, body, headers}
   * @returns {Promise<any>} 业务响应对象
   */
  async function handle(req) {
    for (const r of table) {
      if (r.method !== req.method && r.method !== 'ANY') continue;
      const params = match(r.pattern, req.path);
      if (!params) continue;
      req.params = params;
      const out = await r.handler(req);
      return out;
    }
    throw new AppError(C.NOT_FOUND, `接口不存在: ${req.method} ${req.path}`);
  }

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    any: (p, h) => add('ANY', p, h),
    handle,
  };
}

module.exports = { createRouter };
