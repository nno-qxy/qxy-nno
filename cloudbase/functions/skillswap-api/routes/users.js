/**
 * 用户公开页（从帖子作者头像点进来看到的那一页）
 * - GET /api/users/:openid/profile  基本信息 + 好评率 + TA 发布过的帖子
 * - GET /api/users/:openid/reviews  TA 收到的评价
 *
 * 隐私约定：只下发展示所需字段。真实姓名（realName）、学号（studentId）、
 *          联系方式（contact）、账号状态（status）一律不对外暴露。
 */

const { C, ok, AppError } = require('../lib/resp');
const { db, COLLECTIONS } = require('../lib/db');
const userService = require('../services/userService');
const reviews = require('../lib/reviews');

// 与 posts.js 列表投影保持一致（真库要求投影要么全 true 要么全 false）
const LIST_FIELDS = {
  _id: true, type: true, category: true, title: true, content: true,
  tags: true, authorId: true, authorName: true, authorAvatar: true,
  status: true, createTime: true,
};

const POST_LIMIT = 20; // 主页最多展示 20 条在架帖子
const EX_LIMIT = 50;   // 每个方向最多扫 50 条交换记录

/** 对外公开的用户资料（脱敏后的展示字段） */
function publicProfile(u) {
  if (!u) return null;
  return {
    openid: u._openid,
    nickname: u.nickname || '',
    avatarColor: u.avatarColor || '#2B62E0',
    grade: u.grade || '',
    major: u.major || '',
    tags: u.tags || [],
    goodCount: u.goodCount || 0,
    totalCount: u.totalCount || 0,
    createTime: u.createTime || 0,
  };
}

/** 评价人展示名（昵称优先，空则回退真实姓名），只取展示字段 */
async function briefOf(openid) {
  try {
    const u = await userService.findByOpenid(openid);
    if (!u) return { name: '', avatar: '' };
    return { name: u.nickname || u.realName || '', avatar: u.avatarColor || '' };
  } catch (_) {
    return { name: '', avatar: '' };
  }
}

/**
 * GET /api/users/:openid/profile
 * 公开资料 + 该用户 status=passed 的帖子（按时间倒序）
 */
async function profile(req) {
  const openid = String((req.params && req.params.openid) || '').trim();
  if (!openid) throw new AppError(C.BAD_REQUEST, 'openid 必填');
  const user = await userService.findByOpenid(openid);
  if (!user) throw new AppError(C.NOT_FOUND, '用户不存在');

  const res = await db(COLLECTIONS.POSTS)
    .where({ authorId: openid, status: 'passed' })
    .field(LIST_FIELDS)
    .orderBy('createTime', 'desc')
    .limit(POST_LIMIT)
    .get();

  return ok({ user: publicProfile(user), posts: res.data || [] });
}

/**
 * GET /api/users/:openid/reviews
 * TA 收到的评价：扫 TA 参与的已完成交换，取对方提交的那条
 */
async function reviewsOf(req) {
  const openid = String((req.params && req.params.openid) || '').trim();
  if (!openid) throw new AppError(C.BAD_REQUEST, 'openid 必填');
  const user = await userService.findByOpenid(openid);
  if (!user) throw new AppError(C.NOT_FOUND, '用户不存在');

  // exchanges 没有 openid 索引，拆两次查询再合并（兼容 mock 与真实库）
  const asApplicant = await db(COLLECTIONS.EXCHANGES)
    .where({ applicantId: openid }).orderBy('createTime', 'desc').limit(EX_LIMIT).get();
  const asTarget = await db(COLLECTIONS.EXCHANGES)
    .where({ targetId: openid }).orderBy('createTime', 'desc').limit(EX_LIMIT).get();

  const seen = {};
  const list = [];
  const merged = (asApplicant.data || []).concat(asTarget.data || []);
  for (let i = 0; i < merged.length; i++) {
    const ex = merged[i];
    if (!ex || seen[ex._id]) continue;
    seen[ex._id] = 1;
    if (ex.status !== 'completed') continue;
    // 收到的评价 = 对方提交的那条（openid 不等于本人）
    const got = reviews.normalizeEvals(ex.evaluations).filter((e) => e.openid !== openid);
    for (let j = 0; j < got.length; j++) {
      const e = got[j];
      if (!e.rating && !e.comment) continue; // 既无评分又无评语的空评价不展示
      const brief = await briefOf(e.openid);
      list.push({
        evaluatorName: brief.name,
        evaluatorAvatar: brief.avatar,
        role: e.role,
        rating: e.rating,
        comment: e.comment,
        time: e.time,
        postId: ex.postId || '',
        postTitle: ex.postTitle || '',
      });
    }
  }
  list.sort((a, b) => (b.time || 0) - (a.time || 0));
  return ok({ list, summary: reviews.summarize(list) });
}

module.exports = [
  { method: 'GET', path: '/api/users/:openid/profile', handler: profile },
  { method: 'GET', path: '/api/users/:openid/reviews', handler: reviewsOf },
];
