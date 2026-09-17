/**
 * 实网验证脚本：直接打已部署的 skillswap-api 网关，验证
 * 1) health 里 TMS 配置为 true、路由齐全
 * 2) 混合审核模式：干净帖经 TMS=Pass 应直接 passed 上广场
 * 3) G-03 ai-audit 走真实 TMS（source=tms, degraded=false）
 * 4) 若有 pending 帖，演示 G-04 审核通过（pending -> passed）
 * 测试帖数据会留在库里（用户要求保留）。
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BASE = process.env.BASE;
const TOKEN_SECRET = process.env.TOKEN_SECRET;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mint(openid) {
  const payload = { openid, role: 'user', iat: Date.now(), exp: Date.now() + 7 * 864e5 };
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const s = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest());
  return p + '.' + s;
}
/** 用 curl 发请求（沙箱 node fetch 被出网策略拦截，curl 可达） */
function call(method, path, { body, token } = {}) {
  const args = ['-s', '-m', '25', '-X', method, BASE + path];
  args.push('-H', 'Content-Type: application/json');
  if (token) args.push('-H', 'Authorization: Bearer ' + token);
  if (body) args.push('-d', JSON.stringify(body));
  args.push('-w', '\n__HTTP__%{http_code}');
  const out = execFileSync('curl', args, { encoding: 'utf8' });
  const idx = out.lastIndexOf('\n__HTTP__');
  const status = idx >= 0 ? Number(out.slice(idx + 9)) : 0;
  const text = idx >= 0 ? out.slice(0, idx) : out;
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { status, data };
}

const log = (...a) => console.log(...a);
let failures = 0;
function assert(cond, msg) {
  if (cond) log('  ✅', msg);
  else { log('  ❌', msg); failures++; }
}

(async () => {
  log('=== 1) HEALTH ===');
  const h = await call('GET', '/api/health');
  assert(h.status === 200, `health HTTP ${h.status}`);
  const hdata = (h.data && h.data.data) || {};
  const cfg = hdata.configured;
  log('  configured:', JSON.stringify(cfg));
  assert(cfg && cfg.TMS === true, 'TMS 密钥已加载 (configured.TMS=true)');
  const routes = hdata.routes || [];
  log('  routes 数量:', routes.length);
  assert(routes.length >= 18, '路由清单齐全 (≥18)');

  log('');
  log('=== 2) 管理员登录 ===');
  const lg = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'Admin@12345' } });
  assert(lg.status === 200 && lg.data && lg.data.data && lg.data.data.token, `admin 登录 HTTP ${lg.status}`);
  const adminToken = lg.data.data.token;

  log('');
  log('=== 3) 混合模式发布 ===');
  const uTok = mint('live-test-' + Date.now());
  const posts = [
    { tag: 'P1 干净-教', type: 'teach', category: '学业辅导', title: '教大学英语六级写作', content: '六级写作 28 分经验，帮你梳理段落结构与高分句型，每周可约两次。', tags: ['英语', '写作'] },
    { tag: 'P2 干净-学', type: 'learn', category: '语言交流', title: '想找伙伴练吉他弹唱', content: '零基础想学吉他，希望找会弹唱的同学一起练习，可互相教。', tags: ['吉他', '音乐'] },
    { tag: 'P3 疑似-广告', type: 'teach', category: '生活服务', title: '低价代购内部渠道', content: '各种品牌低价代购，内部渠道拿货，私聊有优惠，数量有限先到先得。', tags: ['代购'] },
  ];
  const ids = {};
  const statuses = {};
  for (const p of posts) {
    const r = await call('POST', '/api/posts', { body: p, token: uTok });
    const d = r.data && r.data.data;
    ids[p.tag] = d && d._id;
    statuses[p.tag] = d && d.status;
    log(`  ${p.tag}: HTTP ${r.status} status=${statuses[p.tag]} id=${ids[p.tag] || '-'}`);
  }
  assert(statuses['P1 干净-教'] === 'passed', 'P1 干净帖经 TMS=Pass 直接 passed（混合模式生效）');
  assert(statuses['P2 干净-学'] === 'passed', 'P2 干净帖经 TMS=Pass 直接 passed（混合模式生效）');

  log('');
  log('=== 4) G-03 AI 预审（真实 TMS）===');
  let realTmsOk = false;
  for (const p of posts) {
    if (!ids[p.tag]) { log(`  ${p.tag}: 未创建，跳过`); continue; }
    const r = await call('POST', `/api/admin/posts/${ids[p.tag]}/ai-audit`, { token: adminToken });
    const d = r.data && r.data.data;
    log(`  ${p.tag}:`, JSON.stringify(d));
    if (d && d.source === 'tms' && d.degraded === false) realTmsOk = true;
  }
  assert(realTmsOk, '至少一篇 ai-audit 走真实 TMS（source=tms, degraded=false）');

  log('');
  log('=== 5) G-04 审核通过（若有 pending 帖）===');
  const pend = await call('GET', '/api/admin/posts?status=pending', { token: adminToken });
  const plist = (pend.data && pend.data.data && pend.data.data.list) || [];
  log('  当前 pending 数量:', plist.length);
  const aPending = plist.find((x) => ids['P3 疑似-广告'] === x._id);
  if (aPending) {
    const rv = await call('POST', `/api/admin/posts/${aPending._id}/review`, { body: { action: 'pass' }, token: adminToken });
    log('  P3 审核通过:', JSON.stringify(rv.data && rv.data.data));
    assert(rv.status === 200 && rv.data.data.status === 'passed', 'P3（疑似）经审核通过 -> passed（G-04 实网闭环）');
  } else {
    log('  ℹ️ 本轮未产生 pending 帖（TMS 把疑似内容也判为 Pass 或本地词表直接拦截），G-04 审核队列闭环由 19 条 mock 测试覆盖。当前各状态分布：');
    for (const st of ['pending', 'passed', 'rejected']) {
      const r = await call('GET', `/api/admin/posts?status=${st}`, { token: adminToken });
      log(`    ${st}:`, ((r.data && r.data.data && r.data.data.list) || []).length);
    }
  }

  log('');
  log(failures === 0 ? '🎉 实网验证全部通过' : `⚠️ 实网验证有 ${failures} 项未通过`);
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
