/**
 * 我的发布（Z-12）
 * - 列表：GET /api/posts/mine（游标分页，limit=10）
 * - 按 status 分组展示：pending / passed / rejected / offline
 * - 驳回项可点开查看 rejectReason 并一键重提（POST /api/posts/:id/republish）
 *
 * 设计：tabs（按状态过滤）+ 列表，触底加载下一页
 */

const { get, post } = require('../../utils/request.js');
const { POST_STATUS, typeInfo, timeAgo } = require('../../utils/format.js');
const { ensureLogin } = require('../../utils/auth.js');

const TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: POST_STATUS.pending.text },
  { key: 'passed', label: POST_STATUS.passed.text },
  { key: 'rejected', label: POST_STATUS.rejected.text },
  { key: 'offline', label: POST_STATUS.offline.text },
];

/**
 * 附加展示派生字段（状态文案、类型文案、相对时间）
 * 注意：本地修改 status 后必须重新执行一次，否则文案会停留在旧状态
 */
function decorate(p) {
  const t = typeInfo(p.type);
  const s = POST_STATUS[p.status] || { text: p.status, cls: 'pending' };
  return Object.assign({}, p, {
    _statusText: s.text,
    _statusCls: s.cls,
    _timeText: timeAgo(p.createTime),
    _typeText: t.text,
    _typeCls: t.cls,
    _typeArrow: t.arrow,
  });
}

Page({
  data: {
    tabs: TABS,
    activeTab: '',
    list: [],
    hasMore: true,
    loading: false,
    loaded: false,
    loadError: '',
    expandingId: '',   // 当前展开显示驳回理由的帖 id
    republishingId: '', // 重提中的帖 id
  },

  onLoad() {
    // 确保有 token
    ensureLogin().catch(() => {});
    this.loadList(true);
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadList(false);
  },

  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({
      activeTab: key,
      list: [],
      hasMore: true,
      loaded: false,
      loadError: '',
      expandingId: '',
    });
    this.loadList(true);
  },

  onTapCard(e) {
    const id = e.detail.id;
    if (!id) return;
    // 驳回项：展开/收起重提理由；其他：跳详情
    const item = this.data.list.find((p) => p._id === id);
    if (item && item.status === 'rejected') {
      this.setData({ expandingId: this.data.expandingId === id ? '' : id });
    } else {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    }
  },

  onRepublish(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.republishingId) return;
    this.setData({ republishingId: id });
    post('/api/posts/' + id + '/republish', {}, { auth: true })
      .then(() => {
        // 改为 pending 后，本地状态与派生展示字段都要同步刷新
        // （只改 status 不够，_statusText 等派生字段会停留在「已驳回」）
        const list = this.data.list.map((p) => {
          if (p._id !== id) return p;
          const next = Object.assign({}, p, { status: 'pending', rejectReason: '' });
          return decorate(next);
        });
        this.setData({ list });
        wx.showToast({ title: '已重新提交', icon: 'success' });
      })
      .catch(() => { /* toast 已在 request 里弹 */ })
      .finally(() => {
        this.setData({ republishingId: '' });
      });
  },

  /**
   * 拉取我的发布（游标分页）
   * 后端契约：GET /api/posts/mine → { list, nextCursor }
   */
  loadList(reset) {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });

    const params = {};
    if (this.data.activeTab) params.status = this.data.activeTab;
    if (!reset && this.data.list.length) {
      const last = this.data.list[this.data.list.length - 1];
      if (last.createTime) params.cursor = last.createTime;
    }

    return get('/api/posts/mine', params, { silent: true })
      .then((data) => {
        const rows = (data && data.list) || [];
        const enriched = rows.map(decorate);
        const nextCursor = data ? data.nextCursor : null;
        this.setData({
          list: reset ? enriched : this.data.list.concat(enriched),
          hasMore: nextCursor != null,
          loaded: true,
          loadError: '',
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