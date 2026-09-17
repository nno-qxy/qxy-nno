/**
 * 小程序端数据流测试（阶段 2）
 * 思路：mock 全局 wx + mock HTTP 层，直接在 Node 里跑页面的 Page({...}) 逻辑，
 *       验证 index/detail/my-posts/publish 四个页面的数据流与状态机。
 * 不装任何浏览器/开发者工具依赖。
 *
 * 运行：node tests/stage2-mp.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Module = require('module');

const MP = path.join(__dirname, '..', 'miniprogram');

// 过滤 request.js 的 DEBUG 日志（config.DEBUG=true），保持测试输出清爽
const origLog = console.log;
console.log = function (...a) {
  if (a[0] === '[req]') return;
  origLog.apply(console, a);
};

// ---------- 1. mock 全局 wx ----------
const calls = { toast: [], loading: 0, hideLoading: 0, navigate: [], switchTab: [], reLaunch: [], login: 0, modal: [], actionSheet: [] };
const storage = {};

global.wx = {
  getStorageSync(k) { return storage[k] || ''; },
  setStorageSync(k, v) { storage[k] = v; },
  removeStorageSync(k) { delete storage[k]; },
  showToast(o) { calls.toast.push(o.title); },
  showLoading() { calls.loading++; },
  hideLoading() { calls.hideLoading++; },
  navigateTo(o) { calls.navigate.push(o.url); },
  switchTab(o) { calls.switchTab.push(o.url); },
  reLaunch(o) { calls.reLaunch.push(o.url); },
  stopPullDownRefresh() {},
  showModal(o) { calls.modal.push(o.title); o.success && o.success({ confirm: true, content: '' }); },
  showActionSheet(o) { calls.actionSheet.push(o.itemList); o.success && o.success({ tapIndex: o._tap || 0 }); },
  login(o) { calls.login++; o.success({ code: 'CODE_' + calls.login }); },
  request() { throw new Error('HTTP 应由 mockHttp 接管'); },
};

// ---------- 2. mock HTTP（拦截 utils/request.js 的 wx.request 出口）----------
// request.js 用的是 wx.request，这里直接替换掉
let routes = {};      // { 'GET /api/posts': fn(params) => data }
let httpLog = [];
let forceError = null;

global.wx.request = function (opt) {
  // API_BASE 形如 https://xxx/skillswap-api，先去域名再去函数名前缀
  const url = String(opt.url)
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/skillswap-api/, '');
  const key = opt.method + ' ' + url.split('?')[0];
  httpLog.push({ method: opt.method, url, data: opt.data });
  setTimeout(() => {
    if (forceError) {
      const e = forceError;
      forceError = null;
      return opt.fail && opt.fail({ errMsg: 'mock fail' });
    }
    const handler = routes[key];
    if (!handler) {
      return opt.success({
        statusCode: 404,
        data: { code: 404, msg: '路由不存在（mock）: ' + key },
      });
    }
    try {
      const data = handler(opt.data || {}, opt);
      opt.success({ statusCode: 200, data: { code: 0, msg: 'ok', data } });
    } catch (e) {
      opt.success({ statusCode: e.status || 400, data: { code: e.code || 400, msg: e.message } });
    }
  }, 0);
};

// ---------- 3. 加载页面模块 ----------
// 小程序页面用 Page() 注册，这里劫持全局 Page/Component 拿到配置对象
let pageConfig = null;
let compConfig = null;
global.Page = function (cfg) { pageConfig = cfg; };
global.Component = function (cfg) { compConfig = cfg; };

function loadPage(rel) {
  pageConfig = null;
  delete require.cache[require.resolve(path.join(MP, rel))];
  require(path.join(MP, rel));
  const cfg = pageConfig;
  // 造一个可运行的页面实例：深拷贝 data + setData + 绑定方法
  const inst = {
    data: JSON.parse(JSON.stringify(cfg.data || {})),
    setData(patch) { Object.assign(this.data, patch); },
  };
  Object.keys(cfg).forEach((k) => {
    if (k === 'data') return;
    if (typeof cfg[k] === 'function') inst[k] = cfg[k].bind(inst);
  });
  inst.__cfg = cfg;
  return inst;
}

/** 加载自定义组件（Component({...})），提供最小可跑的实例与事件收集 */
function loadComponent(rel) {
  compConfig = null;
  delete require.cache[require.resolve(path.join(MP, rel))];
  require(path.join(MP, rel));
  const cfg = compConfig;
  const events = [];
  // 真机上 properties 会同步暴露在 data 上（组件里用 this.data.range 取值），这里做同样映射
  const propDefaults = {};
  Object.keys(cfg.properties || {}).forEach((k) => { propDefaults[k] = cfg.properties[k].value; });
  const inst = {
    data: Object.assign(propDefaults, JSON.parse(JSON.stringify(cfg.data || {}))),
    properties: cfg.properties || {},
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    __events: events,
    __observers: cfg.observers || {},
  };
  Object.keys(cfg.methods || {}).forEach((k) => { inst[k] = cfg.methods[k].bind(inst); });
  return inst;
}

// ---------- 4. 种子数据 ----------
let posts = [];
function seedPosts() {
  const now = Date.now();
  posts = [];
  for (let i = 1; i <= 25; i++) {
    posts.push({
      _id: 'p' + i,
      title: '高等数学辅导第' + i + '期',
      content: '可以辅导高数上册内容，时间灵活',
      type: i % 2 === 0 ? 'learn' : 'teach',
      category: '学业辅导',
      tags: ['高数'],
      authorId: 'openid_A',
      authorName: '张同学',
      status: i <= 20 ? 'passed' : 'pending',
      createTime: now - i * 1000,
      contactWechat: i <= 20 ? 'wx_' + i : '',
    });
  }
}

function resetHttp() {
  routes = {};
  httpLog = [];
  forceError = null;
}

/**
 * 按游标分页的通用实现，与后端语义一致：
 * 后端用 limit+1 探测是否还有下一页，满页时才返回 nextCursor
 */
function paginate(list, params, size = 10) {
  let arr = list.slice().sort((a, b) => b.createTime - a.createTime);
  if (params.category) arr = arr.filter((p) => p.category === params.category);
  if (params.type) arr = arr.filter((p) => p.type === params.type);
  if (params.status) arr = arr.filter((p) => p.status === params.status);
  if (params.keyword) arr = arr.filter((p) => matchKeyword(p, params.keyword));
  if (params.cursor) arr = arr.filter((p) => p.createTime < Number(params.cursor));
  const probe = arr.slice(0, size + 1);        // 多取 1 条探测
  const hasMore = probe.length > size;
  const slice = hasMore ? probe.slice(0, size) : probe;
  return { list: slice, nextCursor: hasMore ? slice[slice.length - 1].createTime : null };
}

/** 与后端 GET /api/posts 的 keyword 语义一致：标签 / 标题 / 正文模糊匹配（忽略大小写） */
function matchKeyword(p, kw) {
  const k = String(kw).toLowerCase();
  return (
    (p.tags || []).some((t) => String(t).toLowerCase().indexOf(k) >= 0) ||
    String(p.title || '').toLowerCase().indexOf(k) >= 0 ||
    String(p.content || '').toLowerCase().indexOf(k) >= 0
  );
}

// ---------- 5. 测试框架 ----------
let pass = 0, fail = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ' → ' + e.message);
    console.log('  ✗ ' + name);
    console.log('      ' + e.message);
  }
}

function section(s) { console.log('\n=== ' + s + ' ==='); }

(async function run() {
  seedPosts();

  // 预置登录态：token + 已完善资料的用户缓存（发布前资料校验需要 realName/studentId）
  storage['skillswap_token'] = 'test-token';
  storage['skillswap_user'] = {
    _openid: 'openid_me', nickname: '测试同学', realName: '测试同学',
    studentId: '20210001', goodCount: 0, totalCount: 0,
  };

  // ================= 广场 index =================
  section('广场 index（Z-03）');

  resetHttp();
  routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
  // 数量徽标接口：与后端 counts 语义一致（只统计 passed，支持 category / keyword 限定）
  routes['GET /api/posts/counts'] = (params) => {
    let rows = posts.filter((p) => p.status === 'passed');
    if (params.category) rows = rows.filter((p) => p.category === params.category);
    if (params.keyword) rows = rows.filter((p) => matchKeyword(p, params.keyword));
    return {
      all: rows.length,
      teach: rows.filter((p) => p.type === 'teach').length,
      learn: rows.filter((p) => p.type === 'learn').length,
    };
  };

  delete storage['skillswap_intent']; // 保证「默认落全部」用例可复现
  let idx = loadPage('pages/index/index.js');

  await t('onLoad 拉取第一页 = 10 条，且 hasMore=true', async () => {
    idx.data.list = []; idx.data.hasMore = true; idx.data.loaded = false;
    await idx.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(idx.data.list.length, 10, '应拉取 10 条');
    assert.strictEqual(idx.data.hasMore, true, '还有后续页');
    assert.strictEqual(idx.data.loaded, true);
    assert.strictEqual(idx.data.loadError, '', '不应有错误');
  });

  await t('触底第二页追加到 20 条，且立即知道已到尾页（hasMore=false）', async () => {
    await idx.onReachBottom();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(idx.data.list.length, 20, '应累计 20 条');
    assert.strictEqual(idx.data.hasMore, false, 'passed 共 20 条，limit+1 探测后应直接判定到尾页');
  });

  await t('分页请求带 cursor 参数（游标分页而非 offset）', () => {
    const postReqs = httpLog.filter((l) => l.url === '/api/posts');
    const second = postReqs[postReqs.length - 1];
    assert.ok(second.data && second.data.cursor, '第二页请求应带 cursor');
  });

  await t('切分类后重置列表并重新拉取（带 category 参数）', async () => {
    idx.setData({ activeCat: '学业辅导', list: [], hasMore: true, loaded: false });
    await idx.onSwitchCat({ currentTarget: { dataset: { cat: '语言交流' } } });
    await new Promise((r) => setTimeout(r, 10));
    const last = httpLog[httpLog.length - 1];
    assert.strictEqual(last.data.category, '语言交流', '请求应带分类参数');
    assert.strictEqual(idx.data.list.length, 0, '语言交流分类无数据');
    assert.strictEqual(idx.data.hasMore, false, '无数据不应有下一页');
  });

  await t('网络失败保留旧列表 + 设置 loadError（不静默清空）', async () => {
    // 先拉一页正常数据
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    const idx2 = loadPage('pages/index/index.js');
    await idx2.loadList(true);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(idx2.data.list.length, 10, '前置：已有 10 条');

    // 再触发一次失败
    forceError = true;
    await idx2.loadList(false);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(idx2.data.list.length, 10, '失败后应保留原列表');
    assert.ok(idx2.data.loadError, '应设置 loadError');
  });

  await t('点卡片跳转详情页并带 id', () => {
    calls.navigate.length = 0;
    idx.onTapCard({ detail: { id: 'p7' } });
    assert.strictEqual(calls.navigate[0], '/pages/detail/detail?id=p7');
  });

  // ================= 广场搜索（按标签搜） =================
  section('广场搜索框（按标签搜）');

  await t('聚焦搜索框 → 拉热门标签并展开建议面板', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    routes['GET /api/posts/tags'] = () => ({ list: [{ tag: '高数', count: 20 }, { tag: '英语', count: 3 }] });
    const p = loadPage('pages/index/index.js');
    await p.onSearchFocus();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.searchOpen, true, '应展开建议面板');
    assert.strictEqual(p.data.hotTags.length, 2);
    assert.strictEqual(p.data.hotTags[0].tag, '高数');
    const req = httpLog.filter((l) => l.url === '/api/posts/tags').pop();
    assert.ok(req, '应请求热门标签接口');
  });

  await t('输入关键词回车 → 请求带 keyword，列表只剩命中的帖', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    const p = loadPage('pages/index/index.js');
    p.onKeywordInput({ detail: { value: '  高数  ' } });
    await p.onSearch();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.appliedKw, '高数', '关键词应去空白后生效');
    assert.strictEqual(p.data.searchOpen, false, '搜索后应收起建议面板');
    const req = httpLog.filter((l) => l.url === '/api/posts').pop();
    assert.strictEqual(req.data.keyword, '高数', '列表请求应带 keyword');
    assert.ok(p.data.list.length > 0, '种子数据标签都是高数，应有结果');
    assert.ok(p.data.list.every((x) => matchKeyword(x, '高数')));
  });

  await t('搜索生效后，意图徽标也跟着关键词变', async () => {
    resetHttp();
    let countsParams = null;
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = (params) => {
      countsParams = params;
      return { all: 4, teach: 2, learn: 2 };
    };
    const p = loadPage('pages/index/index.js');
    await p.applyKeyword('高数');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(countsParams && countsParams.keyword, '高数', '徽标请求应带 keyword');
    const byKey = {};
    p.data.intents.forEach((i) => { byKey[i.key] = i.count; });
    assert.deepStrictEqual(byKey, { all: 4, teach: 2, learn: 2 });
  });

  await t('点热门标签 → 直接以该标签为关键词搜索', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 0, teach: 0, learn: 0 });
    const p = loadPage('pages/index/index.js');
    p.onTapTag({ currentTarget: { dataset: { tag: '英语' } } });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.keyword, '英语');
    assert.strictEqual(p.data.appliedKw, '英语');
    assert.strictEqual(p.data.searchOpen, false, '选完标签应收起面板');
  });

  await t('搜索无结果 → 空态给出「清空搜索」，次 CTA 即清空', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 0, teach: 0, learn: 0 });
    const p = loadPage('pages/index/index.js');
    await p.applyKeyword('量子力学');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.list.length, 0);
    assert.ok(p.data.emptyText.indexOf('量子力学') >= 0, '空态应带上关键词，实际 ' + p.data.emptyText);
    assert.strictEqual(p.data.emptyAltText, '清空搜索，看看全部');

    await p.onEmptyAlt();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.appliedKw, '', '应清空关键词');
    assert.strictEqual(p.data.list.length, 10, '清空后回到全部列表');
  });

  await t('清空按钮：关键词与生效态一起清掉，请求不再带 keyword', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    const p = loadPage('pages/index/index.js');
    p.setData({ keyword: '高数', appliedKw: '高数' });
    await p.onClearKeyword();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.keyword, '');
    assert.strictEqual(p.data.appliedKw, '');
    const req = httpLog.filter((l) => l.url === '/api/posts').pop();
    assert.strictEqual(req.data.keyword, undefined, '清空后不应再带 keyword');
  });

  await t('切分类会重置热门标签缓存（标签跟随分类）', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    const p = loadPage('pages/index/index.js');
    p.setData({ hotTags: [{ tag: '高数', count: 1 }], hotTagsLoaded: true });
    p.onSwitchCat({ currentTarget: { dataset: { cat: '语言交流' } } });
    assert.deepStrictEqual(p.data.hotTags, [], '缓存应被清空');
    assert.strictEqual(p.data.hotTagsLoaded, false);
    await new Promise((r) => setTimeout(r, 10));
  });

  // ================= 广场意图 Tab + 数量徽标 =================
  section('广场意图 Tab（全部 / 我想学 / 我能教）');

  await t('默认落「全部」：无缓存时不带 type 参数', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    delete storage['skillswap_intent'];
    const p = loadPage('pages/index/index.js');
    await p.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.intent, 'all', '无缓存应默认全部');
    const listReq = httpLog.filter((l) => l.url === '/api/posts')[0];
    assert.strictEqual(listReq.data.type, undefined, '全部 Tab 不应带 type 参数');
  });

  await t('数量徽标：从 counts 接口取数并写入三个 Tab', async () => {
    const p = loadPage('pages/index/index.js');
    await p.loadCounts();
    await new Promise((r) => setTimeout(r, 10));
    const byKey = {};
    p.data.intents.forEach((i) => { byKey[i.key] = i.count; });
    assert.deepStrictEqual(byKey, { all: 20, teach: 10, learn: 10 }, '三个 Tab 应各带数量');
  });

  await t('切到「我想学」：请求带 type=learn 且写入缓存（记住上次选择）', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    const p = loadPage('pages/index/index.js');
    await p.onSwitchIntent({ currentTarget: { dataset: { k: 'learn' } } });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.intent, 'learn');
    assert.strictEqual(storage['skillswap_intent'], 'learn', '应写入本地缓存');
    const listReq = httpLog.filter((l) => l.url === '/api/posts').pop();
    assert.strictEqual(listReq.data.type, 'learn', '请求应带 type=learn');
    assert.ok(p.data.list.every((x) => x.type === 'learn'), '列表应只剩 learn 帖');
  });

  await t('重进广场按缓存恢复上次的意图 Tab', async () => {
    storage['skillswap_intent'] = 'learn';
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    const p = loadPage('pages/index/index.js');
    await p.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.intent, 'learn', '应恢复缓存中的 learn');
    const listReq = httpLog.filter((l) => l.url === '/api/posts').pop();
    assert.strictEqual(listReq.data.type, 'learn');
  });

  await t('非法缓存值回落「全部」', () => {
    storage['skillswap_intent'] = 'hacked';
    const p = loadPage('pages/index/index.js');
    assert.strictEqual(p.readIntent(), 'all');
  });

  await t('切分类会重新拉数量徽标（徽标随分类变化）', async () => {
    storage['skillswap_intent'] = 'all';
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 20, learn: 0 });
    const p = loadPage('pages/index/index.js');
    await p.onSwitchCat({ currentTarget: { dataset: { cat: '学业辅导' } } });
    await new Promise((r) => setTimeout(r, 10));
    const cReq = httpLog.filter((l) => l.url === '/api/posts/counts')[0];
    assert.ok(cReq, '切分类应重新请求徽标');
    assert.strictEqual(cReq.data.category, '学业辅导');
  });

  // ================= 广场空态（发布 + 交叉切换） =================
  section('广场空态转化（无结果 → 发布 / 切对侧）');

  await t('无结果时生成空态文案 + 双 CTA（次 CTA 指向对侧类型）', async () => {
    resetHttp();
    routes['GET /api/posts'] = () => ({ list: [], nextCursor: null });
    routes['GET /api/posts/counts'] = () => ({ all: 0, teach: 0, learn: 0 });
    storage['skillswap_intent'] = 'learn';
    const p = loadPage('pages/index/index.js');
    p.setData({ intent: 'learn', activeCat: '学业辅导' });
    await p.loadList(true);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.list.length, 0);
    assert.ok(p.data.emptyText.includes('学业辅导'), '空态文案应含分类名，实际 ' + p.data.emptyText);
    assert.strictEqual(p.data.emptyActionText, '发布我的需求', '主 CTA 应为发布');
    assert.ok(p.data.emptyAltText.includes('谁在教'), '次 CTA 应指向对侧「谁在教」，实际 ' + p.data.emptyAltText);
  });

  await t('空态主 CTA：switchTab 到发布页并写入预选参数', () => {
    const p = loadPage('pages/index/index.js');
    p.setData({ intent: 'learn', activeCat: '学业辅导' });
    calls.switchTab.length = 0;
    p.onEmptyAction();
    assert.strictEqual(calls.switchTab[0], '/pages/publish/publish', '应 switchTab 到发布页');
    const preset = storage['publish_preset'];
    assert.ok(preset, '应写入 publish_preset');
    assert.strictEqual(preset.type, 'learn', '应预选 type=learn');
    assert.strictEqual(preset.category, '学业辅导', '应预选分类');
  });

  await t('空态次 CTA：一键切到对侧意图', async () => {
    resetHttp();
    routes['GET /api/posts'] = (params) => paginate(posts.filter((p) => p.status === 'passed'), params);
    routes['GET /api/posts/counts'] = () => ({ all: 20, teach: 10, learn: 10 });
    storage['skillswap_intent'] = 'learn';
    const p = loadPage('pages/index/index.js');
    p.setData({ intent: 'learn' });
    await p.onEmptyAlt();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.intent, 'teach', '应切到对侧 teach');
    assert.strictEqual(storage['skillswap_intent'], 'teach', '缓存应同步');
  });

  await t('「全部」Tab 空态不做交叉切换（无对侧）', async () => {
    resetHttp();
    routes['GET /api/posts'] = () => ({ list: [], nextCursor: null });
    routes['GET /api/posts/counts'] = () => ({ all: 0, teach: 0, learn: 0 });
    const p = loadPage('pages/index/index.js');
    p.setData({ intent: 'all', activeCat: '全部' });
    await p.loadList(true);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(p.data.emptyAltText, '', '全部 Tab 无对侧可切');
    assert.ok(p.data.emptyActionText, '仍应保留发布 CTA');
  });

  // ================= 详情 detail =================
  section('详情 detail（Z-05）');

  await t('加载详情并派生展示字段（type/time/contact）', async () => {
    resetHttp();
    routes['GET /api/posts/p1'] = () => posts.find((p) => p._id === 'p1');
    const det = loadPage('pages/detail/detail.js');
    await det.onLoad({ id: 'p1' });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(det.data.post, '应拿到帖子');
    assert.strictEqual(det.data.post._id, 'p1');
    assert.strictEqual(det.data.type.text, '我能教', 'teach → 我能教');
    assert.ok(det.data.timeText, '应派生时间文案');
    assert.ok(det.data.contactText.includes('wx_1'), 'passed 状态应有联系方式');
  });

  await t('缺少 id 直接报错，不发请求', async () => {
    resetHttp();
    const det = loadPage('pages/detail/detail.js');
    await det.onLoad({});
    assert.strictEqual(httpLog.length, 0, '不应发请求');
    assert.ok(det.data.loadError.includes('id'), '应提示缺少 id');
  });

  await t('帖子不存在（404）设置错误态', async () => {
    resetHttp();
    const det = loadPage('pages/detail/detail.js');
    await det.onLoad({ id: 'not-exist' });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(det.data.loadError, '应有错误提示');
    assert.strictEqual(det.data.post, null, '不应有帖子数据');
  });

  // ================= 我的发布 my-posts =================
  section('我的发布 my-posts（Z-12）');

  function seedMine() {
    const now = Date.now();
    return [
      { _id: 'm1', title: '教吉他入门', content: '零基础可学', type: 'teach', category: '文艺特长',
        tags: ['吉他'], authorId: 'openid_A', authorName: '张同学', status: 'passed',
        createTime: now - 1000, contactWechat: 'wx_m1' },
      { _id: 'm2', title: '想学摄影', content: '想找人教摄影', type: 'learn', category: '文艺特长',
        tags: ['摄影'], authorId: 'openid_A', authorName: '张同学', status: 'pending',
        createTime: now - 2000 },
      { _id: 'm3', title: '代做作业', content: '各类作业代做', type: 'teach', category: '学业辅导',
        tags: ['代做'], authorId: 'openid_A', authorName: '张同学', status: 'rejected',
        rejectReason: '涉及违规内容', createTime: now - 3000 },
    ];
  }
  let mineData = seedMine();

  await t('加载我的发布：3 条全部状态，派生状态文案', async () => {
    resetHttp();
    routes['GET /api/posts/mine'] = (params) => {
      let arr = mineData;
      if (params.status) arr = arr.filter((p) => p.status === params.status);
      return paginate(arr, params);
    };
    const mp = loadPage('pages/my-posts/my-posts.js');
    await mp.onLoad();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(mp.data.list.length, 3, '应有 3 条');
    const byId = {};
    mp.data.list.forEach((p) => { byId[p._id] = p; });
    assert.strictEqual(byId.m1._statusText, '已通过');
    assert.strictEqual(byId.m2._statusText, '待审核');
    assert.strictEqual(byId.m3._statusText, '已驳回');
    assert.strictEqual(byId.m3._typeText, '我能教');
    assert.ok(byId.m3._timeText, '应派生时间');
  });

  await t('按状态过滤：选「已驳回」只剩 1 条并带 status 参数', async () => {
    resetHttp();
    routes['GET /api/posts/mine'] = (params) => {
      let arr = mineData;
      if (params.status) arr = arr.filter((p) => p.status === params.status);
      return paginate(arr, params);
    };
    const mp = loadPage('pages/my-posts/my-posts.js');
    await mp.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    await mp.onSwitchTab({ currentTarget: { dataset: { key: 'rejected' } } });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(mp.data.list.length, 1, '应只剩驳回的 1 条');
    assert.strictEqual(mp.data.list[0]._id, 'm3');
    const last = httpLog[httpLog.length - 1];
    assert.strictEqual(last.data.status, 'rejected', '请求应带 status 参数');
  });

  await t('点驳回项 → 展开（不跳详情）；再点 → 收起', async () => {
    resetHttp();
    routes['GET /api/posts/mine'] = () => paginate(mineData, {});
    const mp = loadPage('pages/my-posts/my-posts.js');
    await mp.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    calls.navigate.length = 0;

    mp.onTapCard({ detail: { id: 'm3' } });   // 驳回项
    assert.strictEqual(mp.data.expandingId, 'm3', '应展开驳回理由');
    assert.strictEqual(calls.navigate.length, 0, '驳回项不应跳详情');

    mp.onTapCard({ detail: { id: 'm3' } });   // 再点收起
    assert.strictEqual(mp.data.expandingId, '', '应收起');
  });

  await t('点非驳回项 → 跳详情页', async () => {
    resetHttp();
    routes['GET /api/posts/mine'] = () => paginate(mineData, {});
    const mp = loadPage('pages/my-posts/my-posts.js');
    await mp.onLoad();
    await new Promise((r) => setTimeout(r, 10));
    calls.navigate.length = 0;
    mp.onTapCard({ detail: { id: 'm1' } });
    assert.strictEqual(calls.navigate[0], '/pages/detail/detail?id=m1');
  });

  await t('重提：调用 republish 接口，本地状态同步为 pending', async () => {
    resetHttp();
    routes['GET /api/posts/mine'] = () => paginate(mineData, {});
    let republished = 0;
    routes['POST /api/posts/m3/republish'] = () => { republished++; return { _id: 'm3', status: 'pending' }; };

    const mp = loadPage('pages/my-posts/my-posts.js');
    await mp.onLoad();
    await new Promise((r) => setTimeout(r, 10));

    await mp.onRepublish({ currentTarget: { dataset: { id: 'm3' } } });
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(republished, 1, '应调用 republish 一次');
    const m3 = mp.data.list.find((p) => p._id === 'm3');
    assert.strictEqual(m3.status, 'pending', '本地状态应变为 pending');
    assert.strictEqual(m3._statusText, '待审核', '状态文案应同步');
    assert.strictEqual(m3.rejectReason, '', '驳回理由应清空');
    assert.ok(calls.toast.some((x) => x.includes('重新提交')), '应提示已重新提交');
  });

  // ================= 发布 publish =================
  section('发布 publish（Z-04）');

  await t('标题太短被前端拦截，不发请求', async () => {
    resetHttp();
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({ type: 'teach', title: '高数', content: '可以辅导高数上册，时间灵活', tagsText: '高数' });
    await pub.onSubmit();
    assert.strictEqual(httpLog.length, 0, '不应发请求');
    assert.ok(calls.toast.some((x) => x.includes('标题至少')), '应提示标题字数');
  });

  await t('正文太短被拦截', async () => {
    resetHttp();
    calls.toast.length = 0;
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({ type: 'teach', title: '高数辅导', content: '短', tagsText: '' });
    await pub.onSubmit();
    assert.strictEqual(httpLog.length, 0);
    assert.ok(calls.toast.some((x) => x.includes('正文至少')));
  });

  await t('标签超 8 个被拦截', async () => {
    resetHttp();
    calls.toast.length = 0;
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'teach', title: '高数辅导', content: '可以辅导高数上册，时间灵活',
      tagsText: 'a,b,c,d,e,f,g,h,i',
    });
    await pub.onSubmit();
    assert.strictEqual(httpLog.length, 0);
    assert.ok(calls.toast.some((x) => x.includes('标签最多')));
  });

  // 从广场空态带参进入发布页：预选意图与分类
  await t('applyPreset：URL 带 type/category 时预选对应意图与分类', () => {
    const CATS = require(path.join(MP, 'config/index.js')).CATEGORIES;
    const pub = loadPage('pages/publish/publish.js');
    pub.applyPreset({ type: 'learn', category: '数码技能' });
    assert.strictEqual(pub.data.type, 'learn', '应预选「我想学」');
    assert.strictEqual(CATS[pub.data.catIndex], '数码技能', '分类应映射正确');
  });

  await t('applyPreset：非法参数保持默认（teach / 第一类）', () => {
    const pub = loadPage('pages/publish/publish.js');
    pub.applyPreset({ type: 'bogus', category: '不存在的分类' });
    assert.strictEqual(pub.data.type, 'teach', '非法 type 应保持默认');
    assert.strictEqual(pub.data.catIndex, 0, '非法分类应保持默认');
  });

  await t('onShow：消费 storage 中的 publish_preset 预选参数并清空', () => {
    const CATS = require(path.join(MP, 'config/index.js')).CATEGORIES;
    storage['publish_preset'] = { type: 'learn', category: '文艺特长' };
    const pub = loadPage('pages/publish/publish.js');
    pub.onShow();
    assert.strictEqual(pub.data.type, 'learn', '应消费 preset.type');
    assert.strictEqual(CATS[pub.data.catIndex], '文艺特长', '应消费 preset.category');
    assert.strictEqual(storage['publish_preset'], undefined, '消费后应删除 preset');
  });

  await t('标签输入：中文逗号/顿号/分号统一归一化为半角逗号', () => {
    const pub = loadPage('pages/publish/publish.js');
    pub.onTags({ detail: { value: '高数，线代、概率；英语' } });
    assert.strictEqual(pub.data.tagCount, 4, '应识别为 4 个标签');
  });

  await t('合法数据提交：payload 字段正确（type/category/title/content/tags）', async () => {
    resetHttp();
    let received = null;
    routes['POST /api/posts'] = (data) => {
      received = data;
      return Object.assign({ _id: 'new1', status: 'passed' }, data);
    };
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'learn', catIndex: 1, title: '想学摄影构图',
      content: '希望有人能教我摄影构图，可以交换高数辅导',
      tagsText: '摄影，构图',
    });
    await pub.onSubmit();
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(received, '应发出请求');
    assert.strictEqual(received.type, 'learn');
    assert.strictEqual(received.category, '语言交流', 'catIndex=1 对应第二个分类');
    assert.strictEqual(received.title, '想学摄影构图');
    assert.deepStrictEqual(received.tags, ['摄影', '构图'], '中文逗号应切分为数组');
  });

  await t('提交成功（有标签）→ 跳互补推荐页，发「我能教」推荐「我想学」', async () => {
    resetHttp();
    calls.toast.length = 0;
    calls.switchTab.length = 0;
    calls.navigate.length = 0;
    routes['POST /api/posts'] = (data) => Object.assign({ _id: 'n1', status: 'passed' }, data);
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'teach', catIndex: 0, title: '高数辅导',
      content: '可以辅导高数上册，时间灵活可约', tagsText: '高数,线代',
    });
    await pub.onSubmit();
    await new Promise((r) => setTimeout(r, 800)); // 提交成功后延时 700ms 跳转
    assert.ok(calls.toast.some((x) => x.includes('发布成功')), '应提示发布成功');
    const url = calls.navigate[calls.navigate.length - 1] || '';
    assert.ok(url.startsWith('/pages/recommend/recommend?'), '应跳推荐页，实际 ' + url);
    assert.ok(url.includes('type=learn'), '发「我能教」应推荐「我想学」(type=learn)，实际 ' + url);
    assert.ok(url.includes('exclude=n1'), '应带 exclude 排除刚发布的帖');
    assert.ok(url.includes(encodeURIComponent('高数,线代')), '应带标签，实际 ' + url);
    assert.strictEqual(calls.switchTab.length, 0, '不应回首页');
  });

  await t('提交成功但无标签 → 无法同标签推荐，回首页', async () => {
    resetHttp();
    calls.toast.length = 0;
    calls.switchTab.length = 0;
    calls.navigate.length = 0;
    routes['POST /api/posts'] = (data) => Object.assign({ _id: 'n0', status: 'passed' }, data);
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'learn', catIndex: 0, title: '想学高数',
      content: '希望有人能辅导高数，时间灵活可约', tagsText: '',
    });
    await pub.onSubmit();
    await new Promise((r) => setTimeout(r, 800));
    assert.strictEqual(calls.switchTab[0], '/pages/index/index', '无标签应回首页');
    assert.strictEqual(calls.navigate.length, 0, '不应跳推荐页');
  });

  await t('提交后后端返回 pending → 提示「已提交，待审核」', async () => {
    resetHttp();
    calls.toast.length = 0;
    routes['POST /api/posts'] = (data) => Object.assign({ _id: 'n2', status: 'pending' }, data);
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'teach', catIndex: 0, title: '高数辅导',
      content: '可以辅导高数上册，时间灵活可约', tagsText: '',
    });
    await pub.onSubmit();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.toast.some((x) => x.includes('待审核')), '应提示待审核');
  });

  await t('后端内容安全拦截（422）→ 提示违规，不跳转', async () => {
    // 上一个用例提交成功后有 700ms 延时跳转的 timer，先等它跑完避免污染本用例
    await new Promise((r) => setTimeout(r, 800));
    resetHttp();
    calls.toast.length = 0;
    calls.switchTab.length = 0;
    routes['POST /api/posts'] = () => {
      const e = new Error('内容包含违规词「代考」，请修改后重试');
      e.code = 422;
      throw e;
    };
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'teach', catIndex: 0, title: '代考服务',
      content: '可以提供各类考试代考服务', tagsText: '',
    });
    await pub.onSubmit();
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(calls.toast.some((x) => x.includes('违规')), '应提示违规');
    assert.strictEqual(calls.switchTab.length, 0, '不应跳转');
    assert.strictEqual(pub.data.submitting, false, '应重置提交中状态');
  });

  await t('重复点击提交不会并发（submitting 锁）', async () => {
    resetHttp();
    let hit = 0;
    routes['POST /api/posts'] = () => { hit++; return { _id: 'n3', status: 'passed' }; };
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({
      type: 'teach', catIndex: 0, title: '高数辅导',
      content: '可以辅导高数上册，时间灵活可约', tagsText: '',
    });
    // 不 await，连续调用三次
    pub.onSubmit();
    pub.onSubmit();
    pub.onSubmit();
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(hit, 1, '应只发一次请求，实际 ' + hit);
  });

  // ---------- 发布后推荐 recommend（Z-07+）----------
  console.log('\n=== 发布后推荐 recommend（Z-07+）===');

  await t('onLoad 解析参数并请求互补类型（发「我能教」→ 请求 learn）', async () => {
    resetHttp();
    let q = null;
    routes['GET /api/posts/related'] = (params) => { q = params; return { list: [] }; };
    const rec = loadPage('pages/recommend/recommend.js');
    rec.onLoad({ type: 'learn', tags: encodeURIComponent('高数,线代'), exclude: 'p9' });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(q, '应发出请求');
    assert.strictEqual(q.type, 'learn', '应请求 learn 类型');
    assert.strictEqual(q.tags, '高数,线代', '标签应解码后透传');
    assert.strictEqual(q.exclude, 'p9', '应带 exclude');
    assert.strictEqual(rec.data.recLabel, '我想学');
    assert.strictEqual(rec.data.originLabel, '我能教');
  });

  await t('发「我想学」→ 请求 teach 并渲染结果', async () => {
    resetHttp();
    let q = null;
    routes['GET /api/posts/related'] = (params) => {
      q = params;
      return { list: [{ _id: 't1', type: 'teach', title: '教高数', tags: ['高数'] }] };
    };
    const rec = loadPage('pages/recommend/recommend.js');
    rec.onLoad({ type: 'teach', tags: encodeURIComponent('高数') });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(q.type, 'teach');
    assert.strictEqual(rec.data.list.length, 1);
    assert.strictEqual(rec.data.recLabel, '我能教');
    assert.strictEqual(rec.data.loaded, true);
  });

  await t('请求失败 → 设置 loadError，不抛异常', async () => {
    resetHttp();
    routes['GET /api/posts/related'] = () => { const e = new Error('网络异常'); e.code = -1; throw e; };
    const rec = loadPage('pages/recommend/recommend.js');
    rec.onLoad({ type: 'learn', tags: encodeURIComponent('吉他') });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(rec.data.loadError, '应记录错误文案');
    assert.strictEqual(rec.data.loaded, true);
  });

  await t('无标签 → 不发请求，直接空态', async () => {
    resetHttp();
    let hit = 0;
    routes['GET /api/posts/related'] = () => { hit++; return { list: [] }; };
    const rec = loadPage('pages/recommend/recommend.js');
    rec.onLoad({ type: 'learn', tags: '' });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(hit, 0, '无标签不应发请求');
    assert.strictEqual(rec.data.loaded, true);
    assert.strictEqual(rec.data.list.length, 0);
  });

  await t('点推荐卡片 → 跳详情页', () => {
    calls.navigate.length = 0;
    const rec = loadPage('pages/recommend/recommend.js');
    rec.onTapCard({ detail: { id: 'abc' } });
    assert.strictEqual(calls.navigate[0], '/pages/detail/detail?id=abc');
  });

  // ---------- 交换页安全提醒（Z-13） ----------
  section('交换页安全提醒（Z-13）');

  await t('decorate：进行中 / 已完成带 showSafety，其余不带', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const mk = (status) => ex.decorate(
      { _id: 'e_' + status, status, myRole: 'applicant', completedBy: [], evaluations: [] }, 'me'
    );
    assert.strictEqual(mk('active').showSafety, true, 'active 应显示安全提示');
    assert.strictEqual(mk('completed').showSafety, true, 'completed 应显示安全提示');
    assert.strictEqual(mk('pending').showSafety, false, 'pending 不显示');
    assert.strictEqual(mk('rejected').showSafety, false, 'rejected 不显示');
  });

  await t('安全文案齐备（列表精简版 + 弹窗完整版含防转账）', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    assert.ok(ex.data.safetyBrief && ex.data.safetyBrief.length > 10, '应有列表提示文案');
    const safety = require(path.join(MP, 'utils/safety.js'));
    assert.ok(safety.SAFETY_TIPS.length >= 4, '条款应不少于 4 条');
    assert.ok(safety.safetyModalContent().indexOf('转账') >= 0, '弹窗文案应含防转账提醒');
  });

  await t('帖主点「同意交换」→ 调 confirm 并弹出安全提醒', async () => {
    resetHttp();
    calls.modal.length = 0;
    calls.toast.length = 0;
    routes['POST /api/exchanges/e9/confirm'] = () => ({ _id: 'e9', status: 'active' });
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    ex.setData({ tab: 'received' });
    await ex.onConfirm({ currentTarget: { dataset: { id: 'e9' } } });
    await new Promise((r) => setTimeout(r, 500)); // 等 350ms 延时弹窗
    assert.ok(calls.toast.some((x) => x.indexOf('已同意') >= 0), '应提示已同意');
    assert.ok(calls.modal.indexOf('交换安全提醒') >= 0, '应弹出安全提醒，实际 ' + JSON.stringify(calls.modal));
  });

  await t('点安全提示条 → 再次查看完整须知', () => {
    calls.modal.length = 0;
    const ex = loadPage('pages/exchanges/exchanges.js');
    ex.onSafety();
    assert.ok(calls.modal.indexOf('交换安全提醒') >= 0, '应弹出安全提醒');
  });

  await t('详情页注入安全提示文案', () => {
    const d = loadPage('pages/detail/detail.js');
    assert.ok(d.data.safetyLine && d.data.safetyLine.length > 10, '详情页应有安全提示文案');
  });

  // ---------- 发布页分类选择器（picker-sheet） ----------
  section('发布页分类选择器（picker-sheet）');

  await t('onOpenCat 打开弹层；onCatChange 落定分类并关闭', () => {
    const pub = loadPage('pages/publish/publish.js');
    assert.strictEqual(pub.data.catPickerShow, false, '默认关闭');
    pub.onOpenCat();
    assert.strictEqual(pub.data.catPickerShow, true, '应打开弹层');
    pub.onCatChange({ detail: { index: 3, value: '体育健身' } });
    assert.strictEqual(pub.data.catIndex, 3, '应写入选中索引');
    assert.strictEqual(pub.data.catPickerShow, false, '确认后应关闭弹层');
  });

  await t('onCatCancel 关闭弹层但不改分类', () => {
    const pub = loadPage('pages/publish/publish.js');
    pub.setData({ catIndex: 2, catPickerShow: true });
    pub.onCatCancel();
    assert.strictEqual(pub.data.catPickerShow, false);
    assert.strictEqual(pub.data.catIndex, 2, '取消不应改变原选择');
  });

  await t('picker-sheet：选中 → 确认抛 change 事件带 index/value', () => {
    const ps = loadComponent('components/picker-sheet/index.js');
    ps.setData({ range: ['学业辅导', '语言交流', '文艺特长', '体育健身'] });
    ps.onPick({ currentTarget: { dataset: { i: '3' } } });
    assert.strictEqual(ps.data.tmpIndex, 3, '应记录临时选中项');
    ps.onConfirm();
    const ev = ps.__events.find((x) => x.name === 'change');
    assert.ok(ev, '应触发 change');
    assert.strictEqual(ev.detail.index, 3);
    assert.strictEqual(ev.detail.value, '体育健身', '应回传选中项文本');
  });

  await t('picker-sheet：取消抛 cancel 事件且不改数据', () => {
    const ps = loadComponent('components/picker-sheet/index.js');
    ps.setData({ value: 2, tmpIndex: 5 });
    ps.onCancel();
    assert.ok(ps.__events.find((x) => x.name === 'cancel'), '应触发 cancel');
    assert.strictEqual(ps.data.tmpIndex, 5, '取消不应改写选中');
  });

  await t('picker-sheet：打开时把当前值同步为临时选中', () => {
    const ps = loadComponent('components/picker-sheet/index.js');
    ps.setData({ value: 4, tmpIndex: 0 });
    ps.__observers.show.call(ps, true);
    assert.strictEqual(ps.data.tmpIndex, 4, 'observers.show 应同步 value');
  });

  await t('发布页已注册 picker-sheet，且模板不再使用原生 picker', () => {
    const j = JSON.parse(fs.readFileSync(path.join(MP, 'pages/publish/publish.json'), 'utf8'));
    assert.ok(j.usingComponents && j.usingComponents['picker-sheet'], '应注册 picker-sheet 组件');
    const wxml = fs.readFileSync(path.join(MP, 'pages/publish/publish.wxml'), 'utf8');
    assert.ok(wxml.indexOf('<picker-sheet') >= 0, '模板应使用 picker-sheet');
    assert.strictEqual(wxml.indexOf('<picker '), -1, '不应再出现原生 picker 标签');
  });

  // ================= 我的页 · 沙盒切换测试账号入口 =================
  section('我的页（mine）· 切换测试账号入口（沙盒工具）');

  await t('onSwitchTestAccount：弹出 actionSheet 含测试账号与切回微信项', () => {
    const mp = loadPage('pages/mine/mine.js');
    calls.actionSheet.length = 0;
    mp.onSwitchTestAccount();
    assert.strictEqual(calls.actionSheet.length, 1, '应弹出选择面板');
    const items = calls.actionSheet[0];
    assert.ok(items.some((x) => x.includes('testA')), '应含 testA');
    assert.ok(items.some((x) => x.includes('testB')), '应含 testB');
    assert.ok(items.some((x) => x.includes('真实微信')), '应含切回微信项');
  });

  await t('doSwitch：调用 switchTestAccount 并 reLaunch 到首页', async () => {
    // 让 /api/auth/test-login 返回可用的 token+user
    routes['POST /api/auth/test-login'] = (data) => ({
      token: 'TK_' + data.uid, user: { openid: 'sandbox:' + data.uid, nickname: data.uid }, sandbox: true,
    });
    const mp = loadPage('pages/mine/mine.js');
    calls.reLaunch.length = 0;
    await mp.doSwitch('testA');
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(storage['skillswap_token'], 'TK_testA', '应写入测试账号 token');
    assert.strictEqual(calls.reLaunch[0], '/pages/index/index', '应 reLaunch 回首页');
  });

  await t('probeTestMode：health 返回 SANDBOX=true 时显示测试入口', async () => {
    routes['GET /api/health'] = () => ({ configured: { SANDBOX: true } });
    const mp = loadPage('pages/mine/mine.js');
    mp.probeTestMode();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(mp.data.testMode, true, '沙盒模式应显示入口');
  });

  await t('probeTestMode：health 返回 SANDBOX=false 时隐藏测试入口', async () => {
    routes['GET /api/health'] = () => ({ configured: { SANDBOX: false } });
    const mp = loadPage('pages/mine/mine.js');
    mp.probeTestMode();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(mp.data.testMode, false, '非沙盒应隐藏入口');
  });

  // ================= 用户主页（pages/user） =================
  section('用户主页（user）· 基本信息 + 好评率 + 帖子 / 收到的评价');

  await t('load：拉 profile 与 reviews，派生好评率 / 首字 / 评价角色文案', async () => {
    resetHttp();
    routes['GET /api/users/openid_A/profile'] = () => ({
      user: { openid: 'openid_A', nickname: '张同学', avatarColor: '#2B62E0', grade: '2023级', major: '计算机', tags: ['高数'], goodCount: 3, totalCount: 4, createTime: 1700000000000 },
      posts: [{ _id: 'p1', title: '教高数', type: 'teach', category: '学业辅导', tags: ['高数'], authorName: '张同学', authorId: 'openid_A', createTime: Date.now() - 1000 }],
    });
    routes['GET /api/users/openid_A/reviews'] = () => ({
      list: [
        { evaluatorName: '李同学', evaluatorAvatar: '#7A3FE0', role: 'learner', rating: 'satisfied', comment: '讲得很清楚', time: Date.now() - 5000, postId: 'p1', postTitle: '教高数' },
        { evaluatorName: '王同学', evaluatorAvatar: '#1F8A4C', role: 'teacher', rating: null, comment: '学得很快', time: Date.now() - 3000, postId: 'p1', postTitle: '教高数' },
      ],
      summary: { satisfied: 1, dissatisfied: 0, total: 1, goodRate: 100 },
    });
    const up = loadPage('pages/user/user.js');
    up.setData({ openid: 'openid_A' });
    await up.load();
    assert.strictEqual(up.data.user.nickname, '张同学');
    assert.strictEqual(up.data.initial, '张');
    assert.strictEqual(up.data.rateText, '75%', '3/4 应为 75%');
    assert.strictEqual(up.data.posts.length, 1);
    assert.strictEqual(up.data.reviews.length, 2);
    assert.strictEqual(up.data.reviews[0].roleText, '学员评价');
    assert.strictEqual(up.data.reviews[0].ratingText, '满意');
    assert.strictEqual(up.data.reviews[1].roleText, '教学者评语');
    assert.strictEqual(up.data.reviews[1].ratingText, '', '教学者评语不带满意/不满意');
  });

  await t('onLoad：缺少 openid → 错误态且不发请求', () => {
    resetHttp();
    const up = loadPage('pages/user/user.js');
    up.onLoad({});
    assert.ok(up.data.loadError, '应有错误提示');
    assert.strictEqual(httpLog.length, 0, '不应发请求');
  });

  await t('onTapPost：卡片与「来自帖子」都能跳详情', () => {
    const up = loadPage('pages/user/user.js');
    calls.navigate.length = 0;
    up.onTapPost({ detail: { id: 'p9' } });
    up.onTapPost({ currentTarget: { dataset: { id: 'p8' } } });
    assert.deepStrictEqual(calls.navigate, ['/pages/detail/detail?id=p9', '/pages/detail/detail?id=p8']);
  });

  // ================= 详情页评价区 & 作者入口 =================
  section('详情页（detail）· 评价区与作者主页入口');

  await t('loadReviews：渲染学员评价与教学者评语', async () => {
    resetHttp();
    routes['GET /api/posts/p1/reviews'] = () => ({
      list: [
        { evaluatorName: '李同学', role: 'learner', rating: 'satisfied', comment: '讲得很好', time: Date.now() - 100 },
        { evaluatorName: '王同学', role: 'teacher', rating: null, comment: '基础扎实', time: Date.now() - 50 },
      ],
      summary: { satisfied: 1, dissatisfied: 0, total: 1, goodRate: 100 },
    });
    const d = loadPage('pages/detail/detail.js');
    d.setData({ id: 'p1' });
    await d.loadReviews();
    assert.strictEqual(d.data.reviews.length, 2);
    assert.strictEqual(d.data.reviews[0].ratingText, '满意');
    assert.strictEqual(d.data.reviews[1].roleText, '教学者评语');
    assert.strictEqual(d.data.reviews[1].ratingText, '');
    assert.strictEqual(d.data.reviewSummary.goodRate, 100);
    assert.strictEqual(d.data.reviewsLoaded, true);
  });

  await t('loadReviews：接口失败 → 空列表但不阻塞页面', async () => {
    resetHttp();
    const d = loadPage('pages/detail/detail.js');
    d.setData({ id: 'p1' });
    await d.loadReviews();
    assert.deepStrictEqual(d.data.reviews, []);
    assert.strictEqual(d.data.reviewsLoaded, true);
  });

  await t('onTapAuthor：点他人头像 → 进用户主页', () => {
    storage['skillswap_user'] = { _openid: 'openid_ME' };
    const d = loadPage('pages/detail/detail.js');
    d.setData({ post: { authorId: 'openid_A' } });
    calls.navigate.length = 0;
    calls.switchTab.length = 0;
    d.onTapAuthor();
    assert.strictEqual(calls.navigate[0], '/pages/user/user?openid=openid_A');
  });

  await t('onTapAuthor：点自己头像 → switchTab 回「我的」（tabBar 页）', () => {
    storage['skillswap_user'] = { _openid: 'openid_ME' };
    const d = loadPage('pages/detail/detail.js');
    d.setData({ post: { authorId: 'openid_ME' } });
    calls.navigate.length = 0;
    calls.switchTab.length = 0;
    d.onTapAuthor();
    assert.strictEqual(calls.switchTab[0], '/pages/mine/mine');
    assert.strictEqual(calls.navigate.length, 0, '不应再用 navigateTo 跳 tabBar 页');
  });

  // ================= 交换页评价交互 =================
  section('交换页（exchanges）· 三态评价与评语');

  await t('decorate：学员给三态入口；教学者只给写评语', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const asLearner = ex.decorate({ _id: 'e1', status: 'completed', evaluations: [], evalRole: 'learner', completedBy: [] }, 'me');
    assert.strictEqual(asLearner.evalRole, 'learner');
    assert.strictEqual(asLearner.canEvaluate, true);
    assert.ok(/满意/.test(asLearner.evalHint), '学员提示应含满意/不满意');
    const asTeacher = ex.decorate({ _id: 'e2', status: 'completed', evaluations: [], evalRole: 'teacher', completedBy: [] }, 'me');
    assert.strictEqual(asTeacher.evalRole, 'teacher');
    assert.ok(/评语/.test(asTeacher.evalHint));
    assert.strictEqual(asLearner.showSafety, true, '还没评价时保留安全提示条');
  });

  await t('getMyOpenid：登录接口下发的是 openid（不是 _openid），两种都要认得', () => {
    const auth = require(path.join(MP, 'utils/auth.js'));
    storage['skillswap_user'] = { openid: 'sandbox:testA' };
    assert.strictEqual(auth.getMyOpenid(), 'sandbox:testA');
    storage['skillswap_user'] = { _openid: 'legacy_me' };
    assert.strictEqual(auth.getMyOpenid(), 'legacy_me', '兼容老字段名');
    delete storage['skillswap_user'];
    assert.strictEqual(auth.getMyOpenid(), '', '未登录返回空串，不抛错');
  });

  await t('load：缓存用户只有 openid 字段时，「已评价」也必须被识别出来（本次缺陷回归）', async () => {
    resetHttp();
    // 后端 publicFields 下发的是 openid；前端曾误读 _openid → me 恒为空 → 已评价仍显示按钮
    storage['skillswap_user'] = { openid: 'sandbox:testA' };
    routes['GET /api/exchanges/received'] = () => ({
      list: [{
        _id: 'x1', postId: 'p1', status: 'completed', evalRole: 'learner',
        applicantId: 'sandbox:testA', targetId: 'peer',
        evaluations: [{ openid: 'sandbox:testA', rating: 'satisfied', comment: '很好' }],
        myEvaluation: { openid: 'sandbox:testA', rating: 'satisfied', comment: '很好' },
        completedBy: ['sandbox:testA', 'peer'],
      }],
    });
    const ex = loadPage('pages/exchanges/exchanges.js');
    await ex.load();
    const row = ex.data.list[0];
    assert.strictEqual(row.evaluated, true, '已评价必须被识别，否则按钮永远收不起来');
    assert.strictEqual(row.canEvaluate, false, '已评价后不再出现评价按钮');
    assert.strictEqual(row.myEval.ratingText, '满意');
  });

  await t('decorate：openid 解析为空时，仍按后端 myEvaluation 收起评价按钮', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'x2', status: 'completed', completedBy: [],
      evaluations: [{ openid: 'me', rating: 'satisfied', comment: '很耐心' }],
      myEvaluation: { openid: 'me', rating: 'satisfied', comment: '很耐心' },
    }, ''); // ← 模拟 me 读空
    assert.strictEqual(d.evaluated, true);
    assert.strictEqual(d.canEvaluate, false);
  });

  await t('decorate：双方评价完成 → bothEvaluated + 结束文案；对方未评 → 等待提示', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const both = ex.decorate({
      _id: 'x3', status: 'completed', completedBy: [], evalRole: 'learner',
      evaluations: [
        { openid: 'me', role: 'learner', rating: 'satisfied', comment: '很好' },
        { openid: 'peer', role: 'teacher', rating: null, comment: '学得很快' },
      ],
      myEvaluation: { openid: 'me', role: 'learner', rating: 'satisfied', comment: '很好' },
      peerEvaluation: { openid: 'peer', role: 'teacher', rating: null, comment: '学得很快' },
    }, 'me');
    assert.strictEqual(both.bothEvaluated, true);
    assert.ok(/已结束/.test(both.evalDoneTip), '双方评完应提示交换已结束');
    assert.strictEqual(both.myEval.ratingText, '满意');
    assert.strictEqual(both.peerEval.isTeacher, true, '对方是教学者 → 只显示「评语」徽标');
    assert.strictEqual(both.peerEval.ratingText, '', '教学者没有满意/不满意');
    assert.strictEqual(both.peerEval.comment, '学得很快');
    assert.strictEqual(both.showSafety, false, '评价完成后收起安全提示条');

    const onlyMe = ex.decorate({
      _id: 'x4', status: 'completed', completedBy: [], evalRole: 'learner',
      evaluations: [{ openid: 'me', role: 'learner', rating: 'satisfied', comment: '很好' }],
      myEvaluation: { openid: 'me', role: 'learner', rating: 'satisfied', comment: '很好' },
    }, 'me');
    assert.strictEqual(onlyMe.bothEvaluated, false);
    assert.strictEqual(onlyMe.peerEval, null);
    assert.ok(/等对方/.test(onlyMe.evalDoneTip));
  });

  await t('decorate：已评价条目展示我的评价文案（评分 + 评语）', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'e3', status: 'completed', completedBy: [], evalRole: 'learner',
      evaluations: [{ openid: 'me', rating: 'satisfied', comment: '很耐心' }],
      myEvaluation: { openid: 'me', rating: 'satisfied', comment: '很耐心' },
    }, 'me');
    assert.strictEqual(d.evaluated, true);
    assert.strictEqual(d.canEvaluate, false);
    assert.strictEqual(d.myEvalText, '满意 · 很耐心');
  });

  await t('onEvaluate：满意 → 弹评语输入并提交 rating + comment', async () => {
    resetHttp();
    let sent = null;
    routes['POST /api/exchanges/e9/evaluate'] = (data) => { sent = data; return {}; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    const origModal = global.wx.showModal;
    global.wx.showModal = (o) => { o.success && o.success({ confirm: true, content: '讲得很清楚' }); };
    ex.onEvaluate({ currentTarget: { dataset: { id: 'e9', rating: 'satisfied' } } });
    await new Promise((r) => setTimeout(r, 30));
    global.wx.showModal = origModal;
    assert.deepStrictEqual(sent, { comment: '讲得很清楚', rating: 'satisfied' });
  });

  await t('onSkipEvaluate：暂不评价 → 提交 rating=none', async () => {
    resetHttp();
    let sent = null;
    routes['POST /api/exchanges/e10/evaluate'] = (data) => { sent = data; return {}; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    ex.onSkipEvaluate({ currentTarget: { dataset: { id: 'e10' } } });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(sent, { rating: 'none' });
  });

  await t('onComment：教学者写评语 → 只提交 comment，不带 rating', async () => {
    resetHttp();
    let sent = null;
    routes['POST /api/exchanges/e11/evaluate'] = (data) => { sent = data; return {}; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    const origModal = global.wx.showModal;
    global.wx.showModal = (o) => { o.success && o.success({ confirm: true, content: '学得很快' }); };
    ex.onComment({ currentTarget: { dataset: { id: 'e11' } } });
    await new Promise((r) => setTimeout(r, 30));
    global.wx.showModal = origModal;
    assert.deepStrictEqual(sent, { comment: '学得很快' });
    assert.strictEqual('rating' in sent, false, '教学者不应带 rating');
  });

  // ================= 交换页 · 开始协作 + 联系方式（Z-14） =================
  section('交换页（exchanges）· 开始协作与联系方式');

  await t('decorate：待开始且无人表态 → 给开始按钮 + 取消交换（无标记完成）', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const learner = ex.decorate({
      _id: 's1', status: 'active', evalRole: 'learner', completedBy: [], evaluations: [], startBy: [],
    }, 'me');
    assert.strictEqual(learner.canStart, true);
    assert.strictEqual(learner.startLabel, '申请开始');
    assert.strictEqual(learner.canDecline, false);
    assert.strictEqual(learner.canComplete, false, '待开始阶段不该出现「标记完成」');
    assert.strictEqual(learner.canCancel, true, '待开始阶段改为「取消交换」');
    assert.strictEqual(learner.cancelLabel, '取消交换');
    assert.strictEqual(learner.cancelIsConfirm, false);
    const teacher = ex.decorate({
      _id: 's2', status: 'active', evalRole: 'teacher', completedBy: [], evaluations: [], startBy: [],
    }, 'me');
    assert.strictEqual(teacher.startLabel, '教学开始');
    assert.strictEqual(teacher.declineLabel, '再约时间');
  });

  await t('decorate：对方已申请开始 → 我这边是「确认开始 + 临时有事」', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 's3', status: 'active', evalRole: 'learner', completedBy: [], evaluations: [], startBy: ['peer'],
    }, 'me');
    assert.strictEqual(d.canStart, true);
    assert.strictEqual(d.startIsConfirm, true);
    assert.strictEqual(d.startLabel, '确认开始');
    assert.strictEqual(d.canDecline, true);
    assert.strictEqual(d.declineLabel, '临时有事');
    assert.strictEqual(d.startWaiting, false);
  });

  await t('decorate：我已申请开始 → 等待对方，不再显示开始按钮', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 's4', status: 'active', evalRole: 'learner', completedBy: [], evaluations: [], startBy: ['me'],
    }, 'me');
    assert.strictEqual(d.canStart, false);
    assert.strictEqual(d.startWaiting, true);
  });

  await t('decorate：我已申请取消 → 收起取消按钮并提示等对方确认', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'c1', status: 'active', evalRole: 'learner', completedBy: [], evaluations: [],
      startBy: [], cancelBy: ['me'],
    }, 'me');
    assert.strictEqual(d.canCancel, false, '不能重复申请取消');
    assert.strictEqual(d.cancelWaiting, true);
    assert.strictEqual(d.cancelIsConfirm, false);
    assert.strictEqual(d.isCancelled, false, '还差对方确认');
  });

  await t('decorate：对方已申请取消 → 我的按钮变「确认取消」并给出说明', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'c2', status: 'active', evalRole: 'learner', completedBy: [], evaluations: [],
      startBy: [], cancelBy: ['peer'],
    }, 'me');
    assert.strictEqual(d.canCancel, true);
    assert.strictEqual(d.cancelIsConfirm, true);
    assert.strictEqual(d.cancelLabel, '确认取消');
    assert.ok(d.cancelPeerTip.indexOf('对方申请取消') >= 0, '应说明是对方发起的');
    assert.strictEqual(d.cancelWaiting, false);
  });

  await t('decorate：已取消 → 状态文案「已取消」，无安全提示 / 联系方式 / 评价入口', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'c3', status: 'cancelled', evalRole: 'learner', completedBy: [], evaluations: [],
      startBy: [], cancelBy: ['me', 'peer'], peerContact: 'wx_peer', myContact: 'wx_me',
    }, 'me');
    assert.strictEqual(d.statusText, '已取消');
    assert.strictEqual(d.isCancelled, true);
    assert.strictEqual(d.canCancel, false, '已取消是终态');
    assert.strictEqual(d.canComplete, false, '已取消不该出现标记完成');
    assert.strictEqual(d.canEvaluate, false, '已取消直接跳过评价');
    assert.strictEqual(d.showContact, false, '已取消不再互发联系方式');
    assert.strictEqual(d.showSafety, false, '已取消不再展示安全提示条');
    assert.ok(d.cancelDoneTip.indexOf('不会进入评价') >= 0, '应告知跳过评价');
  });

  await t('onCancel：确认弹窗 → 调用 /cancel 并提示已取消', async () => {
    resetHttp();
    let called = '';
    routes['POST /api/exchanges/s11/cancel'] = () => { called = 'yes'; return { status: 'cancelled' }; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    calls.toast.length = 0;
    const origModal = global.wx.showModal;
    global.wx.showModal = (o) => { o.success && o.success({ confirm: true }); };
    ex.onCancel({ currentTarget: { dataset: { id: 's11', confirm: 1 } } });
    await new Promise((r) => setTimeout(r, 30));
    global.wx.showModal = origModal;
    assert.strictEqual(called, 'yes', '应请求 /cancel');
    assert.ok(calls.toast.some((x) => x.indexOf('已取消') >= 0), '实际 ' + JSON.stringify(calls.toast));
  });

  await t('onCancel：弹窗点「再想想」不发请求', async () => {
    resetHttp();
    let called = false;
    routes['POST /api/exchanges/s12/cancel'] = () => { called = true; return {}; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    const origModal = global.wx.showModal;
    global.wx.showModal = (o) => { o.success && o.success({ confirm: false }); };
    ex.onCancel({ currentTarget: { dataset: { id: 's12' } } });
    await new Promise((r) => setTimeout(r, 30));
    global.wx.showModal = origModal;
    assert.strictEqual(called, false, '取消弹窗不应发请求');
  });

  await t('decorate：进行中 → 只留标记完成，状态文案为「进行中」', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 's5', status: 'started', evalRole: 'learner', completedBy: [], evaluations: [], startBy: ['me', 'peer'],
    }, 'me');
    assert.strictEqual(d.isStarted, true);
    assert.strictEqual(d.canStart, false);
    assert.strictEqual(d.canComplete, true);
    assert.strictEqual(d.showSafety, true);
    assert.strictEqual(d.statusText, '进行中');
  });

  await t('decorate：联系方式只在交换达成后展示', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const base = { _id: 's6', evalRole: 'learner', completedBy: [], evaluations: [], startBy: [] };
    const pending = ex.decorate(Object.assign({}, base, { status: 'pending', peerContact: 'wx_peer' }), 'me');
    assert.strictEqual(pending.showContact, false);
    assert.strictEqual(pending.contactText, '', 'pending 不展示联系方式');
    const active = ex.decorate(
      Object.assign({}, base, { status: 'active', peerContact: 'wx_peer', myContact: 'wx_me' }), 'me'
    );
    assert.strictEqual(active.showContact, true);
    assert.strictEqual(active.contactText, 'wx_peer');
    assert.strictEqual(active.myContactText, 'wx_me');
  });

  await t('decorate：对方取消留言进入 peerNote 文案', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 's7', status: 'active', evalRole: 'learner', completedBy: [], evaluations: [], startBy: [],
      peerCancelNote: { openid: 'peer', text: '下周再约', time: Date.now() },
    }, 'me');
    assert.strictEqual(d.peerNoteText, '下周再约');
    assert.ok(d.peerNoteTime, '应派生时间文案');
  });

  await t('decorate：已评价 → 收起按钮并给出评价内容与徽标', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 's8', status: 'completed', evalRole: 'learner', completedBy: [], startBy: [],
      evaluations: [{ openid: 'me', role: 'learner', rating: 'satisfied', comment: '很耐心', time: Date.now() }],
    }, 'me');
    assert.strictEqual(d.evaluated, true);
    assert.strictEqual(d.canEvaluate, false);
    assert.strictEqual(d.myEval.ratingText, '满意');
    assert.strictEqual(d.myEval.ok, true);
    assert.strictEqual(d.myEval.comment, '很耐心');
    assert.ok(d.myEval.timeText, '应有时间文案');
  });

  await t('onStart：调用 /start 并给出提示', async () => {
    resetHttp();
    let called = '';
    routes['POST /api/exchanges/s9/start'] = () => { called = 'yes'; return { status: 'started', startBy: ['me', 'peer'] }; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    calls.toast.length = 0;
    await ex.onStart({ currentTarget: { dataset: { id: 's9', confirm: 1 } } });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(called, 'yes', '应请求 /start');
    assert.ok(calls.toast.some((x) => x.indexOf('双方已确认开始') >= 0), '实际 ' + JSON.stringify(calls.toast));
  });

  await t('onCancelStart：填留言 → 提交 text 到 cancel-start', async () => {
    resetHttp();
    let sent = null;
    routes['POST /api/exchanges/s10/cancel-start'] = (data) => { sent = data; return {}; };
    routes['GET /api/exchanges/received'] = () => ({ list: [] });
    const ex = loadPage('pages/exchanges/exchanges.js');
    const origModal = global.wx.showModal;
    global.wx.showModal = (o) => { o.success && o.success({ confirm: true, content: '这周有考试，下周再约' }); };
    ex.onCancelStart({ currentTarget: { dataset: { id: 's10', label: '临时有事' } } });
    await new Promise((r) => setTimeout(r, 30));
    global.wx.showModal = origModal;
    assert.deepStrictEqual(sent, { text: '这周有考试，下周再约' });
  });

  await t('onCopyContact：复制联系方式到剪贴板', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    let copied = '';
    const orig = global.wx.setClipboardData;
    global.wx.setClipboardData = (o) => { copied = o.data; if (o.success) o.success(); };
    ex.onCopyContact({ currentTarget: { dataset: { text: 'wx_peer' } } });
    global.wx.setClipboardData = orig;
    assert.strictEqual(copied, 'wx_peer');
  });

  // ================= 详情页 · 帖子占用态 =================
  section('详情页（detail）· 帖子占用态（待开始不锁帖）');

  await t('有待开始交换 → 不再禁用「发起交换」', async () => {
    resetHttp();
    routes['GET /api/posts/p1'] = () => Object.assign({}, posts.find((p) => p._id === 'p1'), {
      exchangeState: { busy: false },
    });
    routes['GET /api/posts/p1/reviews'] = () => ({ list: [], summary: null });
    routes['GET /api/posts/related'] = () => ({ list: [] });
    const det = loadPage('pages/detail/detail.js');
    await det.onLoad({ id: 'p1' });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(det.data.applyLocked, undefined, '锁帖字段已移除');
    assert.strictEqual(det.data.ownerBusyTip, '', '非帖主不应看到帖主提示');
  });

  await t('帖主视角：有进行中交换 → 提示等结束后才能确认新申请', async () => {
    resetHttp();
    routes['GET /api/posts/p1'] = () => Object.assign({}, posts.find((p) => p._id === 'p1'), {
      exchangeState: { busy: true },
    });
    routes['GET /api/posts/p1/reviews'] = () => ({ list: [], summary: null });
    routes['GET /api/posts/related'] = () => ({ list: [] });
    // p1 的作者是 openid_A，这里切换成帖主本人视角
    storage['skillswap_user'] = { _openid: 'openid_A', nickname: '张同学', realName: '张同学', studentId: '20210001' };
    const det = loadPage('pages/detail/detail.js');
    await det.onLoad({ id: 'p1' });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(det.data.ownerBusyTip.indexOf('结束') >= 0, '帖主应看到提示');
    storage['skillswap_user'] = {
      _openid: 'openid_me', nickname: '测试同学', realName: '测试同学',
      studentId: '20210001', goodCount: 0, totalCount: 0,
    };
  });

  // ================= 交换页 · 帖子被进行中占用 =================
  section('交换页（exchanges）· 帖子被进行中占用');

  await t('decorate：帖子有进行中交换 → 待开始不能开始，但可以取消交换', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'b1', postId: 'p1', postTitle: 't', status: 'active', myRole: 'applicant',
      applicantId: 'me', targetId: 'peer', startBy: [], evaluations: [], completedBy: [],
      postBusy: true,
    }, 'me');
    assert.strictEqual(d.postBusy, true);
    assert.strictEqual(d.startBlocked, true);
    assert.strictEqual(d.canStart, false, '不能开始');
    assert.strictEqual(d.canComplete, false, '待开始阶段本就没有「标记完成」');
    assert.strictEqual(d.canCancel, true, '取消交换是退出动作，不受帖子占用影响');
    assert.ok(d.startBusyTip.indexOf('进行中') >= 0, '应说明原因');
  });

  await t('decorate：帖主侧 pending + 帖子被占用 → 同意按钮置灰并说明', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'b2', postId: 'p1', postTitle: 't', status: 'pending', myRole: 'target',
      applicantId: 'peer', targetId: 'me', startBy: [], evaluations: [], completedBy: [],
      postBusy: true,
    }, 'me');
    assert.strictEqual(d.canDecide, true, '仍可点拒绝');
    assert.strictEqual(d.decideBlocked, true, '确认按钮应置灰');
    assert.ok(d.decideBusyTip.indexOf('进行中') >= 0, '应说明原因');
  });

  await t('decorate：无进行中交换 → 一切照旧', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'b3', postId: 'p1', postTitle: 't', status: 'active', myRole: 'applicant',
      applicantId: 'me', targetId: 'peer', startBy: [], evaluations: [], completedBy: [],
      postBusy: false,
    }, 'me');
    assert.strictEqual(d.canStart, true);
    assert.strictEqual(d.startBlocked, false);
    assert.strictEqual(d.canComplete, false, '待开始阶段没有「标记完成」');
    assert.strictEqual(d.canCancel, true, '改为「取消交换」');
  });

  // 同一对用户已有进行中（peerBusy）：帖子本身没被占，但同一对人不能再开第二摊
  await t('decorate：同一对用户已有进行中 → 本条不能开始，提示指向「你和 TA」', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'b4', postId: 'p2', postTitle: 't', status: 'active', myRole: 'applicant',
      applicantId: 'me', targetId: 'peer', startBy: [], evaluations: [], completedBy: [],
      postBusy: false, peerBusy: true,
    }, 'me');
    assert.strictEqual(d.peerBusy, true);
    assert.strictEqual(d.startBlocked, true, '同一对已有进行中 → 本条不能开始');
    assert.strictEqual(d.canStart, false);
    assert.ok(d.startBusyTip.indexOf('你和 TA') >= 0, '提示应说明是同一对人：' + d.startBusyTip);
    assert.strictEqual(d.canCancel, true, '取消交换仍可用');
    assert.strictEqual(d.canComplete, false);
  });

  await t('decorate：peerBusy 下帖主侧 pending 的「同意交换」同样置灰', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'b5', postId: 'p2', postTitle: 't', status: 'pending', myRole: 'target',
      applicantId: 'peer', targetId: 'me', startBy: [], evaluations: [], completedBy: [],
      postBusy: false, peerBusy: true,
    }, 'me');
    assert.strictEqual(d.decideBlocked, true, '确认按钮应置灰');
    assert.ok(d.decideBusyTip.indexOf('你和 TA') >= 0, '提示应说明是同一对人：' + d.decideBusyTip);
    assert.strictEqual(d.canDecide, true, '仍可点拒绝');
  });

  await t('decorate：无 peerBusy 时开始按钮不受影响', () => {
    const ex = loadPage('pages/exchanges/exchanges.js');
    const d = ex.decorate({
      _id: 'b6', postId: 'p2', postTitle: 't', status: 'active', myRole: 'applicant',
      applicantId: 'me', targetId: 'peer', startBy: [], evaluations: [], completedBy: [],
      postBusy: false, peerBusy: false,
    }, 'me');
    assert.strictEqual(d.startBlocked, false);
    assert.strictEqual(d.canStart, true);
  });

  // ---------- 汇总 ----------
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) {
    console.log('\n失败清单：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(50) + '\n');
  process.exit(fail ? 1 : 0);
})();