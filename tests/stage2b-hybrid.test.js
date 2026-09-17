/**
 * 阶段 2b 逻辑层测试：混合审核模式下的发布状态判定
 * 仅覆盖「TMS 已配置」时的三种结果分支：
 *   - TMS=Pass  → status=passed（直接上广场，无需人工）
 *   - TMS=Review → status=pending（进人工审核队列）
 *   - TMS=Block  → 422 内容安全拦截
 *   - 驳回重提（republish）在 TMS=Pass 时同样直接 passed
 * 运行：node tests/stage2b-hybrid.test.js
 *
 * 说明：config.isTmsEnabled() 在 require 时缓存环境变量，因此本文件在
 * install 时即注入 TMS 密钥（opt.tms 真值），无法中途切换 env 开关。
 * 「TMS 未配置→降级为 pending」分支由 stage2.test.js 覆盖。
 */

const assert = require('assert');
const path = require('path');
const { install } = require('./helpers/mock-cloudbase');

const API_DIR = path.resolve(__dirname, '../cloudbase/functions/skillswap-api');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' → ' + (e && e.stack || e)); failed++; }
}
function clearApiCache() {
  Object.keys(require.cache).forEach((k) => { if (k.startsWith(API_DIR)) delete require.cache[k]; });
}
function loadApi() { clearApiCache(); return require(path.join(API_DIR, 'index.js')).main; }
function jsonOf(res) { return JSON.parse(res.body); }

(async () => {
  console.log('\n[阶段2b] skillswap-api · 混合审核模式 发布状态判定\n');

  // 安装时即注入 TMS 密钥，使 config.isTmsEnabled()=true；默认 TMS 返回 Pass
  const mock = install({ adminPassHash: 'x', tms: { Suggestion: 'Pass', Label: 'Normal', Score: 0 } });
  let main = loadApi();

  function req(method, p, body, headers) {
    const h = Object.assign({}, headers);
    let path = p; let qp = {};
    if (p.includes('?')) {
      const [pp, qs] = p.split('?');
      path = pp;
      qs.split('&').filter(Boolean).forEach((kv) => {
        const [k, v] = kv.split('=');
        qp[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return main({ httpMethod: method, path, headers: h, queryStringParameters: qp, body: body == null ? '' : JSON.stringify(body), isBase64Encoded: false });
  }
  async function loginAs(code) { const r = jsonOf(await req('POST', '/api/auth/login', { code })); return r.data.token; }

  const token = await loginAs('USER_A');
  const hdr = { Authorization: 'Bearer ' + token };
  // 发布前资料完整性校验（姓名+学号）上线后，测试用户需补齐资料
  mock.stores.users.forEach((u) => {
    if (u._openid === 'openid_from_USER_A') { u.realName = '小A'; u.studentId = '20210001'; }
  });
  const goodPost = { type: 'teach', category: '学业辅导', title: '教英语口语陪练', content: '雅思 7 分，可以陪你练口语 30 分钟', tags: ['英语', '口语'] };

  await t('TMS=Pass → 发布状态 passed（直接上广场，免人工）', async () => {
    mock.setTms({ Suggestion: 'Pass', Label: 'Normal', Score: 90 });
    const r = await req('POST', '/api/posts', goodPost, hdr);
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0, '应成功');
    assert.strictEqual(b.data.status, 'passed', '混合模式：TMS=Pass 应直接 passed');
  });

  await t('TMS=Review → 发布状态 pending（进人工审核队列）', async () => {
    mock.setTms({ Suggestion: 'Review', Label: 'Suspect', Score: 60 });
    const r = await req('POST', '/api/posts', goodPost, hdr);
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0, '应成功');
    assert.strictEqual(b.data.status, 'pending', 'TMS=Review 应进人工审核');
  });

  await t('TMS=Block → 发布被内容安全拦截（422）', async () => {
    mock.setTms({ Suggestion: 'Block', Label: 'Porn', Score: 99 });
    const r = await req('POST', '/api/posts', goodPost, hdr);
    assert.strictEqual(r.statusCode, 422, 'TMS=Block 应被拦截');
  });

  await t('republish 驳回帖 + TMS=Pass → 直接 passed（混合模式对重提同样生效）', async () => {
    // 直接写库一篇 rejected 帖（模拟之前被驳回）
    mock.stores.posts.push({
      _id: 'rej1', title: '教英语', type: 'teach', category: '学业辅导',
      content: '陪你练口语', tags: ['英语'],
      authorId: 'openid_from_USER_A', status: 'rejected', rejectReason: 'x',
      createTime: Date.now(), updateTime: Date.now(),
    });
    mock.setTms({ Suggestion: 'Pass', Label: 'Normal', Score: 90 });
    const r = await req('POST', '/api/posts/rej1/republish', {}, hdr);
    const b = jsonOf(r);
    assert.strictEqual(b.code, 0, '重提应成功');
    assert.strictEqual(b.data.status, 'passed', '重提且 TMS=Pass 应直接 passed');
  });

  console.log(`\n通过 ${passed} / 失败 ${failed}\n`);
  process.exit(failed ? 1 : 0);
})();
