/**
 * admin-static · 静态资源 HTTP 云函数
 * 用途：包月体验版无静态网站托管，用本函数托管 Web 管理端构建产物
 * 访问：https://<默认域名>/skillswap-web/
 * 约定：dist/ 由 admin-web 构建后拷入，随函数一起部署
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');

// 网关可能透传的路径前缀，统一剥掉（关闭路径透传时通常已剥好，这里做兜底）
const STRIP_PREFIX = /^\/(?:admin-static|skillswap-web|web-static)(?=\/|$)/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null; // 防目录穿越
  return full;
}

function readFile(full) {
  return new Promise((resolve) => {
    fs.readFile(full, (err, buf) => (err ? resolve(null) : resolve(buf)));
  });
}

function resp(statusCode, headers, body, isBase64 = false) {
  return { statusCode, headers, body, isBase64Encoded: isBase64 };
}

exports.main = async function (event = {}) {
  let urlPath = String(event.path || '/');
  urlPath = urlPath.replace(STRIP_PREFIX, ''); // 去掉函数名/路由前缀
  if (urlPath === '' || urlPath === '/') urlPath = '/index.html';

  const target = safeJoin(DIST, urlPath);
  if (!target) return resp(403, { 'Content-Type': 'text/plain' }, 'Forbidden');

  let buf = await readFile(target);
  if (buf == null) {
    // hash 路由回落：任何未匹配路径都返回 index.html
    buf = await readFile(path.join(DIST, 'index.html'));
    if (buf == null) {
      return resp(
        200,
        { 'Content-Type': 'text/html; charset=utf-8' },
        '<!DOCTYPE html><meta charset="utf-8"><title>管理端未部署</title>' +
          '<div style="font-family:-apple-system,PingFang SC,Microsoft YaHei;padding:40px">' +
          '<h2>管理端静态资源未部署</h2><p>请先执行 <code>npm run build</code>，' +
          '把 dist/ 拷入 cloudbase/functions/admin-static/dist/ 后重新部署本函数。</p></div>'
      );
    }
    urlPath = '/index.html';
  }

  const ext = path.extname(urlPath).toLowerCase();
  const isHashed = /-[A-Za-z0-9_]{8,}\./.test(path.basename(urlPath));
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // 带 hash 的资源长缓存，index.html 不缓存，减少函数调用与流量
    'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const isBinary = !/^(text|application\/(javascript|json))|image\/svg/.test(headers['Content-Type']);
  return resp(200, headers, isBinary ? buf.toString('base64') : buf.toString('utf8'), isBinary);
};
