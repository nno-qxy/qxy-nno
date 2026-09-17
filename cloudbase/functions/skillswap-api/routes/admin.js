/**
 * 管理端路由（G-01 登录 / G-02 待审列表 / G-03 AI 预审（选做） / G-04 通过驳回）
 * 阶段 3 实现
 *
 * 权限模型：
 * - 本文件所有接口除 login 外都必须带 admin token（requireAdmin）
 * - admin token 由 login 签发，payload = { openid: 'admin:<user>', role: 'admin' }
 * - 登录失败计数与锁定存 configs 集合（云函数无状态，不能放内存）
 */

const { C, ok, AppError } = require('../lib/resp');
const { requireAdmin, issue } = require('../lib/auth');
const { db, regExp, now, COLLECTIONS } = require('../lib/db');
const search = require('../lib/search');
const config = require('../config');
const password = require('../lib/password');
const sensitive = require('../lib/sensitive');
const tms = require('../lib/tms');

const PAGE_SIZE = config.PAGE_SIZE;

// 登录失败控制（G-01）
const FAIL_KEY = 'admin_login_fail';
const MAX_FAIL = config.ADMIN_MAX_TRY;
const LOCK_MS = config.ADMIN_LOCK_MS;

// 审核列表投影：全 true（MongoDB 投影不允许 true/false 混用）
const ADMIN_POST_FIELDS = {
  _id: true, type: true, category: true, title: true, content: true,
  tags: true, authorId: true, authorName: true, authorAvatar: true,
  status: true, createTime: true, updateTime: true,
  rejectReason: true, reviewTime: true, reviewer: true,
  offlineReason: true, offlineTime: true,
};

const ALL_STATUS = ['pending', 'passed', 'rejected', 'offline'];

function toInt(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// ---------- 登录失败记录（存 configs 集合） ----------
async function getFailRecord() {
  const res = await db(COLLECTIONS.CONFIGS).where({ key: FAIL_KEY }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function saveFailRecord(patch) {
  const cur = await getFailRecord();
  const next = Object.assign({ failCount: 0, lockedUntil: 0 }, patch, {
    key: FAIL_KEY,
    updateTime: now(),
  });
  if (!cur) {
    await db(COLLECTIONS.CONFIGS).add(next);
  } else {
    await db(COLLECTIONS.CONFIGS).where({ key: FAIL_KEY }).update(next);
  }
  return next;
}

/**
 * POST /api/admin/login
 * G-01：账号密码校验 + 失败计数 + 5 次锁定 30 分钟
 * Body: { username, password }
 * Resp: { token, username, expiresIn }
 */
async function login(req) {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const pwd = String(b.password || '');

  if (!username || !pwd) throw new AppError(C.BAD_REQUEST, '请输入账号和密码');
  if (!config.ADMIN_USER || !config.ADMIN_PASS_HASH) {
    throw new AppError(C.INTERNAL, '管理员账号未配置（ADMIN_USER / ADMIN_PASS_HASH）');
  }

  // 1. 锁定检查
  let rec = await getFailRecord();
  if (rec && rec.lockedUntil && rec.lockedUntil > now()) {
    const mins = Math.ceil((rec.lockedUntil - now()) / 60000);
    throw new AppError(C.TOO_MANY, `账号已锁定，请 ${mins} 分钟后再试`);
  }

  // 2. 校验（用户名与口令都用恒定时间比较，避免时序侧信道）
  const userOk = safeEqual(username, config.ADMIN_USER);
  const passOk = password.verify(pwd, config.ADMIN_PASS_HASH);

  if (!userOk || !passOk) {
    const count = (rec && rec.failCount ? rec.failCount : 0) + 1;
    if (count >= MAX_FAIL) {
      await saveFailRecord({ failCount: 0, lockedUntil: now() + LOCK_MS });
      throw new AppError(C.TOO_MANY, `连续输错 ${MAX_FAIL} 次，账号已锁定 30 分钟`);
    }
    await saveFailRecord({ failCount: count, lockedUntil: 0 });
    throw new AppError(
      C.UNAUTHORIZED,
      `账号或密码错误，还可尝试 ${MAX_FAIL - count} 次`,
      { remain: MAX_FAIL - count }
    );
  }

  // 3. 成功：清零计数，签发 admin token
  await saveFailRecord({ failCount: 0, lockedUntil: 0 });
  const token = issue({ openid: 'admin:' + username, role: 'admin', username });
  return ok({
    token,
    username,
    expiresIn: Math.floor(config.TOKEN_TTL_MS / 1000),
  });
}

/** 恒定时间字符串比较 */
function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) {
    // 长度不同也走一遍循环，避免提前返回泄露长度
    let dummy = 0;
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) dummy |= i;
    return dummy === -1; // 恒为 false
  }
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/**
 * GET /api/admin/posts
 * G-02：待审列表 / G-09：全量帖子管理，游标分页
 * Query:
 *   status=pending|passed|rejected|offline|all（默认 pending；all 表示不限状态）
 *   keyword=（模糊匹配 标题 / 正文 / 作者名 / 标签）
 *   category=（六大分类之一）
 *   type=teach|learn
 *   size=（默认 PAGE_SIZE，上限 100，管理端一屏看全用）
 *   cursor=（createTime 游标，仅前翻）
 */
async function listPosts(req) {
  requireAdmin(req);
  const { cursor, status, keyword, category, type } = req.query;
  const size = Math.min(Math.max(toInt(req.query.size) || PAGE_SIZE, 1), 100);

  const where = {};
  if (status && status !== 'all') {
    if (!ALL_STATUS.includes(status)) throw new AppError(C.BAD_REQUEST, 'status 不合法');
    where.status = status;
  } else if (!status) {
    where.status = 'pending'; // 管理端默认看待审
  }
  if (category) {
    if (config.CATEGORIES.indexOf(category) < 0) {
      throw new AppError(C.BAD_REQUEST, 'category 不合法');
    }
    where.category = category;
  }
  if (type) {
    if (type !== 'teach' && type !== 'learn') throw new AppError(C.BAD_REQUEST, 'type 不合法');
    where.type = type;
  }
  // 关键词：标题 / 正文 / 作者名 / 标签（标签便于按技能维度捞帖）
  const kw = search.norm(keyword);
  if (kw) {
    const re = search.like(kw);
    where.$or = [{ title: re }, { content: re }, { authorName: re }, { tags: re }];
  }
  if (cursor) {
    const c = toInt(cursor);
    if (!Number.isFinite(c) || c <= 0) throw new AppError(C.BAD_REQUEST, 'cursor 无效');
    where.createTime = { $lt: c };
  }

  // status=all 且无其他条件时 where 为空，CloudBase 空 where 查询受限，用全匹配正则兜底
  if (!Object.keys(where).length) {
    where._id = regExp({ regexp: '.*', options: 'i' });
  }

  // limit+1 探测：满页才返回 nextCursor，避免前端多拉一次空页
  const res = await db(COLLECTIONS.POSTS)
    .where(where)
    .field(ADMIN_POST_FIELDS)
    .orderBy('createTime', 'desc')
    .limit(size + 1)
    .get();
  const rows = res.data || [];
  const hasMore = rows.length > size;
  const list = hasMore ? rows.slice(0, size) : rows;
  const nextCursor = hasMore ? list[list.length - 1].createTime : null;
  return ok({ list, nextCursor });
}

/**
 * POST /api/admin/posts/:id/takedown
 * G-09：违规内容处置 —— 下架已上广场的帖子 / 恢复已下架帖子
 * Body: { action: 'offline' | 'restore', reason?: string（下架原因，≤100 字） }
 */
async function takedown(req) {
  const admin = requireAdmin(req);
  const { id } = req.params;
  const b = req.body || {};
  const action = String(b.action || '').trim();
  const reason = String(b.reason || '').trim();

  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');
  if (action !== 'offline' && action !== 'restore') {
    throw new AppError(C.BAD_REQUEST, 'action 必须是 offline 或 restore');
  }
  if (reason.length > 100) throw new AppError(C.BAD_REQUEST, '下架原因不超过 100 字');

  const res = await db(COLLECTIONS.POSTS).where({ _id: id }).limit(1).get();
  const post = res.data && res.data[0];
  if (!post) throw new AppError(C.NOT_FOUND, '帖子不存在');

  const t = now();
  const reviewer = admin.username || admin.openid || 'admin';

  if (action === 'offline') {
    if (post.status !== 'passed') {
      throw new AppError(C.CONFLICT, '只有已上广场的帖子可以下架');
    }
    await db(COLLECTIONS.POSTS).where({ _id: id }).update({
      status: 'offline',
      offlineReason: reason,
      offlineTime: t,
      reviewer,
      updateTime: t,
    });
    return ok({ _id: id, status: 'offline', offlineReason: reason });
  }

  if (post.status !== 'offline') {
    throw new AppError(C.CONFLICT, '只有已下架的帖子可以恢复');
  }
  await db(COLLECTIONS.POSTS).where({ _id: id }).update({
    status: 'passed',
    offlineReason: '',
    reviewTime: t,
    reviewer,
    updateTime: t,
  });
  return ok({ _id: id, status: 'passed' });
}

/**
 * POST /api/admin/posts/:id/ai-audit
 * G-03（选做）：AI 预审。本地词表先过，未命中再调 TMS
 * Resp: { suggestion, source, word?, label?, score?, confidence, degraded, reason? }
 */
async function aiAudit(req) {
  const admin = requireAdmin(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.POSTS).where({ _id: id }).limit(1).get();
  const post = res.data && res.data[0];
  if (!post) throw new AppError(C.NOT_FOUND, '帖子不存在');

  const texts = [post.title, post.content].concat(post.tags || []);

  // 第一层：本地违规词表（零成本，命中即建议驳回）
  const word = sensitive.hitAny(texts);
  if (word) {
    return ok({
      suggestion: 'Block',
      source: 'local',
      word,
      confidence: 100,
      degraded: false,
      summary: `本地词表命中「${word}」，建议驳回`,
    });
  }

  // 第 1.5 层：本地风控词表（擦边灰产词 → 建议人工重点复核）
  const reviewWord = sensitive.hitReviewAny(texts);
  if (reviewWord) {
    return ok({
      suggestion: 'Review',
      source: 'local',
      word: reviewWord,
      confidence: 80,
      degraded: false,
      summary: `本地风控词命中「${reviewWord}」，疑似灰产内容，建议人工重点复核`,
    });
  }

  // 第二层：TMS
  const r = await tms.checkText(texts.join('\n'));
  if (!r.enabled) {
    return ok({
      suggestion: 'Review',
      source: 'local',
      confidence: 30,
      degraded: true,
      reason: r.reason || '未配置 TMS 密钥',
      summary: '本地词表未命中；未配置 TMS，无法机审，请人工复核',
    });
  }

  const confidence = r.suggestion === 'Block' ? 95 : r.suggestion === 'Review' ? 70 : 85;
  const map = { Block: '建议驳回', Review: '建议人工复核', Pass: '建议通过' };
  return ok({
    suggestion: r.suggestion,
    source: 'tms',
    label: r.label,
    score: r.score,
    confidence,
    degraded: !!r.degraded,
    reason: r.reason,
    summary: r.degraded
      ? `TMS 不可用（${r.reason || '未知'}），建议人工复核`
      : `TMS：${map[r.suggestion] || r.suggestion}`,
  });
}

/**
 * POST /api/admin/posts/:id/review
 * G-04：通过 / 驳回
 * Body: { action: 'pass'|'reject', reason?: string（驳回必填，≤100 字） }
 */
async function review(req) {
  const admin = requireAdmin(req);
  const { id } = req.params;
  const b = req.body || {};
  const action = String(b.action || '').trim();
  const reason = String(b.reason || '').trim();

  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');
  if (!['pass', 'reject'].includes(action)) {
    throw new AppError(C.BAD_REQUEST, 'action 必须是 pass 或 reject');
  }
  if (action === 'reject' && !reason) {
    throw new AppError(C.BAD_REQUEST, '驳回必须填写原因');
  }
  if (reason.length > 100) throw new AppError(C.BAD_REQUEST, '驳回原因不超过 100 字');

  const res = await db(COLLECTIONS.POSTS).where({ _id: id }).limit(1).get();
  const post = res.data && res.data[0];
  if (!post) throw new AppError(C.NOT_FOUND, '帖子不存在');
  if (post.status !== 'pending') {
    const map = { passed: '已通过', rejected: '已驳回', offline: '已下架' };
    throw new AppError(C.CONFLICT, `该帖子${map[post.status] || post.status}，无法重复审核`);
  }

  const t = now();
  const reviewer = admin.username || admin.openid || 'admin';
  const patch =
    action === 'pass'
      ? { status: 'passed', rejectReason: '', reviewTime: t, reviewer, updateTime: t }
      : { status: 'rejected', rejectReason: reason, reviewTime: t, reviewer, updateTime: t };

  await db(COLLECTIONS.POSTS).where({ _id: id }).update(patch);
  return ok({ _id: id, status: patch.status, rejectReason: patch.rejectReason });
}

/**
 * GET /api/admin/users?keyword=&cursor=
 * G-06：用户搜索。keyword 模糊匹配 昵称/真实姓名/学号/openid；为空返回全部（游标分页）
 */
async function searchUsers(req) {
  requireAdmin(req);
  const { keyword, cursor } = req.query;
  // 管理端用户列表需要一屏看全，允许前端指定 size（默认 PAGE_SIZE，上限 100）
  const size = Math.min(Math.max(toInt(req.query.size) || PAGE_SIZE, 1), 100);

  const where = {};
  if (keyword && String(keyword).trim()) {
    const re = search.like(keyword);
    where.$or = [
      { nickname: re },
      { realName: re },
      { studentId: re },
      { _openid: re },
    ];
  }
  if (cursor) {
    const c = toInt(cursor);
    if (Number.isFinite(c) && c > 0) where.createTime = { $lt: c };
  }

  // CloudBase 对空 where 的 get/remove 在部分场景受限；用全匹配正则兜底
  if (!Object.keys(where).length) {
    where._id = regExp({ regexp: '.*', options: 'i' });
  }

  const res = await db(COLLECTIONS.USERS)
    .where(where)
    .orderBy('createTime', 'desc')
    .limit(size + 1)
    .get();
  const rows = res.data || [];
  const hasMore = rows.length > size;
  const list = hasMore ? rows.slice(0, size) : rows;
  const nextCursor = hasMore ? list[list.length - 1].createTime : null;
  return ok({ list, nextCursor });
}

/**
 * GET /api/admin/users/:openid
 * G-07：用户详情 = 基本信息 + 发布列表 + 交换记录
 */
async function userDetail(req) {
  requireAdmin(req);
  const { openid } = req.params;
  if (!openid) throw new AppError(C.BAD_REQUEST, 'openid 必填');

  const uRes = await db(COLLECTIONS.USERS).where({ _openid: openid }).limit(1).get();
  const u = uRes.data && uRes.data[0];
  if (!u) throw new AppError(C.NOT_FOUND, '用户不存在');

  const pRes = await db(COLLECTIONS.POSTS)
    .where({ authorId: openid })
    .orderBy('createTime', 'desc')
    .limit(50)
    .get();
  const eRes = await db(COLLECTIONS.EXCHANGES)
    .where({ $or: [{ applicantId: openid }, { targetId: openid }] })
    .orderBy('createTime', 'desc')
    .limit(50)
    .get();

  return ok({
    user: u,
    posts: pRes.data || [],
    exchanges: eRes.data || [],
  });
}

/**
 * POST /api/admin/users/:openid/ban
 * G-08：封禁/解封。封禁时把该用户所有 passed 帖子下架为 offline（记录 bannedPosts），
 *       解封时仅恢复 bannedPosts 中记录的帖子（精确恢复，不影响其他 offline）。
 * Body: { action: 'ban' | 'unban' }
 */
async function banUser(req) {
  requireAdmin(req);
  const { openid } = req.params;
  const b = req.body || {};
  const action = String(b.action || 'ban') === 'unban' ? 'unban' : 'ban';
  if (!openid) throw new AppError(C.BAD_REQUEST, 'openid 必填');

  const uRes = await db(COLLECTIONS.USERS).where({ _openid: openid }).limit(1).get();
  const u = uRes.data && uRes.data[0];
  if (!u) throw new AppError(C.NOT_FOUND, '用户不存在');
  const t = now();

  if (action === 'ban') {
    if (u.status === 'banned') throw new AppError(C.CONFLICT, '该用户已被封禁');
    const pRes = await db(COLLECTIONS.POSTS).where({ authorId: openid, status: 'passed' }).get();
    const ids = (pRes.data || []).map((x) => x._id);
    for (const id of ids) {
      await db(COLLECTIONS.POSTS).where({ _id: id }).update({ status: 'offline', updateTime: t });
    }
    await db(COLLECTIONS.USERS).where({ _openid: openid }).update({
      status: 'banned', bannedPosts: ids, updateTime: t,
    });
    return ok({ _openid: openid, status: 'banned', offlinePosts: ids.length });
  }

  // unban
  if (u.status !== 'banned') throw new AppError(C.CONFLICT, '该用户未被封禁');
  const ids = Array.isArray(u.bannedPosts) ? u.bannedPosts : [];
  for (const id of ids) {
    await db(COLLECTIONS.POSTS).where({ _id: id }).update({ status: 'passed', updateTime: t });
  }
  await db(COLLECTIONS.USERS).where({ _openid: openid }).update({
    status: 'active', bannedPosts: [], updateTime: t,
  });
  return ok({ _openid: openid, status: 'active', restoredPosts: ids.length });
}

/**
 * GET /api/admin/stats
 * 数据看板（管理端首页）：总数统计 + 今日新增 + 帖子状态分布 + 7 日发布趋势 +
 * 热门标签/分类 Top + 交换状态分布 + 好评用户 Top
 * 全部轻量查询（count / 小字段投影），单次请求可完成
 */
async function stats(req) {
  requireAdmin(req);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayTs = dayStart.getTime();
  const weekTs = todayTs - 6 * 86400000; // 7 天窗口（含今天）

  // ---- 计数类（并发）----
  // CloudBase count() 返回 { total: n }，统一解包
  async function cnt(q) {
    const r = await q;
    return (r && r.total) || 0;
  }

  const [
    usersTotal, usersBanned, usersToday,
    postsPending, postsPassed, postsRejected, postsOffline, postsToday,
    exPending, exActive, exStarted, exCompleted, exRejected, exCancelled,
  ] = await Promise.all([
    cnt(db(COLLECTIONS.USERS).where({}).count()),
    cnt(db(COLLECTIONS.USERS).where({ status: 'banned' }).count()),
    cnt(db(COLLECTIONS.USERS).where({ createTime: { $gte: todayTs } }).count()),
    cnt(db(COLLECTIONS.POSTS).where({ status: 'pending' }).count()),
    cnt(db(COLLECTIONS.POSTS).where({ status: 'passed' }).count()),
    cnt(db(COLLECTIONS.POSTS).where({ status: 'rejected' }).count()),
    cnt(db(COLLECTIONS.POSTS).where({ status: 'offline' }).count()),
    cnt(db(COLLECTIONS.POSTS).where({ createTime: { $gte: todayTs } }).count()),
    cnt(db(COLLECTIONS.EXCHANGES).where({ status: 'pending' }).count()),
    cnt(db(COLLECTIONS.EXCHANGES).where({ status: 'active' }).count()),
    cnt(db(COLLECTIONS.EXCHANGES).where({ status: 'started' }).count()),
    cnt(db(COLLECTIONS.EXCHANGES).where({ status: 'completed' }).count()),
    cnt(db(COLLECTIONS.EXCHANGES).where({ status: 'rejected' }).count()),
    cnt(db(COLLECTIONS.EXCHANGES).where({ status: 'cancelled' }).count()),
  ]);

  // ---- 趋势 / Top 类（小投影拉取后内存聚合） ----
  const [postRows, exRows, topUsersRes] = await Promise.all([
    db(COLLECTIONS.POSTS).where({}).field({ tags: true, category: true, createTime: true, status: true })
      .orderBy('createTime', 'desc').limit(500).get(),
    db(COLLECTIONS.EXCHANGES).where({}).field({ status: true, createTime: true })
      .orderBy('createTime', 'desc').limit(500).get(),
    db(COLLECTIONS.USERS).where({})
      .field({ nickname: true, realName: true, goodCount: true, totalCount: true, avatarColor: true })
      .orderBy('goodCount', 'desc').limit(5).get(),
  ]);

  const posts = postRows.data || [];

  // 7 日发布趋势（含所有状态，按天分桶）
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const s = todayTs - i * 86400000;
    trend.push({
      date: new Date(s).toISOString().slice(5, 10), // MM-DD
      count: posts.filter((p) => p.createTime >= s && p.createTime < s + 86400000).length,
    });
  }

  // 热门标签 Top 8（仅统计 passed 帖）
  const tagFreq = Object.create(null);
  posts.filter((p) => p.status === 'passed').forEach((p) => {
    (p.tags || []).forEach((t) => { tagFreq[t] = (tagFreq[t] || 0) + 1; });
  });
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  // 分类分布 Top 6（仅统计 passed 帖）
  const catFreq = Object.create(null);
  posts.filter((p) => p.status === 'passed').forEach((p) => {
    if (p.category) catFreq[p.category] = (catFreq[p.category] || 0) + 1;
  });
  const topCategories = Object.entries(catFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([category, count]) => ({ category, count }));

  return ok({
    users: { total: usersTotal, banned: usersBanned, today: usersToday },
    posts: {
      pending: postsPending, passed: postsPassed,
      rejected: postsRejected, offline: postsOffline, today: postsToday,
    },
    // active 口径 = 已接受待开始 + 双方已开始（对管理端都算「进行中」），
    // 另单列 started 供需要拆分的场景使用，避免新增状态后看板数字掉坑
    exchanges: {
      pending: exPending,
      active: exActive + exStarted,
      started: exStarted,
      completed: exCompleted,
      rejected: exRejected,
      cancelled: exCancelled,
    },
    trend,
    topTags,
    topCategories,
    topUsers: (topUsersRes.data || []).map((u) => ({
      name: u.nickname || u.realName || '匿名',
      goodCount: u.goodCount || 0,
      totalCount: u.totalCount || 0,
      avatarColor: u.avatarColor || '#2B62E0',
    })),
  });
}

/**
 * POST /api/admin/seed
 * 测试数据灌库（仅管理员）。body: { reset?: boolean }
 * reset=true 先清空 users/posts/exchanges 三集合再写入，否则追加。
 * 数据来自 lib/seed-data.js（12 用户 + 30 帖 + 8 交换，共 50 条跨类型基底）。
 */
async function seed(req) {
  requireAdmin(req);
  const b = req.body || {};
  const reset = b.reset === true || b.reset === 'true';
  const { runSeed } = require('../lib/seed-data');
  const summary = await runSeed(db, COLLECTIONS, { reset });
  return ok(
    summary,
    `已灌入测试数据（用户${summary.users}/帖子${summary.posts}/交换${summary.exchanges}）`
  );
}

module.exports = [
  { method: 'POST', path: '/api/admin/login', handler: login },
  { method: 'GET', path: '/api/admin/stats', handler: stats },
  { method: 'GET', path: '/api/admin/posts', handler: listPosts },
  { method: 'POST', path: '/api/admin/posts/:id/ai-audit', handler: aiAudit },
  { method: 'POST', path: '/api/admin/posts/:id/review', handler: review },
  { method: 'POST', path: '/api/admin/posts/:id/takedown', handler: takedown },
  { method: 'GET', path: '/api/admin/users', handler: searchUsers },
  { method: 'GET', path: '/api/admin/users/:openid', handler: userDetail },
  { method: 'POST', path: '/api/admin/users/:openid/ban', handler: banUser },
  { method: 'POST', path: '/api/admin/seed', handler: seed },
];