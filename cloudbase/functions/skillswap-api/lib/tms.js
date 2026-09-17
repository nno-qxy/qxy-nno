/**
 * 腾讯云文本内容安全（TMS）· 手动 TC3-HMAC-SHA256 签名
 * 不引 tencentcloud-sdk-nodejs（SDK 体积大、冷启动慢、资源点更贵）
 * 约定：本模块任何异常都"失败开放（降级）"，由调用方决定是否放行
 */

const crypto = require('crypto');
const https = require('https');
const config = require('../config');

const SERVICE = 'tms';
const HOST = 'tms.tencentcloudapi.com';
const ACTION = 'TextModeration';
const VERSION = '2020-12-29';

function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8');
}

function buildAuth(payloadStr, ts) {
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json\nhost:${HOST}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256hex(payloadStr),
  ].join('\n');

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    ts,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join('\n');

  const secretDate = hmac('TC3' + config.TMS_SECRET_KEY, date).digest();
  const secretService = hmac(secretDate, SERVICE).digest();
  const secretSigning = hmac(secretService, 'tc3_request').digest();
  const signature = hmac(secretSigning, stringToSign).digest('hex');

  return `TC3-HMAC-SHA256 Credential=${config.TMS_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function post(payloadStr, ts) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        method: 'POST',
        path: '/',
        timeout: 6000,
        headers: {
          'Content-Type': 'application/json',
          Host: HOST,
          'X-TC-Action': ACTION,
          'X-TC-Version': VERSION,
          'X-TC-Region': config.TMS_REGION,
          'X-TC-Timestamp': String(ts),
          Authorization: buildAuth(payloadStr, ts),
          'Content-Length': Buffer.byteLength(payloadStr),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error('TMS 返回无法解析: ' + buf.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('TMS 请求超时')));
    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
}

/**
 * @returns {Promise<{enabled:boolean, suggestion:'Pass'|'Review'|'Block'|'Unknown', label:string, score:number, degraded:boolean, reason?:string}>}
 */
async function checkText(text) {
  if (!config.isTmsEnabled()) {
    return { enabled: false, suggestion: 'Unknown', label: '', score: 0, degraded: true, reason: '未配置 TMS 密钥' };
  }
  const ts = Math.floor(Date.now() / 1000);
  const payloadStr = JSON.stringify({
    Content: Buffer.from(String(text || ''), 'utf8').toString('base64'),
  });
  try {
    const res = await post(payloadStr, ts);
    const data = (res && res.Response) || {};
    if (data.Error) {
      return {
        enabled: true,
        suggestion: 'Unknown',
        label: '',
        score: 0,
        degraded: true,
        reason: `TMS 错误: ${data.Error.Code} ${data.Error.Message}`,
      };
    }
    return {
      enabled: true,
      suggestion: data.Suggestion || 'Unknown',
      label: data.Label || '',
      score: typeof data.Score === 'number' ? data.Score : 0,
      degraded: false,
    };
  } catch (e) {
    return {
      enabled: true,
      suggestion: 'Unknown',
      label: '',
      score: 0,
      degraded: true,
      reason: e && e.message ? e.message : String(e),
    };
  }
}

module.exports = { checkText };
