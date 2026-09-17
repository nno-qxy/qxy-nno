/**
 * 小程序入口
 * 约束：不使用 wx.cloud，一律 wx.request 调云函数 HTTP 地址
 */

const { ensureLogin, clearAuth } = require('./utils/auth.js');

App({
  globalData: {
    user: null, // { openid, nickname, studentId, ... }
    loginReady: false,
  },

  onLaunch() {
    // 隐私合规：先走微信隐私授权（控制台已配置《隐私保护指引》后才会弹出），
    // 用户同意后微信后端记录授权，再执行静默登录。未配置时 getPrivacySetting
    // 返回 needAuthorization=false，不影响现有开发体验。
    this.handlePrivacyThenLogin();
  },

  /** 隐私授权 → 登录 的串行流程 */
  handlePrivacyThenLogin() {
    const proceed = () => this.doLogin();

    if (typeof wx.getPrivacySetting !== 'function') return proceed();

    wx.getPrivacySetting({
      success: (res) => {
        if (res && res.needAuthorization) {
          // 调起微信官方隐私授权弹窗，同意动作由微信记录为合规授权
          wx.requirePrivacyAuthorize({
            success: () => proceed(),
            fail: () => proceed(), // 用户拒绝仍进入，登录等隐私接口将受限，由失败兜底
          });
        } else {
          proceed();
        }
      },
      fail: () => proceed(),
    });
  },

  /** 静默登录：拿 code → 换 openid → 建号/取号，用户无感知 */
  doLogin() {
    ensureLogin()
      .then((user) => {
        this.globalData.user = user;
        this.globalData.loginReady = true;
        if (this.loginCallback) this.loginCallback(user);
      })
      .catch((err) => {
        console.error('[app] 自动登录失败', err);
        this.globalData.loginReady = false;
      });
  },

  /** 页面在 onLoad 时若登录未完成，可注册回调等待 */
  waitLogin(cb) {
    if (this.globalData.loginReady && this.globalData.user) {
      cb(this.globalData.user);
    } else {
      this.loginCallback = cb;
    }
  },

  setUser(user) {
    this.globalData.user = user;
  },

  logout() {
    clearAuth();
    this.globalData.user = null;
    this.globalData.loginReady = false;
  },
});
