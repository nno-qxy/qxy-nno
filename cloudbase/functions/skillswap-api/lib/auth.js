/**
 * 自签 token：HMAC-SHA256，格式 base64url(payload).base64url(sig)
 * payload = { openid, role, iat, exp }
 * 无状态，密钥存云函数环境变量 TOKEN_SECRET
 */

const crypto = require('crypto');
const config = require('../config');

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(payloadStr) {
  return crypto.createHmac('sha256', config.TOKEN_SECRET).update(payloadStr).digest();
}

function issue(payload) {
  const full = Object.assign(
    { iat: Date.now(), exp: Date.now() + config.TOKEN_TTL_MS, role: 'user' },
    payload
  );
  const p = b64url(JSON.stringify(full));
  const s = b64url(hmac(p));
  return `${p}.${s}`;
}

/** 校验成功返回 payload，失败返回 null */
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, s] = parts;
  if (!config.TOKEN_SECRET) return null;
  const expect = b64url(hmac(p));
  const a = Buffer.from(s);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(p).toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/** 从 headers / query 中提取 token */
function extract(req) {
  const h = req.headers || {};
  const raw =
    h.Authorization || h.authorization || (req.query && req.query.token) || '';
  if (!raw) return '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

/** 中间件：要求已登录，结果挂 req.auth */
function requireAuth(req) {
  const payload = verify(extract(req));
  if (!payload || !payload.openid) {
    const { AppError, C } = require('./resp');
    throw new AppError(C.UNAUTHORIZED, '登录已失效，请重新进入小程序');
  }
  req.auth = payload;
  return payload;
}

/** 中间件：要求管理员 */
function requireAdmin(req) {
  const payload = requireAuth(req);
  if (payload.role !== 'admin') {
    const { AppError, C } = require('./resp');
    throw new AppError(C.FORBIDDEN, '需要管理员权限');
  }
  return payload;
}

module.exports = { issue, verify, extract, requireAuth, requireAdmin };
