/**
 * 运行时配置
 * 环境与后端地址集中在此，部署后只需改 ENV_ID
 */

const ENV_ID = 'nno-d2gspwvpl6c3c9f46';

/**
 * HTTP 网关默认域名（已在控制台 HTTP 网关 → 路由管理中确认）
 * 格式：<envId>-<创建时间戳>.ap-shanghai.app.tcloudbase.com
 * 注意：不是 <envId>.service.tcloudbase.com，也不是带 -c9f46 的中间串
 */
const HTTP_DOMAIN = 'nno-d2gspwvpl6c3c9f46-1479540360.ap-shanghai.app.tcloudbase.com';

module.exports = {
  ENV_ID,
  HTTP_DOMAIN,

  // 云函数 HTTP 访问服务域名（需在小程序后台加入 request 合法域名）
  API_BASE: 'https://' + HTTP_DOMAIN + '/skillswap-api',

  // Web 管理端（由 admin-static 云函数托管，仅作为提示用，小程序内不访问）
  ADMIN_BASE: 'https://' + HTTP_DOMAIN + '/skillswap-web',

  // 是否为调试模式：打开后会打印请求日志
  DEBUG: true,

  // 固定 6 类分类（与需求规格 3.x 一致，不做分类管理）
  CATEGORIES: ['学业辅导', '语言交流', '文艺特长', '体育健身', '数码技能', '生活服务'],

  PAGE_SIZE: 10,
};
