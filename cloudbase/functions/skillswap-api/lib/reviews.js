/**
 * 评价域公共逻辑（Z-11 评价 / 用户主页 / 帖子评价区 共用）
 *
 * 数据存放：exchanges.evaluations 数组，元素统一为
 *   { openid, role: 'teacher'|'learner', rating: 'satisfied'|'dissatisfied'|'none'|null, comment, time }
 * 旧版只有 { openid, satisfied, time }，由 normalizeEval 兜底转换，保证老数据也能正常展示。
 *
 * 计分规则（好评率）：
 *   只有「学员对教学者」的明确评价（satisfied / dissatisfied）进入统计；
 *   学员的「暂不评价」（none）与教学者的纯评语（rating=null）都不进分母。
 */

const RATINGS = ['satisfied', 'dissatisfied', 'none'];

/** 统一单条评价的字段形态 */
function normalizeEval(e) {
  if (!e) return null;
  let rating = e.rating != null && e.rating !== '' ? String(e.rating) : null;
  // 兼容旧版布尔 satisfied
  if (rating == null && typeof e.satisfied === 'boolean') {
    rating = e.satisfied ? 'satisfied' : 'dissatisfied';
  }
  if (rating != null && !RATINGS.includes(rating)) rating = null;
  return {
    openid: e.openid || '',
    role: e.role === 'teacher' || e.role === 'learner' ? e.role : '',
    rating,
    comment: e.comment ? String(e.comment) : '',
    time: e.time || 0,
  };
}

function normalizeEvals(list) {
  return (list || []).map(normalizeEval).filter((e) => e && e.openid);
}

/**
 * 判定某人在一次交换中的角色
 * teach 帖：帖主 = 教学者（提供服务），申请人 = 学员
 * learn 帖：帖主 = 学员（想学），申请人 = 教学者（来教）
 */
function roleOf(ex, openid, postType) {
  const isOwner = !!(ex && ex.targetId === openid);
  if (postType === 'learn') return isOwner ? 'learner' : 'teacher';
  return isOwner ? 'teacher' : 'learner';
}

/** 好评率统计：只计学员的明确评价（输入可为原始 evaluations，也可为已渲染的展示对象） */
function summarize(evals) {
  let satisfied = 0;
  let dissatisfied = 0;
  (evals || []).forEach((x) => {
    const e = normalizeEval(x);
    if (!e) return;
    if (e.rating === 'satisfied') satisfied++;
    else if (e.rating === 'dissatisfied') dissatisfied++;
  });
  const total = satisfied + dissatisfied;
  return {
    satisfied,
    dissatisfied,
    total,
    goodRate: total ? Math.round((satisfied / total) * 100) : null,
  };
}

module.exports = { RATINGS, normalizeEval, normalizeEvals, roleOf, summarize };
