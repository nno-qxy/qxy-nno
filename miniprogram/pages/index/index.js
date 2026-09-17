const { get } = require('../../utils/request.js');
const { CATEGORIES } = require('../../config/index.js');

/**
 * 意图 Tab：与后端 type 参数同值域（all = 不筛类型）
 * 「我想学」= learn（需求侧） / 「我能教」= teach（供给侧）
 */
const INTENTS = [
  { key: 'all', label: '全部' },
  { key: 'learn', label: '我想学' },
  { key: 'teach', label: '我能教' },
];
const INTENT_KEY = 'skillswap_intent';
/** 搜索关键词上限（与后端 lib/search.js 的 MAX_LEN 保持一致） */
const KW_MAX = 20;

/**
 * 空态文案：按「搜索词 / 意图 × 分类」组合生成
 * 目标是把「没有结果」变成转化点——主 CTA 去发布（预选意图+分类），次 CTA 给另一条出路
 */
function emptyStateOf(intent, cat, kw) {
  const c = cat && cat !== '全部' ? cat : '';
  // 搜索无结果：优先让用户「换个词」或「清空」
  if (kw) {
    return {
      text: '没有找到和「' + kw + '」相关的帖子',
      hint: '换个标签试试，或者自己发一条让大家找到你',
      actionText: intent === 'learn' ? '发布我的需求' : '发布一条技能帖',
      altText: '清空搜索，看看全部',
    };
  }
  if (intent === 'learn') {
    return {
      text: c ? '还没有人想学「' + c + '」' : '还没有人发过求教帖',
      hint: '你可以第一个发出来，让会的人找到你',
      actionText: '发布我的需求',
      altText: c ? '看看谁在教「' + c + '」' : '看看谁能教',
    };
  }
  if (intent === 'teach') {
    return {
      text: c ? '还没有人能教「' + c + '」' : '还没有人发过教帖',
      hint: '你可以先教一手，让想学的人找到你',
      actionText: '发布我能教的',
      altText: c ? '看看谁想学「' + c + '」' : '看看谁想学',
    };
  }
  return {
    text: c ? '还没有「' + c + '」的技能帖' : '广场还空空如也',
    hint: '点下面的按钮，发一条试试',
    actionText: '发布一条技能帖',
    altText: '',
  };
}

Page({
  data: {
    cats: ['全部'].concat(CATEGORIES),
    activeCat: '全部',
    // 意图 Tab（count 为数量徽标，来自 /api/posts/counts）
    intents: INTENTS.map((i) => ({ key: i.key, label: i.label, count: 0 })),
    intent: 'all',
    // 搜索：keyword=输入框内容，appliedKw=已生效的关键词（列表与徽标都按它筛）
    keyword: '',
    appliedKw: '',
    searchOpen: false,
    hotTags: [],
    hotTagsLoaded: false,
    // 空态（按需渲染，避免在 wxml 里写分支）
    emptyText: '',
    emptyHint: '',
    emptyActionText: '',
    emptyAltText: '',
    list: [],
    hasMore: true,
    loading: false,
    loaded: false,
    loadError: '',
  },

  onLoad() {
    // 恢复上次选择的意图 Tab（本地缓存），默认「全部」以保护浏览型用户
    this.setData({ intent: this.readIntent() });
    this.loadList(true);
    this.loadCounts();
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh());
    this.loadCounts();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadList(false);
  },

  /** 读取上次的意图选择；无缓存/非法值一律回落「全部」 */
  readIntent() {
    try {
      const v = wx.getStorageSync(INTENT_KEY);
      return INTENTS.some((i) => i.key === v) ? v : 'all';
    } catch (e) {
      return 'all';
    }
  },

  // ================= 搜索（按标签搜，兼容标题 / 正文关键词） =================

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  /** 聚焦即展开热门标签建议（不用 blur 关闭，避免点标签时面板先消失） */
  onSearchFocus() {
    this.setData({ searchOpen: true });
    this.loadHotTags();
  },

  onCloseSuggest() {
    this.setData({ searchOpen: false });
  },

  /** 回车 / 点「搜索」：把输入框内容生效 */
  onSearch() {
    this.applyKeyword(this.data.keyword);
  },

  /** 点热门标签：直接以该标签为关键词搜索 */
  onTapTag(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    this.applyKeyword(tag);
  },

  onClearKeyword() {
    this.setData({ keyword: '', appliedKw: '', searchOpen: false });
    this.reload();
  },

  /** 生效关键词：写缓存态 + 重置分页 + 重拉列表与徽标 */
  applyKeyword(raw) {
    const kw = String(raw == null ? '' : raw).trim().slice(0, KW_MAX);
    this.setData({ keyword: kw, appliedKw: kw, searchOpen: false });
    this.reload();
  },

  /** 热门标签：给搜索框做「点一下就能搜」的候选（跟随分类） */
  loadHotTags() {
    if (this.data.hotTagsLoaded) return Promise.resolve();
    const params = { limit: 12 };
    if (this.data.activeCat !== '全部') params.category = this.data.activeCat;
    return get('/api/posts/tags', params, { silent: true })
      .then((d) => this.setData({ hotTags: (d && d.list) || [], hotTagsLoaded: true }))
      .catch(() => this.setData({ hotTags: [], hotTagsLoaded: true }));
  },

  /** 重置列表并重拉（搜索 / 切意图 / 切分类共用） */
  reload() {
    this.setData({ list: [], hasMore: true, loaded: false, loadError: '' });
    this.loadList(true);
    this.loadCounts();
  },

  // ================= 意图 / 分类 =================

  onSwitchIntent(e) {
    this.switchIntent(e.currentTarget.dataset.k);
  },

  /**
   * 切换意图：写缓存 + 重置分页 + 重拉列表
   * 数量徽标只与分类 / 搜索词相关，与意图无关，因此这里不必重拉
   */
  switchIntent(k) {
    if (!k || k === this.data.intent) return;
    try {
      wx.setStorageSync(INTENT_KEY, k);
    } catch (e) {}
    this.setData({ intent: k });
    this.reload();
  },

  /** 空态次 CTA：搜索无结果时清空搜索；否则切到对侧意图（我想学 ⇄ 我能教） */
  onEmptyAlt() {
    if (this.data.appliedKw) {
      this.onClearKeyword();
      return;
    }
    this.switchIntent(this.data.intent === 'learn' ? 'teach' : 'learn');
  },

  /** 空态主 CTA：去发布，并把当前意图与分类带过去预选
   * 注意：发布页在 tabBar，不能用 wx.navigateTo；先把预选参数落地到本地缓存，再 switchTab
   */
  onEmptyAction() {
    const preset = {};
    if (this.data.intent === 'learn' || this.data.intent === 'teach') {
      preset.type = this.data.intent;
    }
    if (this.data.activeCat !== '全部') {
      preset.category = this.data.activeCat;
    }
    if (Object.keys(preset).length) {
      try {
        wx.setStorageSync('publish_preset', preset);
      } catch (e) {}
    }
    wx.switchTab({ url: '/pages/publish/publish' });
  },

  onSwitchCat(e) {
    const cat = e.currentTarget.dataset.cat;
    if (cat === this.data.activeCat) return;
    // 分类变了，热门标签建议跟着变
    this.setData({ activeCat: cat, hotTags: [], hotTagsLoaded: false });
    this.reload();
  },

  onTapCard(e) {
    const id = e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  onRetry() {
    this.setData({ loadError: '' });
    this.loadList(this.data.list.length === 0);
  },

  /**
   * 意图 Tab 数量徽标：GET /api/posts/counts（可选 category / keyword）
   * 失败静默——徽标只是辅助信息，不能影响广场主流程
   */
  loadCounts() {
    const params = {};
    if (this.data.activeCat !== '全部') params.category = this.data.activeCat;
    if (this.data.appliedKw) params.keyword = this.data.appliedKw;
    return get('/api/posts/counts', params, { silent: true })
      .then((d) => {
        const c = { all: 0, teach: 0, learn: 0 };
        if (d && typeof d === 'object') {
          c.all = Number(d.all) || 0;
          c.teach = Number(d.teach) || 0;
          c.learn = Number(d.learn) || 0;
        }
        this.setData({
          intents: INTENTS.map((i) => ({ key: i.key, label: i.label, count: c[i.key] || 0 })),
        });
      })
      .catch(() => {});
  },

  /**
   * 拉取广场列表（游标分页）
   * 后端契约：GET /api/posts → { list: [...], nextCursor: number|null }
   * - nextCursor != null → 还有后续页，把 cursor=last.createTime 继续拉
   * - nextCursor == null → 已到尾页
   * 错误：保留旧列表 + 显示错误提示（不静默清空，避免误以为是「没有帖子」）
   */
  loadList(reset) {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });

    const params = {};
    if (this.data.intent !== 'all') params.type = this.data.intent;
    if (this.data.activeCat !== '全部') params.category = this.data.activeCat;
    if (this.data.appliedKw) params.keyword = this.data.appliedKw;
    if (!reset && this.data.list.length) {
      const last = this.data.list[this.data.list.length - 1];
      if (last.createTime) params.cursor = last.createTime;
    }

    return get('/api/posts', params, { silent: true })
      .then((data) => {
        const rows = (data && data.list) || [];
        const nextCursor = data ? data.nextCursor : null;
        const es = emptyStateOf(this.data.intent, this.data.activeCat, this.data.appliedKw);
        this.setData({
          list: reset ? rows : this.data.list.concat(rows),
          hasMore: nextCursor != null,
          loaded: true,
          loadError: '',
          emptyText: es.text,
          emptyHint: es.hint,
          emptyActionText: es.actionText,
          emptyAltText: es.altText,
        });
      })
      .catch((err) => {
        this.setData({
          loaded: true,
          loadError: (err && err.message) || '加载失败',
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },
});
