/**
 * 阶段 8 逻辑层冒烟测试：广场标签搜索（首页搜索框）
 * 覆盖：
 *   - GET /api/posts?keyword=     标签/标题/正文模糊匹配，与 type/category 叠加（AND）
 *   - GET /api/posts/counts?keyword=  意图 Tab 徽标跟随搜索词
 *   - GET /api/posts/tags         热门标签 Top N（次数降序、支持分类过滤、limit 上限）
 *   - 边界：空关键词、正则特殊字符、超长关键词、无结果
 *   - 回归：分页游标与关键词叠加
 * 运行：node tests/stage8-search.test.js
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

(async () => {
  console.log('\n[阶段8] skillswap-api · 广场标签搜索 冒烟测试\n');

  const mock = install({ adminPassHash: 'x' });
  const main = require(path.join(API_DIR, 'index.js')).main;

  function get(p, query) {
    return main({
      httpMethod: 'GET', path: p, headers: {},
      queryStringParameters: query || {}, body: '', isBase64Encoded: false,
    });
  }
  const json = (r) => JSON.parse(r.body);

  const now0 = Date.now();
  const oA = 'openid_s8_A';
  mock.stores.users.push({ _openid: oA, nickname: '小A', avatarColor: '#2B62E0' });
  mock.stores.posts.push(
    { _id: 's1', title: '高数期末突击', type: 'teach', category: '学业辅导', content: '微积分极限与导数', tags: ['高数', '期末'], authorId: oA, authorName: '小A', status: 'passed', createTime: now0 - 6000 },
    { _id: 's2', title: '想找人陪练口语', type: 'learn', category: '语言交流', content: '雅思口语 6 分冲 7', tags: ['英语', '口语'], authorId: oA, authorName: '小A', status: 'passed', createTime: now0 - 5000 },
    { _id: 's3', title: '吉他入门带练', type: 'teach', category: '文艺特长', content: '零基础和弦与扫弦', tags: ['吉他'], authorId: oA, authorName: '小A', status: 'passed', createTime: now0 - 4000 },
    { _id: 's4', title: '高数作业答疑', type: 'teach', category: '学业辅导', content: '线代也会一点', tags: ['高数'], authorId: oA, authorName: '小A', status: 'passed', createTime: now0 - 3000 },
    { _id: 's5', title: '待审的高数帖', type: 'teach', category: '学业辅导', content: 'x', tags: ['高数'], authorId: oA, authorName: '小A', status: 'pending', createTime: now0 - 2000 },
    { _id: 's6', title: '已下架的高数帖', type: 'teach', category: '学业辅导', content: 'x', tags: ['高数'], authorId: oA, authorName: '小A', status: 'offline', createTime: now0 - 1000 }
  );

  // ================= 列表：标签搜索 =================
  console.log('GET /api/posts?keyword=');

  await t('按标签命中（高数 → 2 条已上广场）', async () => {
    const b = json(await get('/api/posts', { keyword: '高数' }));
    assert.strictEqual(b.code, 0);
    const ids = b.data.list.map((p) => p._id).sort();
    assert.deepStrictEqual(ids, ['s1', 's4'], '实际 ' + JSON.stringify(ids));
  });

  await t('未上广场的帖子不参与搜索（pending / offline 被排除）', async () => {
    const b = json(await get('/api/posts', { keyword: '高数' }));
    assert.ok(b.data.list.every((p) => p.status === 'passed'));
    assert.ok(!b.data.list.some((p) => p._id === 's5' || p._id === 's6'));
  });

  await t('标题命中（「口语」同时命中标题与标签）', async () => {
    const b = json(await get('/api/posts', { keyword: '口语' }));
    assert.deepStrictEqual(b.data.list.map((p) => p._id), ['s2']);
  });

  await t('正文命中也算（「雅思」只在正文里）', async () => {
    const b = json(await get('/api/posts', { keyword: '雅思' }));
    assert.deepStrictEqual(b.data.list.map((p) => p._id), ['s2']);
  });

  await t('关键词与 type 叠加生效（AND，不是只认关键词）', async () => {
    const b = json(await get('/api/posts', { keyword: '高数', type: 'learn' }));
    assert.deepStrictEqual(b.data.list, [], '高数帖都是 teach，learn 应为空');
    const b2 = json(await get('/api/posts', { keyword: '高数', type: 'teach' }));
    assert.strictEqual(b2.data.list.length, 2);
  });

  await t('关键词与 category 叠加生效', async () => {
    const b = json(await get('/api/posts', { keyword: '高数', category: '文艺特长' }));
    assert.deepStrictEqual(b.data.list, []);
    const b2 = json(await get('/api/posts', { keyword: '高数', category: '学业辅导' }));
    assert.strictEqual(b2.data.list.length, 2);
  });

  await t('无结果 → 空列表（不报错）', async () => {
    const b = json(await get('/api/posts', { keyword: '量子力学' }));
    assert.deepStrictEqual(b.data.list, []);
    assert.strictEqual(b.data.nextCursor, null);
  });

  await t('空关键词等同于不筛选', async () => {
    const b = json(await get('/api/posts', { keyword: '   ' }));
    assert.strictEqual(b.data.list.length, 4);
  });

  await t('正则特殊字符被转义（「.*」不应命中全部）', async () => {
    const b = json(await get('/api/posts', { keyword: '.*' }));
    assert.deepStrictEqual(b.data.list, [], '特殊字符必须按字面量匹配');
  });

  await t('超长关键词被截断且不报错', async () => {
    const b = json(await get('/api/posts', { keyword: '高'.repeat(200) }));
    assert.strictEqual(b.code, 0);
    assert.deepStrictEqual(b.data.list, []);
  });

  await t('游标分页与关键词叠加（cursor 过滤继续生效）', async () => {
    // cursor 语义：只取比它更早的帖；以 s4 的时间为游标，应只剩 s1
    const b = json(await get('/api/posts', { keyword: '高数', cursor: String(now0 - 3000) }));
    assert.deepStrictEqual(b.data.list.map((p) => p._id), ['s1'], '实际 ' + JSON.stringify(b.data.list));
  });

  // ================= 徽标计数 =================
  console.log('GET /api/posts/counts?keyword=');

  await t('counts 跟随关键词（高数 → all/teach/learn）', async () => {
    const b = json(await get('/api/posts/counts', { keyword: '高数' }));
    assert.deepStrictEqual(b.data, { all: 2, teach: 2, learn: 0 });
  });

  await t('counts 关键词 + 分类叠加', async () => {
    const b = json(await get('/api/posts/counts', { keyword: '高数', category: '文艺特长' }));
    assert.deepStrictEqual(b.data, { all: 0, teach: 0, learn: 0 });
  });

  await t('无关键词时 counts 统计全部已上广场帖', async () => {
    const b = json(await get('/api/posts/counts', {}));
    assert.deepStrictEqual(b.data, { all: 4, teach: 3, learn: 1 });
  });

  // ================= 热门标签 =================
  console.log('GET /api/posts/tags');

  await t('热门标签按出现次数降序（高数 2 次居首）', async () => {
    const b = json(await get('/api/posts/tags', {}));
    assert.strictEqual(b.data.list[0].tag, '高数');
    assert.strictEqual(b.data.list[0].count, 2);
    const tags = b.data.list.map((x) => x.tag);
    assert.ok(tags.includes('吉他') && tags.includes('口语'));
  });

  await t('热门标签只统计已上广场的帖子', async () => {
    const b = json(await get('/api/posts/tags', {}));
    const total = b.data.list.reduce((s, x) => s + x.count, 0);
    assert.strictEqual(total, 6, '4 条 passed 帖共 6 个标签实例');
  });

  await t('limit 生效且上限 30', async () => {
    const b = json(await get('/api/posts/tags', { limit: 1 }));
    assert.strictEqual(b.data.list.length, 1);
    const b2 = json(await get('/api/posts/tags', { limit: 999 }));
    assert.ok(b2.data.list.length <= 30);
  });

  await t('按分类过滤热门标签', async () => {
    const b = json(await get('/api/posts/tags', { category: '文艺特长' }));
    assert.deepStrictEqual(b.data.list.map((x) => x.tag), ['吉他']);
  });

  console.log(`\n结果：通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
