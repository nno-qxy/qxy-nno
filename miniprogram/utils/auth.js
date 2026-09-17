/**
 * 登录态管理
 * 链路：wx.login() → code → 云函数 code2Session → openid → 自签 token
 * token 存 storage，请求自动带上（见 utils/request.js）
 */

const { post, get, setToken, getToken, clearToken } = require('./request.js');

const USER_KEY = 'skillswap_user';

function getCachedUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch (e) {
    return null;
  }
}

/**
 * 当前登录用户的 openid。
 * ⚠️ 登录接口（/api/auth/login、/api/auth/test-login、/api/auth/me）下发的是 `openid`
 * （后端 userService.publicFields 把数据库的 `_openid` 映射成了 `openid`），
 * 所以这里两种字段名都兼容 —— 只读 `_openid` 会恒为空串，导致所有「我是否已 X」的判断失效。
 */
function getMyOpenid() {
  const u = getCachedUser() || {};
  return u.openid || u._openid || '';
}

function cacheUser(u) {
  try {
    wx.setStorageSync(USER_KEY, u);
  } catch (e) {}
}

let loginPromise = null;

/** 静默登录：已有 token 且缓存了用户则直接返回缓存，不发请求 */
function ensureLogin() {
  if (loginPromise) return loginPromise;
  const token = getToken();
  const cached = getCachedUser();
  if (token && cached) return Promise.resolve(cached);

  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success: (r) => {
        if (!r.code) {
          reject(new Error('wx.login 未返回 code'));
          return;
        }
        post('/api/auth/login', { code: r.code }, { auth: false, silent: true })
          .then((data) => {
            setToken(data.token);
            cacheUser(data.user);
            resolve(data.user);
          })
          .catch(reject);
      },
      fail: () => reject(new Error('wx.login 失败')),
    });
  }).finally(() => {
    loginPromise = null;
  });

  return loginPromise;
}

/** 强制拉取最新用户信息（如保存资料后刷新） */
function refreshUser() {
  return get('/api/auth/me', {}, { auth: true, silent: true }).then((data) => {
    cacheUser(data.user);
    return data.user;
  });
}

function clearAuth() {
  clearToken();
  try {
    wx.removeStorageSync(USER_KEY);
  } catch (e) {}
}

/**
 * 切换测试账号（仅沙盒模式后端可用）：用一个 uid 登录为 sandbox:<uid> 的测试身份，
 * 绕过真实微信，便于单设备模拟多账号跑通交换全链路。返回登录后的用户对象。
 * 调用方应随后 reLaunch 到首页让各页面按新身份刷新。
 */
async function switchTestAccount(uid) {
  clearAuth();
  const data = await post('/api/auth/test-login', { uid }, { auth: false, silent: true });
  setToken(data.token);
  cacheUser(data.user);
  return data.user;
}

module.exports = {
  ensureLogin, refreshUser, getCachedUser, getMyOpenid, cacheUser, clearAuth,
  switchTestAccount, getToken,
};
