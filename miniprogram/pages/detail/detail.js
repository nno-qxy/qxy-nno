/**
 * 帖子详情（Z-05 展示 + Z-08 发起交换 + Z-07 相关推荐）
 * 后端契约：GET /api/posts/:id、POST /api/exchanges、GET /api/exchanges
 * - status=passed：公开，包括联系方式
 * - 其他状态：仅作者 + 管理员可见；其他人 404
 */

const { get, post } = require('../../utils/request.js');
const { getMyOpenid } = require('../../utils/auth.js');
const { typeInfo, timeAgo, avatarOf } = require('../../utils/format.js');
const { SAFETY_LINE } = require('../../utils/safety.js');

Page({
  data: {
    id: '',
    post: null,
    type: { text: '', cls: 'teach', arrow: '→' },
    initial: '同',
    timeText: '',
    contactText: '',
    loaded: false,
    loadError: '',
    // Z-08 发起交换
    isMine: false,
    applied: false,
    applying: false,
    // 帖主视角：该帖已有进行中的交换时，暂时不能确认新的申请
    ownerBusyTip: '',
    // Z-07 相关推荐
    relatedList: [],
    relatedLoaded: false,
    // 交换安全提醒文案
    safetyLine: SAFETY_LINE,
    // 交换评价区（类似售后评价）
    reviews: [],
    reviewSummary: null,
    reviewsLoaded: false,
  },

  onLoad(options) {
    const id = options.id || '';
    this.setData({ id });
    if (!id) {
      this.setData({ loaded: true, loadError: '参数错误：缺少帖子 id' });
      return;
    }
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  loadDetail() {
    return get('/api/posts/' + this.data.id, {}, { silent: true })
      .then((post) => {
        const t = typeInfo(post.type);
        const c = [post.contactWechat, post.contactQQ, post.contactEmail]
          .filter(Boolean).join(' · ');
        const me = getMyOpenid();
        const isMine = !!me && post.authorId === me;
        // 帖子占用态由后端随详情下发（见 routes/posts.js#detail）：
        // 「待开始」不占用帖子，只有「进行中」才让帖主暂停确认新申请
        const es = post.exchangeState || {};
        const busy = !!es.busy;
        this.setData({
          post,
          type: t,
          initial: avatarOf(post.authorName),
          timeText: timeAgo(post.createTime),
          contactText: c,
          loaded: true,
          loadError: '',
          isMine,
          ownerBusyTip:
            isMine && post.status === 'passed' && busy
              ? '这条帖有正在进行的交换，等这次结束后才能确认新的申请'
              : '',
        });
        this.loadRelated(post);
        this.loadReviews();
        if (!this.data.isMine && post.status === 'passed') {
          this.loadApplyState();
        }
      })
      .catch((err) => {
        this.setData({
          loaded: true,
          loadError: (err && err.message) || '加载失败',
        });
      });
  },

  // Z-08：我是否已对该帖发起过申请（pending / active / started 视为有效）
  loadApplyState() {
    get('/api/exchanges', {}, { silent: true })
      .then((data) => {
        const mine = (data && data.list) || [];
        const hit = mine.some(
          (e) => e.postId === this.data.id
            && (e.status === 'pending' || e.status === 'active' || e.status === 'started')
        );
        if (hit) this.setData({ applied: true });
      })
      .catch(() => { /* 拉不到就不预判，提交时后端仍会兜底 */ });
  },

  // Z-08：发起交换申请（可附一句留言）
  onApply() {
    if (this.data.applying || this.data.applied) return;
    wx.showModal({
      title: '向 TA 发起交换',
      editable: true,
      placeholderText: '写句话介绍自己，如想学什么、每周何时方便（可选）',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ applying: true });
        post('/api/exchanges', { postId: this.data.id, message: r.content || '' })
          .then(() => {
            this.setData({ applied: true, applying: false });
            wx.showToast({ title: '申请已发送，等对方确认', icon: 'none', duration: 2200 });
          })
          .catch((err) => {
            this.setData({ applying: false });
            // 重复申请等后端 409 已 toast；若提示已申请过则同步状态
            if (err && /已对该帖子发起过申请/.test(err.message || '')) {
              this.setData({ applied: true });
            }
          });
      },
    });
  },

  // Z-07 相关推荐：用当前帖 tags 拉相似 passed 帖（排除自己）
  loadRelated(post) {
    const tags = (post && post.tags) || [];
    if (!tags.length) {
      this.setData({ relatedList: [], relatedLoaded: true });
      return;
    }
    get('/api/posts/related', { tags: tags.join(','), exclude: this.data.id }, { silent: true })
      .then((data) => {
        this.setData({ relatedList: (data && data.list) || [], relatedLoaded: true });
      })
      .catch(() => {
        this.setData({ relatedList: [], relatedLoaded: true });
      });
  },

  onTapRelated(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  /**
   * 点作者头像/昵称 → 进 TA 的主页（基本信息 + 好评率 + 帖子）
   * 点自己则回「我的」：mine 是 tabBar 页，必须用 switchTab
   */
  onTapAuthor() {
    const openid = this.data.post && this.data.post.authorId;
    if (!openid) return;
    const me = getMyOpenid();
    if (me && openid === me) {
      wx.switchTab({ url: '/pages/mine/mine' });
      return;
    }
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) });
  },

  /** 帖子评价区（学员评分 + 教学者评语） */
  loadReviews() {
    return get('/api/posts/' + this.data.id + '/reviews', {}, { silent: true })
      .then((data) => {
        const list = ((data && data.list) || []).map((r, i) => ({
          _key: (r.time || 0) + '_' + i,
          evaluatorName: r.evaluatorName || '',
          evaluatorAvatar: r.evaluatorAvatar || '',
          initial: avatarOf(r.evaluatorName),
          roleText: r.role === 'teacher' ? '教学者评语' : '学员评价',
          rating: r.rating || '',
          ratingText: r.rating === 'satisfied' ? '满意' : r.rating === 'dissatisfied' ? '不满意' : '',
          comment: r.comment || '',
          timeText: timeAgo(r.time),
        }));
        this.setData({
          reviews: list,
          reviewSummary: (data && data.summary) || null,
          reviewsLoaded: true,
        });
      })
      .catch(() => {
        this.setData({ reviews: [], reviewsLoaded: true });
      });
  },
});
