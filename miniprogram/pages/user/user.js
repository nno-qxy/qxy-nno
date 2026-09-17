/**
 * 用户公开页（从帖子详情的作者头像点进来）
 * 展示：基本信息 + 好评率 + TA 发布过的帖子 / TA 收到的评价
 * 后端契约：
 * - GET /api/users/:openid/profile  → { user, posts }
 * - GET /api/users/:openid/reviews  → { list, summary }
 */

const { get } = require('../../utils/request.js');
const { avatarOf, goodRate, timeAgo, dateTime } = require('../../utils/format.js');

const RATING_TEXT = { satisfied: '满意', dissatisfied: '不满意' };

Page({
  data: {
    openid: '',
    user: null,
    initial: '同',
    rateText: '暂无评价',
    joinText: '',
    tab: 'posts', // posts=TA 的帖子 | reviews=收到的评价
    posts: [],
    hasMore: false,
    reviews: [],
    loaded: false,
    loadError: '',
  },

  onLoad(options) {
    const openid = (options && options.openid) || '';
    this.setData({ openid });
    if (!openid) {
      this.setData({ loaded: true, loadError: '参数错误：缺少用户标识' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    const openid = this.data.openid;
    return Promise.all([
      get('/api/users/' + openid + '/profile', {}, { silent: true }),
      // 评价拉取失败不影响基本信息展示
      get('/api/users/' + openid + '/reviews', {}, { silent: true }).catch(() => ({ list: [] })),
    ])
      .then((res) => {
        const profile = res[0] || {};
        const reviewData = res[1] || {};
        const user = profile.user || {};
        const posts = profile.posts || [];
        const reviews = (reviewData.list || []).map((r, i) => ({
          _key: (r.time || 0) + '_' + i,
          evaluatorName: r.evaluatorName || '',
          evaluatorAvatar: r.evaluatorAvatar || '',
          initial: avatarOf(r.evaluatorName),
          roleText: r.role === 'teacher' ? '教学者评语' : '学员评价',
          rating: r.rating || '',
          ratingText: RATING_TEXT[r.rating] || '',
          comment: r.comment || '',
          timeText: timeAgo(r.time),
          postId: r.postId || '',
          postTitle: r.postTitle || '',
        }));
        this.setData({
          user,
          initial: avatarOf(user.nickname),
          rateText: goodRate(user.goodCount, user.totalCount) || '暂无评价',
          joinText: user.createTime ? dateTime(user.createTime).slice(0, 10) : '',
          posts,
          hasMore: posts.length >= 20,
          reviews,
          loaded: true,
          loadError: '',
        });
      })
      .catch((err) => {
        this.setData({ loaded: true, loadError: (err && err.message) || '加载失败' });
      });
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.tab) this.setData({ tab });
  },

  /** post-card / 评价里的「来自帖子」都走这里跳详情 */
  onTapPost(e) {
    const id = (e.detail && e.detail.id) || e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },
});
