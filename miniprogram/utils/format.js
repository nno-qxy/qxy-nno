/** 展示层格式化工具：时间、状态文案、类型文案 */

const CATEGORIES = ['学业辅导', '语言交流', '文艺特长', '体育健身', '数码技能', '生活服务'];

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 列表用相对时间；超过 7 天显示日期 */
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + '分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '小时前';
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 7) return d + '天前';
  const dt = new Date(ts);
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
}

function dateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  );
}

/** 帖子审核状态 */
const POST_STATUS = {
  pending: { text: '待审核', cls: 'pending' },
  passed: { text: '已通过', cls: 'ok' },
  rejected: { text: '已驳回', cls: 'warn' },
  offline: { text: '已下架', cls: 'pending' },
};

/** 交换状态（待评价/已结束由 evaluations 是否齐全判定，见 exchangeStatus） */
const EXCHANGE_STATUS = {
  pending: { text: '待确认', cls: 'pending' },
  active: { text: '待开始', cls: 'teach' },
  started: { text: '进行中', cls: 'teach' },
  rejected: { text: '已拒绝', cls: 'warn' },
  cancelled: { text: '已取消', cls: 'pending' },
  completed: { text: '已完成', cls: 'ok' },
};

/**
 * 交换条目状态：completed 但评价未齐全 → 待评价；齐全 → 已结束
 * @param {object} ex { status, evaluations, myOpenid }
 */
function exchangeStatus(ex) {
  if (ex.status === 'completed') {
    const ev = ex.evaluations || [];
    const mine = ev.some((e) => e.openid === ex.myOpenid);
    if (ev.length >= 2) return { text: '已结束', cls: 'ok' };
    return { text: mine ? '待对方评价' : '待评价', cls: 'pending' };
  }
  return EXCHANGE_STATUS[ex.status] || { text: ex.status || '', cls: 'pending' };
}

function typeInfo(type) {
  return type === 'teach'
    ? { text: '我能教', cls: 'teach', arrow: '→' }
    : { text: '我想学', cls: 'learn', arrow: '←' };
}

/** 头像：色块 + 姓氏首字（不使用真实图片，与定稿原型一致） */
function avatarOf(name) {
  const s = String(name || '').trim();
  return s ? s.slice(0, 1) : '同';
}

/** 好评率：无评价时返回 null，避免显示 0% 造成误解 */
function goodRate(good, total) {
  if (!total) return null;
  return Math.round((good / total) * 100) + '%';
}

module.exports = {
  CATEGORIES, timeAgo, dateTime, POST_STATUS, EXCHANGE_STATUS,
  exchangeStatus, typeInfo, avatarOf, goodRate,
};
