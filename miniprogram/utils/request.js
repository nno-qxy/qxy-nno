/**
 * 请求封装
 * 统一：BaseURL、自动带 token、401 自动重登、错误 Toast、可选 loading
 * 不用 wx.cloud，一律 wx.request 调云函数 HTTP 访问服务
 */

const { API_BASE, DEBUG } = require('../config/index.js');

const TOKEN_KEY = 'skillswap_token';

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setToken(token) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
  } catch (e) {}
}

function clearToken() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
  } catch (e) {}
}

/** 401 重登：只触发一次，避免并发请求重复重登 */
let refreshing = null;
function relogin() {
  if (refreshing) return refreshing;
  refreshing = new Promise((resolve) => {
    wx.login({
      success: (r) => {
        rawRequest({
          url: '/api/auth/login',
          method: 'POST',
          data: { code: r.code },
          auth: false,
        })
          .then((data) => {
            setToken(data.token);
            resolve(data.token);
          })
          .catch(() => resolve(''));
      },
      fail: () => resolve(''),
    });
  }).then((t) => {
    refreshing = null;
    return t;
  });
  return refreshing;
}

function rawRequest({ url, method = 'GET', data = {}, auth = true, header = {} }) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, header);
  if (auth) {
    const t = getToken();
    if (t) h.Authorization = 'Bearer ' + t;
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + url,
      method,
      data,
      header: h,
      timeout: 15000,
      success: (res) => {
        if (DEBUG) console.log('[req]', method, url, res.statusCode, res.data);
        const body = res.data || {};
        if (res.statusCode === 401) {
          reject(Object.assign(new Error('登录已失效'), { code: 401 }));
          return;
        }
        if (typeof body.code === 'number') {
          if (body.code === 0) resolve(body.data);
          else reject(Object.assign(new Error(body.msg || '请求失败'), { code: body.code }));
          return;
        }
        reject(Object.assign(new Error('服务端返回异常'), { code: res.statusCode }));
      },
      fail: (err) => {
        reject(
          Object.assign(new Error((err && err.errMsg) || '网络异常，请检查网络'), { code: -1 })
        );
      },
    });
  });
}

/**
 * 业务请求：成功直接返回 data；失败弹 Toast 并 reject
 * @param {object} opt { url, method, data, auth, loading, silent }
 */
function request(opt) {
  const { loading = false, silent = false } = opt || {};
  if (loading) wx.showLoading({ title: '加载中', mask: true });
  const hide = () => loading && wx.hideLoading();

  const doIt = () => rawRequest(opt);

  return doIt()
    .then((data) => {
      hide();
      return data;
    })
    .catch(async (err) => {
      if (err.code === 401) {
        const t = await relogin();
        if (t) {
          try {
            const data = await rawRequest(opt);
            hide();
            return data;
          } catch (e2) {
            // fallthrough
          }
        }
      }
      hide();
      if (!silent) {
        wx.showToast({ title: err.message || '请求失败', icon: 'none', duration: 2000 });
      }
      throw err;
    });
}

module.exports = {
  request,
  get: (url, data, opt) => request(Object.assign({ url, method: 'GET', data }, opt)),
  post: (url, data, opt) => request(Object.assign({ url, method: 'POST', data }, opt)),
  getToken,
  setToken,
  clearToken,
  API_BASE,
};
