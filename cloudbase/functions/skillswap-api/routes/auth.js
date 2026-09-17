/**
 * 身份与用户：Z-01 微信授权登录、Z-02 学号绑定与个人信息维护
 */

const config = require('../config');
const { AppError, C, ok } = require('../lib/resp');
const { issue, requireAuth } = require('../lib/auth');
const { code2Session } = require('../lib/wx');
const { db, COLLECTIONS } = require('../lib/db');
const userService = require('../services/userService');

/**
 * POST /api/auth/login  body: { code }
 * 小程序端 wx.login() 拿到 code → 服务端换 openid → 首次自动建号 → 签发 token
 */
async function login(req) {
  const code = req.body && req.body.code;
  if (!code) throw new AppError(C.BAD_REQUEST, '缺少 code');
  if (!config.isWxEnabled()) {
    throw new AppError(C.INTERNAL, '服务端未配置 WX_APPID / WX_SECRET');
  }

  const { openid } = await code2Session(config.WX_APPID, config.WX_SECRET, String(code));
  const user = await userService.ensureUser(openid);
  if (user.status === 'banned') throw new AppError(C.FORBIDDEN, '账号已被封禁');

  const token = issue({ openid, role: user.role || 'user' });
  return ok({
    token,
    expiresIn: Math.floor(config.TOKEN_TTL_MS / 1000),
    user: userService.publicFields(user),
  });
}

/** GET /api/auth/me */
async function me(req) {
  requireAuth(req);
  const user = await userService.findByOpenid(req.auth.openid);
  if (!user) throw new AppError(C.UNAUTHORIZED, '用户不存在');
  return ok({ user: userService.publicFields(user) });
}

/**
 * POST /api/auth/test-login  body: { uid }
 * ⚠️ 仅 SANDBOX_MODE 开启时可用，上线前移除该环境变量即自动失效。
 * 用 uid 直接签发一个 openid=sandbox:<uid> 的测试 token，绕过真实微信登录，
 * 让单设备能模拟多个不同账号，跑通「真实」的多账号交换闭环（A 发帖→B 申请→A 确认→双方完成→互评）。
 * 返回的字段结构与 /api/auth/login 完全一致，前端可复用同一套登录态处理逻辑。
 */
async function testLogin(req) {
  if (!config.isSandbox()) {
    throw new AppError(C.FORBIDDEN, '测试登录仅在沙盒模式下可用');
  }
  const uid = String((req.body && req.body.uid) || '').trim();
  if (!/^[A-Za-z0-9_\-]{1,32}$/.test(uid)) {
    throw new AppError(C.BAD_REQUEST, 'uid 非法（字母/数字/下划线/-，长度 1-32）');
  }
  const openid = 'sandbox:' + uid;
  const user = await userService.ensureUser(openid);
  // 首次给默认昵称，便于在交换列表里区分账号；已有昵称则保留（用户自改过）
  if (!user.nickname) {
    await db(COLLECTIONS.USERS).where({ _openid: openid }).update({ nickname: uid, updateTime: Date.now() });
    user.nickname = uid;
  }
  const token = issue({ openid, role: user.role || 'user' });
  return ok({
    token,
    expiresIn: Math.floor(config.TOKEN_TTL_MS / 1000),
    user: userService.publicFields(user),
    sandbox: true,
  });
}

/** POST /api/auth/profile  保存/更新学号、姓名、年级、专业、标签、联系方式 */
async function saveProfile(req) {
  requireAuth(req);
  const user = await userService.saveProfile(req.auth.openid, req.body || {});
  return ok({ user }, '保存成功');
}

module.exports = [
  { method: 'POST', path: '/api/auth/login', handler: login },
  { method: 'POST', path: '/api/auth/test-login', handler: testLogin },
  { method: 'GET', path: '/api/auth/me', handler: me },
  { method: 'POST', path: '/api/auth/profile', handler: saveProfile },
];
