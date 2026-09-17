/**
 * 统一请求封装
 * 说明：管理端与业务 API 共用同一个 CloudBase HTTP 访问服务域名，
 *      但路径前缀不同（/admin-static/ 与 /skillswap-api/），
 *      因此这里用绝对地址而非相对 /api —— 仍是同源，无跨域问题。
 */

/**
 * HTTP 网关默认域名（控制台 HTTP 网关 → 路由管理中确认）
 * 格式：<envId>-<创建时间戳>.ap-shanghai.app.tcloudbase.com
 * 注意：不是 <envId>.service.tcloudbase.com，也不是带 -c9f46 的中间串
 */
const DEFAULT_DOMAIN = 'nno-d2gspwvpl6c3c9f46-1479540360.ap-shanghai.app.tcloudbase.com';

export const API_BASE =
  import.meta.env.VITE_API_BASE || `https://${DEFAULT_DOMAIN}/skillswap-api`;

const TOKEN_KEY = 'skillswap_admin_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('网络异常，请检查网络后重试');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('服务端返回无法解析');
  }

  if (res.status === 401) {
    clearToken();
    throw new Error('登录已失效，请重新登录');
  }
  if (typeof data.code === 'number' && data.code !== 0) {
    throw new Error(data.msg || '请求失败');
  }
  return data.data;
}

export const get = (p, params) => {
  const qs = params
    ? '?' + Object.keys(params).filter((k) => params[k] !== '' && params[k] != null)
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&')
    : '';
  return request(p + qs, { method: 'GET' });
};

export const post = (p, body) => request(p, { method: 'POST', body });
