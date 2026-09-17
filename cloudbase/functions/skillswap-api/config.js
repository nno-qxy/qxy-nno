/**
 * 统一配置：只读云函数环境变量，绝不硬编码任何密钥
 * 需要在 CloudBase 控制台 → 云函数 → 函数配置 → 环境变量 中设置
 */
module.exports = {
  // 环境
  TCB_ENV: process.env.TCB_ENV || '',

  // 微信小程序
  WX_APPID: process.env.WX_APPID || '',
  WX_SECRET: process.env.WX_SECRET || '',

  // 自签 token
  TOKEN_SECRET: process.env.TOKEN_SECRET || '',
  TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 天

  // 管理员账号（口令哈希存环境变量，不明文）
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS_HASH: process.env.ADMIN_PASS_HASH || '',
  ADMIN_MAX_TRY: 5,
  ADMIN_LOCK_MS: 30 * 60 * 1000, // 锁定 30 分钟

  // 腾讯云文本内容安全 TMS（选做，未配置则全程走本地词表降级）
  TMS_SECRET_ID: process.env.TMS_SECRET_ID || '',
  TMS_SECRET_KEY: process.env.TMS_SECRET_KEY || '',
  TMS_REGION: process.env.TMS_REGION || 'ap-guangzhou',

  // 业务常量
  PAGE_SIZE: 10,
  CATEGORIES: ['学业辅导', '语言交流', '文艺特长', '体育健身', '数码技能', '生活服务'],

  // ⚠️ 测试沙盒（默认关闭）：开启后允许「对自己的帖子发起交换」，
  // 让单个微信账号也能在真机上走通 发起→同意→完成→互评 全链路。
  // 仅用于验收测试，上线前务必移除该环境变量或置为 false。
  SANDBOX_MODE: process.env.SANDBOX_MODE === 'true',

  isTmsEnabled() {
    return !!(this.TMS_SECRET_ID && this.TMS_SECRET_KEY);
  },
  isWxEnabled() {
    return !!(this.WX_APPID && this.WX_SECRET);
  },
  isSandbox() {
    return this.SANDBOX_MODE === true;
  },
};
