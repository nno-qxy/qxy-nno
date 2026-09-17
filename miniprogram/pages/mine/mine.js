/**
 * 「我的」入口页
 * 对应需求用例 9/10/12 的统一入口：我的发布、我的交换、收到的申请、个人信息
 * 说明：本页为文档 4.3 页面清单之外新增的入口页（已确认）
 */

const { ensureLogin, refreshUser, getCachedUser, clearAuth, switchTestAccount } = require('../../utils/auth.js');
const { get } = require('../../utils/request.js');
const { avatarOf, goodRate } = require('../../utils/format.js');

// 测试账号固定候选（沙盒模式专用），切回真实微信放在最后一项
const TEST_ACCOUNTS = ['testA', 'testB'];

Page({
  data: {
    user: null,
    initial: '同',
    rateText: '',
    // 沙盒测试入口：仅后端 SANDBOX_MODE 开启时显示
    testMode: false,
    testUid: '',
  },

  onLoad() {
    const cached = getCachedUser();
    if (cached) this.applyUser(cached);
    this.syncTestUid(cached);
  },

  onShow() {
    ensureLogin()
      .then((u) => {
        this.applyUser(u);
        this.syncTestUid(u);
      })
      .catch(() => {});
    // 每次进入刷新一次，保证好评数与资料同步
    refreshUser()
      .then((u) => {
        this.applyUser(u);
        this.syncTestUid(u);
      })
      .catch(() => {});
    // 探测是否处于沙盒模式（后端环境变量），决定是否显示测试切换入口
    this.probeTestMode();
  },

  /** 从登录态推断当前是否为测试账号，并提取展示用 uid */
  syncTestUid(u) {
    const openid = (u && u.openid) || (getCachedUser() && getCachedUser().openid) || '';
    if (openid.startsWith('sandbox:')) {
      this.setData({ testUid: openid.slice('sandbox:'.length) });
    }
  },

  /** 调健康检查拿 SANDBOX 标记；失败则静默不显示测试入口 */
  probeTestMode() {
    get('/api/health', {}, { auth: false, silent: true })
      .then((data) => {
        const on = !!(data && data.configured && data.configured.SANDBOX);
        if (on !== this.data.testMode) this.setData({ testMode: on });
      })
      .catch(() => {});
  },

  applyUser(u) {
    if (!u) return;
    this.setData({
      user: u,
      initial: avatarOf(u.realName || u.nickname),
      rateText: goodRate(u.goodCount, u.totalCount) || '暂无评价',
    });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  // 我的内容三个入口：我的发布 / 我的交换（Z-10）/ 收到的申请（Z-09）
  goMyPosts() {
    wx.navigateTo({ url: '/pages/my-posts/my-posts' });
  },
  goExchanges() {
    wx.navigateTo({ url: '/pages/exchanges/exchanges?tab=mine' });
  },
  goReceived() {
    wx.navigateTo({ url: '/pages/exchanges/exchanges?tab=received' });
  },

  // ===== 沙盒测试：单设备多账号切换（仅 SANDBOX 模式可见）=====
  onSwitchTestAccount() {
    const items = TEST_ACCOUNTS.map((a) => '切换到测试账号 ' + a)
      .concat(['自定义测试账号', '切回真实微信账号']);
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const idx = r.tapIndex;
        if (idx < TEST_ACCOUNTS.length) {
          this.doSwitch(TEST_ACCOUNTS[idx]);
        } else if (idx === TEST_ACCOUNTS.length) {
          this.promptCustom();
        } else {
          this.backToWechat();
        }
      },
    });
  },

  promptCustom() {
    wx.showModal({
      title: '自定义测试账号',
      editable: true,
      placeholderText: '如 testC（字母/数字/下划线，≤32 字）',
      success: (r) => {
        if (r.confirm && r.content && r.content.trim()) this.doSwitch(r.content.trim());
      },
    });
  },

  doSwitch(uid) {
    wx.showLoading({ title: '切换中', mask: true });
    switchTestAccount(uid)
      .then((u) => {
        wx.hideLoading();
        wx.showToast({ title: '已切换为 ' + (u.nickname || uid), icon: 'none' });
        setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 500);
      })
      .catch((e) => {
        wx.hideLoading();
        wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
      });
  },

  /** 切回真实微信账号：清登录态后回到首页重新走 wx.login */
  backToWechat() {
    clearAuth();
    wx.showToast({ title: '已切回微信账号', icon: 'none' });
    setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 500);
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '将清除本机登录信息，下次进入会重新授权',
      success: (r) => {
        if (!r.confirm) return;
        clearAuth();
        wx.showToast({ title: '已退出', icon: 'none' });
        setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
      },
    });
  },
});
