/**
 * 微信 code2Session：只依赖 Node 内置 https，不外引 SDK
 * code 5 分钟有效且只能用一次，失败时返回明确错误码便于定位
 */

const https = require('https');
const { AppError, C } = require('./resp');

// 微信 errcode → 业务码（避免一律 500，端侧才能给出正确提示）
const ERR_MAP = {
  40029: { code: C.BAD_REQUEST, msg: '登录凭证无效，请重新进入小程序' },
  40163: { code: C.BAD_REQUEST, msg: '登录凭证已被使用，请重新进入小程序' },
  45011: { code: C.TOO_MANY, msg: '登录过于频繁，请稍后再试' },
  '-1': { code: C.INTERNAL, msg: '微信服务暂时不可用，请稍后重试' },
};

function requestJson(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(new Error('微信接口返回无法解析: ' + buf.slice(0, 120)));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('code2Session 超时'));
    });
    req.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * @returns {Promise<{openid:string, sessionKey:string, unionid?:string}>}
 */
async function code2Session(appid, secret, code) {
  const url =
    'https://api.weixin.qq.com/sns/jscode2session?appid=' +
    encodeURIComponent(appid) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&js_code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code';

  const data = await requestJson(url);
  if (data.errcode) {
    const m = ERR_MAP[String(data.errcode)] || {
      code: C.INTERNAL,
      msg: '微信登录失败（' + data.errcode + '）',
    };
    throw new AppError(m.code, m.msg);
  }
  if (!data.openid) throw new AppError(C.INTERNAL, 'code2Session 未返回 openid');
  return { openid: data.openid, sessionKey: data.session_key || '', unionid: data.unionid || '' };
}

module.exports = { code2Session };
