/**
 * 发布后的互补推荐（Z-07+）
 * 场景：
 *  - 用户刚发布「我能教」→ 展示同标签的「我想学」
 *  - 用户刚发布「我想学」→ 展示同标签的「我能教」
 * 后端：GET /api/posts/related?tags=&type=&exclude=&limit=
 * 跳转参数（由 publish 页在发布成功后带上）：
 *  - type    要推荐的类型（互补类型：learn / teach）
 *  - tags    刚发布帖子的标签（逗号分隔，已 encodeURIComponent）
 *  - exclude 刚发布的帖子 id（避免把刚发的帖推荐给自己）
 */

const { get } = require('../../utils/request.js');

function safeDecode(s) {
  try {
    return decodeURIComponent(s || '');
  } catch (e) {
    return String(s || '');
  }
}

Page({
  data: {
    recType: 'learn',     // 要推荐的类型
    originType: 'teach',  // 我刚刚发布的类型
    recLabel: '我想学',
    originLabel: '我能教',
    heroTitle: '',
    heroSub: '',
    tagsText: '',
    exclude: '',
    list: [],
    loaded: false,
    loadError: '',
  },

  onLoad(options) {
    const opts = options || {};
    const recType = opts.type === 'teach' ? 'teach' : 'learn';
    const originType = recType === 'teach' ? 'learn' : 'teach';
    const tagsText = safeDecode(opts.tags);
    const exclude = opts.exclude || '';

    const recLabel = recType === 'learn' ? '我想学' : '我能教';
    const originLabel = originType === 'learn' ? '我想学' : '我能教';
    const heroTitle =
      originType === 'teach'
        ? '发布成功！这些同学正想学你会教的'
        : '发布成功！这些同学能教你想学的';

    this.setData({
      recType,
      originType,
      tagsText,
      exclude,
      recLabel,
      originLabel,
      heroTitle,
      heroSub: '下面是同标签的「' + recLabel + '」，也许正好互补',
    });
    this.load();
  },

  load() {
    const tags = (this.data.tagsText || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tags.length) {
      this.setData({ list: [], loaded: true, loadError: '' });
      return;
    }
    const q = { tags: tags.join(','), type: this.data.recType, limit: 10 };
    if (this.data.exclude) q.exclude = this.data.exclude;
    get('/api/posts/related', q, { silent: true })
      .then((data) => {
        this.setData({ list: (data && data.list) || [], loaded: true, loadError: '' });
      })
      .catch((err) => {
        this.setData({
          list: [],
          loaded: true,
          loadError: (err && err.message) || '加载失败',
        });
      });
  },

  onTapCard(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goIndex() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' });
  },
});
