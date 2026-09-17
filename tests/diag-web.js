/** 一次性诊断：线上管理端当前加载的是哪个版本的前端产物 */
const https = require('https');

function get(url) {
  return new Promise((resolve) => {
    https
      .get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: d }));
      })
      .on('error', (e) => resolve({ error: e.message }));
  });
}

function pickJs(html) {
  const m = html.match(/assets\/[A-Za-z0-9_.-]+\.js/g) || [];
  return m;
}

(async () => {
  const HOST = 'nno-d2gspwvpl6c3c9f46-1479540360.ap-shanghai.app.tcloudbase.com';

  console.log('=== 1) HTTP 网关 /skillswap-web/ （用户实际访问入口）===');
  const a = await get('https://' + HOST + '/skillswap-web/');
  console.log('status', a.status, a.error || '');
  if (a.body) {
    console.log('cache-control:', a.headers && a.headers['cache-control']);
    console.log('引用的 JS:', pickJs(a.body).join(', ') || '(未匹配)');
  }

  console.log('\n=== 2) 静态托管域名 根路径 / ===');
  const b = await get('https://nno-d2gspwvpl6c3c9f46-1479540360.tcloudbaseapp.com/');
  console.log('status', b.status, b.error || '');
  if (b.body) console.log('引用的 JS:', pickJs(b.body).join(', ') || '(未匹配)');

  console.log('\n=== 3) 静态托管域名 /skillswap-web/ ===');
  const c = await get('https://nno-d2gspwvpl6c3c9f46-1479540360.tcloudbaseapp.com/skillswap-web/');
  console.log('status', c.status, c.error || '');
  if (c.body) console.log('引用的 JS:', pickJs(c.body).join(', ') || '(未匹配)');

  console.log('\n=== 本地产物（应为最新）===');
  const fs = require('fs');
  const idx = fs.readFileSync(
    require('path').join(__dirname, '..', 'cloudbase', 'functions', 'admin-static', 'dist', 'index.html'),
    'utf8'
  );
  console.log('admin-static/dist/index.html 引用:', pickJs(idx).join(', ') || '(未匹配)');

  console.log('\n=== 4) 静态托管 assets 可达性（判断部署是否完整）===');
  const base = 'https://nno-d2gspwvpl6c3c9f46-1479540360.tcloudbaseapp.com/assets/';
  for (const f of [
    'index-CV3EOdEH.js',      // 最新构建
    'HomeView-httqKOs5.js',   // 最新 HomeView（含 size:100）
    'index-_VJbvC1h.js',      // 上一次构建
    'HomeView-BC4gQAwu.js',   // 上一次 HomeView
  ]) {
    const r = await get(base + f);
    console.log(' ', f, '→', r.status, r.error || '');
  }

  console.log('\n=== 5) 静态托管资源是否含新逻辑（size=100）===');
  const hv = await get(base + 'HomeView-httqKOs5.js');
  if (hv.body) {
    console.log('HomeView-httqKOs5.js 含 "size:100"?', /size:\s*100/.test(hv.body));
    console.log('HomeView-httqKOs5.js 含 "searchUsers"?', /searchUsers/.test(hv.body));
  }
})();
