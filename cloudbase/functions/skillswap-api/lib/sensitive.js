/**
 * 本地敏感词表（双层）
 *
 * 1) BLOCK_WORDS 违规词：零成本、同步、命中即拒（不消耗 TMS）
 *    —— 发布接口直接 422，用户可修改后重发
 *
 * 2) REVIEW_WORDS 风控词：擦边/灰产高发词，命中不拒帖，
 *    但强制 status=pending 进人工审核队列（即使 TMS=Pass 也不自动上广场）
 *    —— 解决「考试内部资料 / 刷课 / 包过 / 复制校园卡」这类 TMS 判 Normal
 *       但平台不允许的内容绕过审核直接发布的问题
 *
 * 命中后才（或管理员手动触发时）才调用腾讯云 TMS，以此控制资源点消耗
 */

const BLOCK_WORDS = [
  '代考', '替考', '代写', '枪手', '答案', '作弊',
  '刷单', '刷量', '刷赞', '水军',
  '贷款', '校园贷', '裸贷', '套现', '征信修复',
  '赌博', '博彩', '六合彩', '赌场',
  '兼职日结', '日入过万', '轻松赚钱', '躺赚',
  '加微信', '加V', '加v', '加我微信', '私聊我', 'vx', 'VX', 'V信',
  '收款码', '转账私',
  '色情', '约炮', '裸聊',
  '出售个人信息', '办证', '发票代开',
];

const REVIEW_WORDS = [
  // 考试 / 学业灰产
  '内部资料', '内部渠道', '保过', '包过', '保分', '代做', '代上', '替课',
  '卖答案', '出售答案', '买答案', '改分', '买分', '卖分',
  // 刷量类
  '刷课', '刷分', '代刷', '刷绩点',
  // 卡证 / 支付灰产
  '复制校园卡', '复制卡', '克隆卡', '破解校园卡',
  '有偿代', '付费代', '押金先付', '先付定金', '付定金',
];

/** 命中违规词返回命中的词，未命中返回 null */
function hit(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.toLowerCase();
  for (const w of BLOCK_WORDS) {
    if (s.includes(w.toLowerCase())) return w;
  }
  return null;
}

function hitAny(textArr) {
  for (const t of textArr || []) {
    const w = hit(t);
    if (w) return w;
  }
  return null;
}

/** 命中风控词返回命中的词，未命中返回 null */
function hitReview(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.toLowerCase();
  for (const w of REVIEW_WORDS) {
    if (s.includes(w.toLowerCase())) return w;
  }
  return null;
}

function hitReviewAny(textArr) {
  for (const t of textArr || []) {
    const w = hitReview(t);
    if (w) return w;
  }
  return null;
}

module.exports = {
  WORDS: BLOCK_WORDS,
  BLOCK_WORDS,
  REVIEW_WORDS,
  hit,
  hitAny,
  hitReview,
  hitReviewAny,
};
