/**
 * 统一响应与错误码
 * 业务响应体一律：{ code, msg, data }
 *   code = 0 表示成功，非 0 为业务错误
 */

const HTTP_BY_CODE = {
  0: 200,
  400: 400, // 参数错误
  401: 401, // 未登录 / token 失效
  403: 403, // 无权限（封禁 / 非管理员）
  404: 404, // 资源不存在
  409: 409, // 状态冲突（重复申请、状态不允许）
  422: 422, // 内容未通过校验（敏感词 / 内容安全）
  429: 429, // 操作过于频繁（管理员锁定）
  500: 500,
  501: 501, // 功能未实现（开发占位）
};

class AppError extends Error {
  constructor(code, msg, extra) {
    super(msg || 'error');
    this.code = code;
    this.httpStatus = HTTP_BY_CODE[code] || 500;
    if (extra) this.extra = extra;
  }
}

const C = {
  OK: 0,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONTENT_REJECTED: 422,
  TOO_MANY: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
};

function ok(data = null, msg = 'ok') {
  return { code: C.OK, msg, data };
}

function fail(code, msg, extra) {
  const body = { code, msg };
  if (extra !== undefined) body.data = extra;
  return body;
}

/** 把 handler 返回值/异常统一成 HTTP 响应 */
function toHttpResponse(body) {
  const code = body && typeof body.code === 'number' ? body.code : C.INTERNAL;
  return {
    statusCode: HTTP_BY_CODE[code] || 500,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

module.exports = { AppError, C, ok, fail, toHttpResponse };
