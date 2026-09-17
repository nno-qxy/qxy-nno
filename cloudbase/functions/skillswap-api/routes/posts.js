/**
 * 帖子路由（Z-03 广场 / Z-04 发布 / Z-06 内容安全 / Z-12 我的发布 + 驳回重提）
 * 阶段 2：全量实现
 */
const { C, ok, AppError } = require('../lib/resp');
const { requireAuth } = require('../lib/auth');
const { db, now, COLLECTIONS, cmd } = require('../lib/db');
const reviews = require('../lib/reviews');
const exchangeState = require('../lib/exchangeState');
const search = require('../lib/search');
const config = require('../config');
const sensitive = require('../lib/sensitive');
const tms = require('../lib/tms');

const PAGE_SIZE = config.PAGE_SIZE;
const CATEGORIES = config.CATEGORIES;
const TYPES = ['teach', 'learn'];

/**
 * 混合审核模式下的状态判定（Z-06）
 * 前置：本地词表命中 / TMS=Block 已由调用方直接拦截，不会走到这里。
 * - TMS=Pass（且非降级） → 'passed' 直接上广场
 * - TMS=Review / 降级(Unknown, 如 TMS 未配置或调用异常) → 'pending' 进人工审核队列（安全优先）
 */
function decideStatus(tmsResult) {
  if (tmsResult && tmsResult.suggestion === 'Pass' && !tmsResult.degraded) {
    return 'passed';
  }
  return 'pending';
}

/**
 * 按 tag 重合度对候选帖排序（Z-07 相关推荐，纯函数便于单测）
 * @param {Array} rows 候选帖（已限定 passed 且至少含一个相同 tag）
 * @param {Array<string>} tagArr 当前帖的 tags
 * @returns 降序列表：先按重合 tag 数，再按 createTime 新→旧
 */
function rankRelated(rows, tagArr) {
  const set = new Set(tagArr || []);
  return (rows || [])
    .map((p) => {
      const overlap = (p.tags || []).filter((t) => set.has(t)).length;
      return { p, score: overlap };
    })
    .sort((a, b) => b.score - a.score || (b.p.createTime - a.p.createTime))
    .map((x) => x.p);
}

// 列表字段投影：只返回前端必要的字段，省流量
// ⚠️ MongoDB 规则：投影要么全 true 要么全 false（_id 是例外），不能混用
//   列表里不需要 rejectReason（详情页才需要），不写即默认不返回
const LIST_FIELDS = {
  _id: true, type: true, category: true, title: true, content: true,
  tags: true, authorId: true, authorName: true, authorAvatar: true,
  status: true, createTime: true,
};

function toInt(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function trimOrUndef(s, max) {
  if (s == null) return '';
  const t = String(s).trim();
  return max && t.length > max ? t.slice(0, max) : t;
}

/**
 * 游标分页查询
 * 多取 1 条（limit+1）用于探测是否真的还有下一页：
 * - 若只取 PAGE_SIZE 条，满页时无法区分「刚好是最后一页」还是「后面还有」，
 *   前端会多拉一次空页才看到「已经到底」。
 * - 多取 1 条后，若实际返回 PAGE_SIZE+1 条，说明后面还有，截掉第 11 条并给出 nextCursor。
 */
async function pageQuery(where) {
  const res = await db(COLLECTIONS.POSTS)
    .where(where)
    .field(LIST_FIELDS)
    .orderBy('createTime', 'desc')
    .limit(PAGE_SIZE + 1)
    .get();
  const rows = res.data || [];
  const hasMore = rows.length > PAGE_SIZE;
  const list = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? list[list.length - 1].createTime : null;
  return { list, nextCursor };
}

/**
 * GET /api/posts
 * 广场列表（公开），默认只返回 status=passed 的帖子
 * Query: cursor=<createTime 毫秒>、type=teach|learn、category=...、keyword=...
 *   keyword：标签搜索（同时兼容标题 / 正文关键词），大小写不敏感的子串匹配
 * Resp: { list: [...], nextCursor: number|null }
 */
async function list(req) {
  const { cursor, type, category, keyword } = req.query;
  const where = { status: 'passed' };
  if (type) {
    if (!TYPES.includes(type)) throw new AppError(C.BAD_REQUEST, 'type 不合法');
    where.type = type;
  }
  if (category) {
    if (!CATEGORIES.includes(category)) throw new AppError(C.BAD_REQUEST, 'category 不合法');
    where.category = category;
  }
  const kw = search.norm(keyword);
  if (kw) {
    // 标签优先：命中 tags 任一元素即算命中，顺带兼容标题 / 正文
    const re = search.like(kw);
    where.$or = [{ tags: re }, { title: re }, { content: re }];
  }
  if (cursor) {
    const c = toInt(cursor);
    if (!Number.isFinite(c) || c <= 0) throw new AppError(C.BAD_REQUEST, 'cursor 无效');
    where.createTime = { $lt: c };
  }
  const { list, nextCursor } = await pageQuery(where);
  return ok({ list, nextCursor });
}

/**
 * GET /api/posts/mine
 * 我的发布（需登录，含全部状态）
 * Query: cursor=<createTime 毫秒>、status=pending|passed|rejected|offline（可选）
 */
async function mine(req) {
  const auth = requireAuth(req);
  const { cursor, status } = req.query;
  const where = { authorId: auth.openid };
  if (status) {
    if (!['pending', 'passed', 'rejected', 'offline'].includes(status)) {
      throw new AppError(C.BAD_REQUEST, 'status 不合法');
    }
    where.status = status;
  }
  if (cursor) {
    const c = toInt(cursor);
    if (!Number.isFinite(c) || c <= 0) throw new AppError(C.BAD_REQUEST, 'cursor 无效');
    where.createTime = { $lt: c };
  }
  const { list, nextCursor } = await pageQuery(where);
  return ok({ list, nextCursor });
}

/**
 * GET /api/posts/:id
 * 详情。status=passed 公开，其他状态仅作者/管理员可见
 * passed 时附带 exchangeState（该帖的交换占用情况）：
 *   busy=true → 该帖已有进行中的交换：帖主暂时不能再确认新申请、其余待开始也不能开始
 *   （「待开始」不占用帖子，其他人随时可以发起申请）
 */
async function detail(req) {
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');
  const res = await db(COLLECTIONS.POSTS).where({ _id: id }).limit(1).get();
  const post = res.data && res.data[0];
  if (!post) throw new AppError(C.NOT_FOUND, '帖子不存在');
  if (post.status !== 'passed') {
    let auth = null;
    try { auth = requireAuth(req); } catch (_) { /* 未登录视同无权限 */ }
    const isAuthor = auth && auth.openid === post.authorId;
    const isAdmin = auth && auth.role === 'admin';
    if (!isAuthor && !isAdmin) throw new AppError(C.NOT_FOUND, '帖子不存在');
  } else {
    post.exchangeState = await exchangeState.of(post._id);
  }
  return ok(post);
}

/**
 * GET /api/posts/related
 * Z-07 相关推荐：根据当前帖 tags 找「同 tag 的已通过帖子」
 * Query: tags=<逗号分隔或数组>、exclude=<当前帖 id，避免自荐>、limit=（默认 5，最大 20）
 *        type=teach|learn（可选）→ 只看该类型，用于「发布后的互补推荐」
 *          · 用户发「我能教」→ 前端传 type=learn，展示同标签「我想学」
 *          · 用户发「我想学」→ 前端传 type=teach，展示同标签「我能教」
 * 先按 tags 交集在 DB 层粗筛（status=passed 且 tags 命中其一），再在内存按重合数降序排。
 * 注意：路由注册必须在 /api/posts/:id 之前，否则会被 :id 误匹配。
 */
async function related(req) {
  const { tags, exclude, limit, type } = req.query || {};
  const tagArr = Array.isArray(tags)
    ? tags.map(String).filter(Boolean)
    : String(tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!tagArr.length) return ok({ list: [] });
  if (type && !TYPES.includes(type)) throw new AppError(C.BAD_REQUEST, 'type 不合法');

  const lim = Math.min(toInt(limit) || 5, 20);
  const dbLimit = Math.min(lim * 3, 50); // 多取一些再排序，避免漏掉高相关项

  const where = { status: 'passed', tags: cmd().in(tagArr) };
  // 互补推荐场景：发布「我能教」时只看「我想学」，反之亦然（type 由前端传互补值）
  if (type) where.type = type;
  if (exclude) where._id = cmd().neq(exclude);

  const res = await db(COLLECTIONS.POSTS)
    .where(where)
    .field(LIST_FIELDS)
    .limit(dbLimit)
    .get();
  const list = rankRelated(res.data || [], tagArr).slice(0, lim);
  return ok({ list });
}

/**
 * GET /api/posts/counts
 * 广场意图 Tab 的数量徽标（公开），只统计 status=passed
 * Query: category=（可选，限定某个分类）、keyword=（可选，与列表同一套筛选）
 * Resp: { all, teach, learn }
 * 三次计数串行执行：db() 会缓存集合对象，并发 where() 在部分 SDK 版本下会互相污染查询链。
 * 注意：路由注册必须在 /api/posts/:id 之前，否则会被 :id 误匹配。
 */
async function counts(req) {
  const { category, keyword } = req.query || {};
  const base = { status: 'passed' };
  if (category) {
    if (!CATEGORIES.includes(category)) throw new AppError(C.BAD_REQUEST, 'category 不合法');
    base.category = category;
  }
  const kw = search.norm(keyword);
  if (kw) {
    const re = search.like(kw);
    base.$or = [{ tags: re }, { title: re }, { content: re }];
  }
  const all = await db(COLLECTIONS.POSTS).where(base).count();
  const teach = await db(COLLECTIONS.POSTS)
    .where(Object.assign({}, base, { type: 'teach' }))
    .count();
  const learn = await db(COLLECTIONS.POSTS)
    .where(Object.assign({}, base, { type: 'learn' }))
    .count();
  return ok({
    all: (all && all.total) || 0,
    teach: (teach && teach.total) || 0,
    learn: (learn && learn.total) || 0,
  });
}

/**
 * GET /api/posts/tags
 * 热门标签（公开）：给广场搜索框做「点标签直接搜」的候选
 * Query: limit=（默认 12，最大 30）、category=（可选，跟随分类 chips）
 * Resp: { list: [{ tag, count }] } —— 按出现次数降序，次数相同按标签名升序
 * 取最近 300 条已上广场的帖子在内存聚合：标签总量有限，避免引入聚合管道。
 * 注意：路由注册必须在 /api/posts/:id 之前。
 */
async function hotTags(req) {
  const { limit, category } = req.query || {};
  const lim = Math.min(toInt(limit) || 12, 30);
  const where = { status: 'passed' };
  if (category) {
    if (!CATEGORIES.includes(category)) throw new AppError(C.BAD_REQUEST, 'category 不合法');
    where.category = category;
  }
  const res = await db(COLLECTIONS.POSTS)
    .where(where)
    .field({ tags: true })
    .orderBy('createTime', 'desc')
    .limit(300)
    .get();
  const counter = Object.create(null);
  (res.data || []).forEach((p) => {
    (p.tags || []).forEach((t) => {
      const k = String(t || '').trim();
      if (k) counter[k] = (counter[k] || 0) + 1;
    });
  });
  const list = Object.keys(counter)
    .map((tag) => ({ tag, count: counter[tag] }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
    .slice(0, lim);
  return ok({ list });
}

/** 评价人展示名（昵称优先，空则回退真实姓名），只取展示字段 */
async function briefOf(openid) {
  try {
    const u = await db(COLLECTIONS.USERS)
      .where({ _openid: openid })
      .field({ nickname: true, realName: true, avatarColor: true })
      .limit(1)
      .get();
    const d = u.data && u.data[0];
    if (!d) return { name: '', avatar: '' };
    return { name: d.nickname || d.realName || '', avatar: d.avatarColor || '' };
  } catch (_) {
    return { name: '', avatar: '' };
  }
}

/**
 * GET /api/posts/:id/reviews
 * 帖子评价区（类似售后评价）：汇总该帖关联的已完成交换里的评价
 * - 学员（接受教学的一方）留下的「满意 / 不满意」及可选评语
 * - 教学者留下的纯文字评语
 * Resp: { list: [{evaluatorName, evaluatorAvatar, role, rating, comment, time}], summary }
 * 注意：路由注册放在 /api/posts/:id 之前，避免被同前缀规则抢先匹配。
 */
async function postReviews(req) {
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.EXCHANGES)
    .where({ postId: id, status: 'completed' })
    .orderBy('createTime', 'desc')
    .limit(50)
    .get();
  const rows = res.data || [];

  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const evals = reviews.normalizeEvals(rows[i].evaluations);
    for (let j = 0; j < evals.length; j++) {
      const e = evals[j];
      if (!e.rating && !e.comment) continue; // 空白评价不展示
      const brief = await briefOf(e.openid);
      list.push({
        evaluatorName: brief.name,
        evaluatorAvatar: brief.avatar,
        role: e.role,
        rating: e.rating,
        comment: e.comment,
        time: e.time,
      });
    }
  }
  list.sort((a, b) => (b.time || 0) - (a.time || 0));
  return ok({ list, summary: reviews.summarize(list) });
}

/**
 * POST /api/posts
 * 发布技能帖。流程：登录校验 → 字段校验 → 本地词表 → TMS → 落库
 * 内容安全（机器层）只做「拦截」，不自动放行：通过机器层的帖子进入 status=pending
 * 审核队列，由管理员在管理端审核（G-03 AI 预审 + G-04 通过/驳回）后才变为 passed 上广场。
 * 这样保证每篇帖都经过人工审核，符合平台「发布需审核」的要求。
 */
async function create(req) {
  const auth = requireAuth(req);
  const b = req.body || {};
  const { type, category } = b;
  const title = trimOrUndef(b.title, 30);
  const content = trimOrUndef(b.content, 500);
  const tagArr = Array.isArray(b.tags)
    ? b.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : [];

  if (!TYPES.includes(type)) throw new AppError(C.BAD_REQUEST, 'type 必须是 teach 或 learn');
  if (!CATEGORIES.includes(category)) throw new AppError(C.BAD_REQUEST, 'category 不合法');
  if (title.length < 4) throw new AppError(C.BAD_REQUEST, '标题至少 4 字');
  if (content.length < 10) throw new AppError(C.BAD_REQUEST, '正文至少 10 字');
  if (Array.isArray(b.tags) && b.tags.length > 8) {
    throw new AppError(C.BAD_REQUEST, '标签最多 8 个');
  }
  if (tagArr.some((t) => t.length > 12)) throw new AppError(C.BAD_REQUEST, '单个标签不超过 12 字');

  // Z-06 第一层：本地违规词表（命中即拒，不消耗 TMS）
  const texts = [title, content, ...tagArr];
  const localHit = sensitive.hitAny(texts);
  if (localHit) {
    throw new AppError(C.CONTENT_REJECTED, `内容包含违规词「${localHit}」，请修改后重试`);
  }
  // Z-06 第 1.5 层：本地风控词表（擦边灰产词，不拒帖但强制进人工审核）
  // 解决「考试内部资料 / 刷课 / 包过」等 TMS 判 Normal 但平台不允许直接发布的内容
  const reviewHit = sensitive.hitReviewAny(texts);

  // Z-06 第二层：TMS（混合审核模式）
  // Block → 直接拦截；Pass → 直接上广场；Review / 降级(Unknown) → 进人工审核队列
  // 风控词命中 → 无论 TMS 结论如何一律 pending（安全优先）
  const tmsResult = await tms.checkText(texts.join('\n'));
  if (tmsResult.suggestion === 'Block') {
    throw new AppError(C.CONTENT_REJECTED, '内容存在违规，已拦截');
  }
  const status = reviewHit ? 'pending' : decideStatus(tmsResult);

  // 查用户冗余字段（避免列表 join）
  let authorName = '';
  let authorAvatar = '';
  let foundUser = null;
  try {
    const u = await db(COLLECTIONS.USERS)
      .where({ _openid: auth.openid })
      .field({ nickname: true, realName: true, studentId: true, avatarColor: true })
      .limit(1)
      .get();
    foundUser = (u.data && u.data[0]) || null;
    if (foundUser) {
      authorName = foundUser.nickname || foundUser.realName || '';
      authorAvatar = foundUser.avatarColor || '';
    }
  } catch (_) { /* 查询异常时 foundUser 保持 null，下面按「资料未完善」拦截 */ }

  // 发布前资料完整性校验（兜底，防绕过前端直接调 API）
  // 必填项与「个人信息页」一致：姓名 + 学号
  const realNameOk = String(foundUser && foundUser.realName || '').trim().length > 0;
  const studentIdOk = /^\d{8,15}$/.test(String(foundUser && foundUser.studentId || '').trim());
  if (!realNameOk || !studentIdOk) {
    throw new AppError(C.BAD_REQUEST, '请先在「我的-个人信息」完善姓名与学号后再发布');
  }

  const t = now();
  const doc = {
    title, type, category, content, tags: tagArr,
    authorId: auth.openid, authorName, authorAvatar,
    status, createTime: t, updateTime: t,
  };
  const addRes = await db(COLLECTIONS.POSTS).add(doc);
  // 兼容不同版本 SDK 的 add 返回结构
  const newId =
    (addRes.ids && addRes.ids[0]) ||
    addRes._id ||
    addRes.id ||
    addRes.insertedId;
  return ok({ _id: newId, ...doc });
}

/**
 * POST /api/posts/:id/republish
 * 驳回重提：仅作者 + 仅 status=rejected 时可用
 * 重新过内容安全（防绕过），按混合审核模式判定状态（Pass 直接上广场 / Review 进人工审核）
 */
async function republish(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');
  const res = await db(COLLECTIONS.POSTS).where({ _id: id }).limit(1).get();
  const cur = res.data && res.data[0];
  if (!cur) throw new AppError(C.NOT_FOUND, '帖子不存在');
  if (cur.authorId !== auth.openid) throw new AppError(C.FORBIDDEN, '只能重提自己的帖子');
  if (cur.status !== 'rejected') throw new AppError(C.CONFLICT, '只有驳回状态可重提');

  const republishTexts = [cur.title, cur.content, ...(cur.tags || [])];
  const localHit = sensitive.hitAny(republishTexts);
  if (localHit) throw new AppError(C.CONTENT_REJECTED, `内容包含违规词「${localHit}」`);
  const reviewHit = sensitive.hitReviewAny(republishTexts);
  const tmsResult = await tms.checkText(republishTexts.join('\n'));
  if (tmsResult.suggestion === 'Block') {
    throw new AppError(C.CONTENT_REJECTED, '内容存在违规，已拦截');
  }
  const status = reviewHit ? 'pending' : decideStatus(tmsResult);

  const t = now();
  await db(COLLECTIONS.POSTS).where({ _id: id }).update({
    status,
    rejectReason: '',
    reviewTime: t, reviewer: '',
    updateTime: t,
  });
  return ok({ _id: id, status });
}

module.exports = [
  { method: 'GET', path: '/api/posts', handler: list },
  { method: 'GET', path: '/api/posts/mine', handler: mine },
  { method: 'GET', path: '/api/posts/related', handler: related },
  { method: 'GET', path: '/api/posts/counts', handler: counts },
  { method: 'GET', path: '/api/posts/tags', handler: hotTags },
  { method: 'GET', path: '/api/posts/:id/reviews', handler: postReviews },
  { method: 'GET', path: '/api/posts/:id', handler: detail },
  { method: 'POST', path: '/api/posts', handler: create },
  { method: 'POST', path: '/api/posts/:id/republish', handler: republish },
];

// 暴露纯函数供单测（不影响路由数组，index.js 用 .concat 展开数组）
module.exports.rankRelated = rankRelated;
