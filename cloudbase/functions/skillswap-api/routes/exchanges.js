/**
 * 交换闭环（Z-08 发起申请 / Z-09 收到申请处理 / Z-10 我的交换 / Z-11 完成与互评）
 * 阶段 4：全量实现
 *
 * 数据模型（见 cloudbase/db/collections.json · exchanges）：
 *   postId        关联帖子 _id
 *   postTitle      帖子标题（冗余，列表免查 posts）
 *   applicantId    申请人 openid（发起方）
 *   targetId       帖主 openid（接收方）
 *   status         pending → active → started → completed
 *                  active  = 帖主已接受、双方还没开始（帖子仍开放申请）
 *                  started = 双方都点了「开始」，正在进行（该帖暂时不能再开新的一摊）
 *                  终态：completed（双方都标记完成，可互评）| cancelled（双方都确认取消，跳过评价）| rejected
 *   startBy        已点「开始」的 openid 列表，两人齐全则 status=started
 *   cancelBy       已确认「取消交换」的 openid 列表，两人齐全则 status=cancelled（仅 active 阶段可用）
 *   cancelNotes    [{ openid, text, time }] 改约/临时有事的留言
 *   completedBy    已点「完成」的 openid 列表，两人齐全则 completed（仅 started 阶段可用）
 *   evaluations    [{ openid, role, rating, comment, time }]
 *
 * 一句话规则：
 *   - 「标记完成」只在 started（双方都点了开始）之后才出现，两人都标记才 completed → 进入互评；
 *   - 「取消交换」只在 active（双方还没开始）时出现，两人都确认才 cancelled → 直接跳过评价；
 *   - 点「开始」会清空 cancelBy、点「取消」会清空 startBy，两者互斥，不会出现既想开始又想取消。
 *
 * 单摊约束（2026-09-15 补第二层，改 confirm / start 前必读）：
 *   - 帖子维度：同一帖子同时只能有一摊 started（lib/exchangeState.of / busyPostMap）
 *   - 用户对维度：同一对用户之间同时只能有一摊 started（lib/exchangeState.pairBusy / busyPairMap）
 *     → 甲已和乙进行着一摊交换时，甲不能再确认 / 开始「乙对甲另一条帖」的申请；
 *       只约束同一对用户，甲与其他人、乙与其他人的交换不受影响。
 *     接口下发 `peerBusy`，前端据此置灰按钮并给出说明文案。
 *
 * 重复申请约束：同一对 (postId, applicantId) 同时只允许一笔「未结束」的交换
 *   - pending / active / started 中重复发起 → 409
 *   - completed / cancelled / rejected 之后可以再次申请同一帖（会生成新记录，旧记录留作历史）
 *   - 因此 postId+applicantId 在数据库里必须是普通复合索引，不能是唯一索引
 *     （唯一索引会把「交换完成后再次申请」直接顶成 E11000 报错）
 */

const { C, ok, AppError } = require('../lib/resp');
const { requireAuth } = require('../lib/auth');
const { db, cmd, now, COLLECTIONS } = require('../lib/db');
const reviews = require('../lib/reviews');
const exchangeState = require('../lib/exchangeState');
const config = require('../config');

const ACTIVE_STATUSES = ['pending', 'active', 'started'];
/** 交换已达成（帖主已接受）之后，双方才可以互相看到联系方式；已取消的交换不再互发联系方式 */
const AGREED_STATUSES = ['active', 'started', 'completed'];

/** 取用户冗余字段（昵称 / 头像色 / 联系方式），用于交换列表展示，失败则降级为空 */
async function loadUserBrief(openid) {
  try {
    const u = await db(COLLECTIONS.USERS)
      .where({ _openid: openid })
      .field({ nickname: true, realName: true, avatarColor: true, contact: true })
      .limit(1)
      .get();
    const d = u.data && u.data[0];
    if (!d) return { name: '', avatar: '', contact: '' };
    return {
      name: d.nickname || d.realName || '',
      avatar: d.avatarColor || '',
      contact: d.contact || '',
    };
  } catch (_) {
    return { name: '', avatar: '', contact: '' };
  }
}

/** 取帖子类型（teach/learn），用于判定双方在评价中的角色；查不到按 teach 兜底 */
async function loadPostType(postId) {
  if (!postId) return 'teach';
  try {
    const r = await db(COLLECTIONS.POSTS).where({ _id: postId }).field({ type: true }).limit(1).get();
    const p = r.data && r.data[0];
    return (p && p.type) || 'teach';
  } catch (_) {
    return 'teach';
  }
}

/**
 * POST /api/exchanges
 * Z-08：发起申请。校验帖子状态、不能申请自己的帖、去重。
 * Body: { postId, message? }
 */
async function create(req) {
  const auth = requireAuth(req);
  const b = req.body || {};
  const postId = String(b.postId || '').trim();
  const message = String(b.message || '').trim().slice(0, 200);

  if (!postId) throw new AppError(C.BAD_REQUEST, 'postId 必填');

  const pRes = await db(COLLECTIONS.POSTS).where({ _id: postId }).limit(1).get();
  const post = pRes.data && pRes.data[0];
  if (!post) throw new AppError(C.NOT_FOUND, '帖子不存在');

  if (post.status !== 'passed') {
    throw new AppError(C.CONFLICT, '该帖子暂不可申请（需通过审核）');
  }
  // 沙盒模式（SANDBOX_MODE）下允许对自己的帖子发起交换，便于单账号验收全链路
  if (post.authorId === auth.openid && !config.isSandbox()) {
    throw new AppError(C.FORBIDDEN, '不能申请自己的帖子');
  }

  // 去重：同一人对同一帖「同时」只能有一笔未结束的申请（pending / active / started）。
  // 已结束的记录（completed / cancelled / rejected）不拦截 —— 交换做完或取消后可以再次申请同一帖。
  // 注意 status 必须下推到数据库查询：同一对 (postId, applicantId) 允许存在多条历史记录，
  // 若只 where({postId, applicantId}) 取 limit(1) 那条再在内存里判状态，可能正好取到已结束的旧记录，误判成「没申请过」。
  const dup = await db(COLLECTIONS.EXCHANGES)
    .where({ postId, applicantId: auth.openid, status: cmd().in(ACTIVE_STATUSES) })
    .limit(1)
    .get();
  if (dup.data && dup.data[0]) {
    throw new AppError(C.CONFLICT, '你已对该帖子发起过申请，请等待对方处理');
  }

  // 帖子始终开放申请：待开始(active) 不占用帖子，接受谁由帖主自行决定；
  // 只有「进行中(started)」会影响帖主的确认与开始动作，见 lib/exchangeState.js
  const brief = await loadUserBrief(auth.openid);
  const t = now();
  const doc = {
    postId,
    postTitle: post.title || '',
    applicantId: auth.openid,
    applicantName: brief.name,
    targetId: post.authorId,
    message,
    status: 'pending',
    startBy: [],
    cancelBy: [],
    cancelNotes: [],
    completedBy: [],
    evaluations: [],
    createTime: t,
    updateTime: t,
  };
  // 兜底：即便去重通过，若数据库仍因历史唯一索引（postId + applicantId）拦下，
  // 也不能把 E11000 原始报错抛给用户（前端会整屏弹英文堆栈）。转成可读的 409。
  let addRes;
  try {
    addRes = await db(COLLECTIONS.EXCHANGES).add(doc);
  } catch (e) {
    if (/duplicate key/i.test(String((e && e.message) || e))) {
      throw new AppError(C.CONFLICT, '你已对该帖子发起过申请，请等待对方处理');
    }
    throw e;
  }
  const newId = (addRes.ids && addRes.ids[0]) || addRes._id || addRes.id || addRes.insertedId;
  return ok({ _id: newId, status: 'pending' });
}

/**
 * GET /api/exchanges/received
 * Z-09：收到的申请（帖主视角，targetId = 我）
 */
async function received(req) {
  const auth = requireAuth(req);
  const res = await db(COLLECTIONS.EXCHANGES)
    .where({ targetId: auth.openid })
    .orderBy('createTime', 'desc')
    .limit(50)
    .get();
  const list = await decorateAll(res.data, auth.openid);
  return ok({ list });
}

/**
 * POST /api/exchanges/:id/confirm
 * Z-09：帖主确认搭档 → active
 * 帖主随时可以确认新的申请；只有帖子上已有「进行中」的交换时才需要等这次结束
 */
async function confirm(req) {
  return decide(req, 'active', '确认', async (ex) => {
    const state = await exchangeState.of(ex.postId);
    if (state.busy) {
      throw new AppError(C.CONFLICT, '该帖已有进行中的交换，等这次结束后再确认新的申请');
    }
    // 同一对用户之间同时只能有一摊进行中的交换：本次不是进行中，但两人之间已有一摊在进行
    if (await exchangeState.pairBusy(ex.targetId, ex.applicantId)) {
      throw new AppError(C.CONFLICT, '你和 TA 之间已有进行中的交换，等这次结束后再确认新的申请');
    }
  });
}

/**
 * POST /api/exchanges/:id/reject
 * Z-09：帖主拒绝 → rejected
 */
async function reject(req) {
  return decide(req, 'rejected', '拒绝');
}

async function decide(req, nextStatus, label, guard) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  if (ex.targetId !== auth.openid) throw new AppError(C.FORBIDDEN, '只有帖主可以' + label);
  if (ex.status !== 'pending') {
    const map = { active: '已确认', started: '已开始', rejected: '已拒绝' };
    throw new AppError(C.CONFLICT, `该申请${map[ex.status] || ex.status}，无法重复${label}`);
  }
  if (guard) await guard(ex);
  const t = now();
  await db(COLLECTIONS.EXCHANGES).where({ _id: id }).update({ status: nextStatus, updateTime: t });
  return ok({ _id: id, status: nextStatus });
}

/**
 * POST /api/exchanges/:id/start
 * 开始协作：双方各自点一次「开始」，两次齐全 → started（进行中）。
 * - 教学者先点「教学开始」→ 学员侧出现「确认开始 / 临时有事」
 * - 学员先点「申请开始」→ 教学者侧出现「确认开始 / 再约时间」
 * - 沙盒自交换（申请人=帖主）一次点击即视为双方已开始
 */
async function start(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  const me = auth.openid;
  if (me !== ex.applicantId && me !== ex.targetId) {
    throw new AppError(C.FORBIDDEN, '只有交换双方可以操作');
  }
  if (ex.status === 'started') throw new AppError(C.CONFLICT, '这次交换已经开始了');
  if (ex.status !== 'active') {
    throw new AppError(C.CONFLICT, '只有帖主已接受的交换才能开始');
  }

  // 同一帖子同时只能有一摊「进行中」：帖子上已有别的交换在进行时，本交换不能开始
  const state = await exchangeState.of(ex.postId);
  if (state.busy) {
    throw new AppError(C.CONFLICT, '该帖已有进行中的交换，等这次结束后再开始');
  }
  // 同一对用户之间同时只能有一摊「进行中」：我和 TA 已在别的帖子上进行着一摊，本交换不能开始
  const counterpart = me === ex.applicantId ? ex.targetId : ex.applicantId;
  if (await exchangeState.pairBusy(me, counterpart)) {
    throw new AppError(C.CONFLICT, '你和 TA 之间已有进行中的交换，先完成或取消这次再开始');
  }

  const startBy = (Array.isArray(ex.startBy) ? ex.startBy : []).filter(Boolean);
  if (startBy.indexOf(me) >= 0) {
    throw new AppError(C.CONFLICT, '你已确认开始，等待对方确认');
  }

  const next = startBy.concat(me);
  // 沙盒自交换只有一个人，一次点击即视为双方已开始
  const sandboxSelf = ex.applicantId === ex.targetId && config.isSandbox();
  const t = now();
  const status = sandboxSelf || next.length >= 2 ? 'started' : 'active';
  // 开始 = 想继续这次交换：把双方挂着的「取消交换」申请一并作废，避免同时既想开始又想取消
  const patch = { startBy: next, cancelBy: [], status, updateTime: t };
  if (status === 'started') patch.startTime = t;
  await db(COLLECTIONS.EXCHANGES).where({ _id: id }).update(patch);
  return ok({ _id: id, status, startBy: next });
}

/**
 * POST /api/exchanges/:id/cancel-start
 * 「临时有事」/「再约时间」：撤回本次开始，并给对方留一条取消留言。
 * 交换本身保留（回到 active），双方都可以再次发起开始。
 * Body: { text? }（最长 100 字，留空给默认话术）
 */
async function cancelStart(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');
  const b = req.body || {};

  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  const me = auth.openid;
  if (me !== ex.applicantId && me !== ex.targetId) {
    throw new AppError(C.FORBIDDEN, '只有交换双方可以操作');
  }
  if (ex.status !== 'active') {
    throw new AppError(C.CONFLICT, '只有等待开始的交换可以改约');
  }

  const text =
    String(b.text == null ? '' : b.text).trim().slice(0, 100) || '临时有事，我们改天再约吧';
  const notes = (Array.isArray(ex.cancelNotes) ? ex.cancelNotes : []).concat({
    openid: me,
    text,
    time: now(),
  });
  const t = now();
  await db(COLLECTIONS.EXCHANGES).where({ _id: id }).update({
    startBy: [],
    cancelNotes: notes,
    updateTime: t,
  });
  return ok({ _id: id, status: 'active', startBy: [], cancelNotes: notes });
}

/**
 * POST /api/exchanges/:id/cancel
 * 「取消交换」：只在「待开始(active)」阶段可用——双方还没开始协作才允许取消。
 * 双方各自点一次「取消交换」，两人齐全 → cancelled。
 * cancelled 是终态：**直接跳过评价**，也不再互发联系方式，列表里显示「已取消」。
 * 取消会把双方的「开始」标记一并清空，避免出现既申请开始又申请取消的矛盾状态。
 */
async function cancel(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  const me = auth.openid;
  if (me !== ex.applicantId && me !== ex.targetId) {
    throw new AppError(C.FORBIDDEN, '只有交换双方可以操作');
  }
  if (ex.status === 'started') {
    throw new AppError(C.CONFLICT, '交换已开始，请用「标记完成」结束这次交换');
  }
  if (ex.status !== 'active') {
    throw new AppError(C.CONFLICT, '只有帖主已接受、还没开始的交换才能取消');
  }

  const cancelBy = (Array.isArray(ex.cancelBy) ? ex.cancelBy : []).filter(Boolean);
  if (cancelBy.indexOf(me) >= 0) {
    throw new AppError(C.CONFLICT, '你已申请取消，等待对方确认');
  }

  const next = cancelBy.concat(me);
  // 沙盒自交换只有一个人，一次点击即视为双方都确认取消
  const sandboxSelf = ex.applicantId === ex.targetId && config.isSandbox();
  const t = now();
  const status = sandboxSelf || next.length >= 2 ? 'cancelled' : 'active';
  const patch = { cancelBy: next, startBy: [], status, updateTime: t };
  if (status === 'cancelled') patch.cancelTime = t;
  await db(COLLECTIONS.EXCHANGES).where({ _id: id }).update(patch);
  return ok({ _id: id, status, cancelBy: next });
}

/**
 * GET /api/exchanges
 * Z-10：我的交换（发起方或帖主都算「我」），按状态分组交给前端
 */
async function mine(req) {
  const auth = requireAuth(req);
  const res = await db(COLLECTIONS.EXCHANGES)
    .where({})
    .orderBy('createTime', 'desc')
    .limit(50)
    .get();
  const list = await decorateAll(
    (res.data || []).filter(
      (e) => e.applicantId === auth.openid || e.targetId === auth.openid
    ),
    auth.openid
  );
  return ok({ list });
}

/**
 * GET /api/exchanges/:id
 * Z-10/11：交换详情（仅当事双方可见）
 */
async function detail(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');
  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  if (ex.applicantId !== auth.openid && ex.targetId !== auth.openid) {
    throw new AppError(C.FORBIDDEN, '无权查看该交换');
  }
  return ok(await decorateExchange(ex, auth.openid));
}

/**
 * POST /api/exchanges/:id/complete
 * Z-11：一方点击「标记完成」。两人齐全 → completed（随后进入互评）。
 * 只在 双方都点了「开始」(started) 之后才允许：
 * 还没开始就想终止这次交换，走「取消交换」(POST /:id/cancel)。
 */
async function complete(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  const me = auth.openid;
  if (me !== ex.applicantId && me !== ex.targetId) {
    throw new AppError(C.FORBIDDEN, '只有交换双方可以操作');
  }
  if (ex.status !== 'started') {
    throw new AppError(C.CONFLICT, '双方都点「开始」之后才能标记完成；还没开始请用「取消交换」');
  }
  const myDone = (ex.completedBy || []).includes(me);
  // 沙盒自交换（申请人=帖主）：同一账号凑不齐两个人，第二次点击视为双方均已完成
  const sandboxSelf = ex.applicantId === ex.targetId && config.isSandbox();
  if (myDone && !sandboxSelf) {
    throw new AppError(C.CONFLICT, '你已点击过完成');
  }
  const completedBy = myDone ? ex.completedBy || [] : (ex.completedBy || []).concat(me);
  const t = now();
  // 沙盒自交换只有一个人，一次点击即视为双方完成；
  // 其余情况两人齐全才 completed，否则保持 started（不能退回待开始）
  const next = sandboxSelf || completedBy.length >= 2 ? 'completed' : 'started';
  await db(COLLECTIONS.EXCHANGES).where({ _id: id }).update({
    completedBy,
    status: next,
    updateTime: t,
  });
  return ok({ _id: id, status: next, completedBy });
}

/**
 * 取交换中「我」的角色：教学者（提供服务）/ 学员
 * teach 帖：帖主=教学者，申请人=学员；learn 帖相反。查不到帖子时按 teach 兜底。
 */
async function roleIn(ex, openid) {
  return reviews.roleOf(ex, openid, await loadPostType(ex.postId));
}

/**
 * POST /api/exchanges/:id/evaluate
 * Z-11：提交评价。
 * - 学员（学的人）→ 对教学者：满意 / 不满意 / 暂不评价（三态），可附一句评语
 * - 教学者（教的人）→ 对学员：只写评语，不参与满意/不满意（rating 恒为 null）
 * Body: { rating?: 'satisfied'|'dissatisfied'|'none', comment?: string }
 *       兼容旧版 { satisfied: boolean }
 * 计分：仅学员的 satisfied / dissatisfied 计入对方好评率；none 与教学者评语不计分。
 */
async function evaluate(req) {
  const auth = requireAuth(req);
  const { id } = req.params;
  const b = req.body || {};
  if (!id) throw new AppError(C.BAD_REQUEST, 'id 必填');

  const res = await db(COLLECTIONS.EXCHANGES).where({ _id: id }).limit(1).get();
  const ex = res.data && res.data[0];
  if (!ex) throw new AppError(C.NOT_FOUND, '交换申请不存在');
  const me = auth.openid;
  if (me !== ex.applicantId && me !== ex.targetId) {
    throw new AppError(C.FORBIDDEN, '只有交换双方可以评价');
  }
  if (ex.status !== 'completed') {
    throw new AppError(C.CONFLICT, '仅已完成（双方都点击完成）的交换可以评价');
  }
  const evals = ex.evaluations || [];
  if (evals.some((e) => e.openid === me)) {
    throw new AppError(C.CONFLICT, '你已评价过');
  }

  // 解析评分（三态），兼容旧版 satisfied 布尔
  let rating = null;
  if (b.rating != null && b.rating !== '') {
    rating = String(b.rating);
  } else if (b.satisfied === true || b.satisfied === 'true') {
    rating = 'satisfied';
  } else if (b.satisfied === false || b.satisfied === 'false') {
    rating = 'dissatisfied';
  }
  if (rating != null && !reviews.RATINGS.includes(rating)) {
    throw new AppError(C.BAD_REQUEST, 'rating 不合法');
  }
  const comment = String(b.comment == null ? '' : b.comment).trim().slice(0, 200);

  // 角色：教学者只写评语，不参与打分
  const role = await roleIn(ex, me);
  if (role === 'teacher') rating = null;

  // 对方 = 非我的那一方
  const counterpart = me === ex.applicantId ? ex.targetId : ex.applicantId;

  // 写入互评记录
  const newEval = { openid: me, role, rating, comment, time: now() };
  await db(COLLECTIONS.EXCHANGES).where({ _id: id }).update({
    evaluations: evals.concat(newEval),
    updateTime: now(),
  });

  // 自交换（沙盒测试）时「对方」就是自己，跳过好评累计，避免自己给自己刷分
  if (counterpart === me) {
    return ok({ _id: id, evaluated: me, counterpart, role, rating, comment, selfSwap: true });
  }

  // 仅学员的明确评价计入对方好评率（none / 教学者评语不计分）
  if (rating === 'satisfied' || rating === 'dissatisfied') {
    const uRes = await db(COLLECTIONS.USERS).where({ _openid: counterpart }).limit(1).get();
    const user = uRes.data && uRes.data[0];
    if (user) {
      const patch = {
        totalCount: (user.totalCount || 0) + 1,
        goodCount: (user.goodCount || 0) + (rating === 'satisfied' ? 1 : 0),
      };
      await db(COLLECTIONS.USERS).where({ _openid: counterpart }).update(patch);
    }
  }

  return ok({ _id: id, evaluated: me, counterpart, role, rating, comment });
}

/** 给交换附加「我的角色 + 对方展示名 + 联系方式 + 开始协作态」，便于前端渲染
 * @param {object} e 交换文档
 * @param {string} myOpenid 当前登录人
 * @param {object} [busyMap] 进行中帖子字典（列表接口批量传入，避免 N+1）
 * @param {object} [pairMap] 进行中用户对字典（同上，键为 exchangeState.pairKey）
 */
async function decorateExchange(e, myOpenid, busyMap, pairMap) {
  const role = e.applicantId === myOpenid ? 'applicant' : 'target';
  const peerId = role === 'applicant' ? e.targetId : e.applicantId;
  const brief = await loadUserBrief(peerId);
  const postType = await loadPostType(e.postId);
  const evaluations = reviews.normalizeEvals(e.evaluations);

  // 联系方式只在「交换已达成」（帖主已接受）之后互相可见，申请阶段不下发
  const agreed = AGREED_STATUSES.indexOf(e.status) >= 0;
  let myContact = '';
  if (agreed) {
    const meBrief = await loadUserBrief(myOpenid);
    myContact = meBrief.contact;
  }

  // 开始协作：startBy 记录已点「开始」的人，两人齐全即 started
  const startBy = (Array.isArray(e.startBy) ? e.startBy : []).filter(Boolean);
  // 取消交换：cancelBy 记录已申请取消的人，两人齐全即 cancelled（仅 active 阶段可能非空）
  const cancelBy = (Array.isArray(e.cancelBy) ? e.cancelBy : []).filter(Boolean);
  const cancelNotes = (Array.isArray(e.cancelNotes) ? e.cancelNotes : [])
    .filter((n) => n && n.openid)
    .map((n) => ({ openid: n.openid, text: String(n.text || ''), time: n.time || 0 }));
  const peerNote =
    cancelNotes
      .filter((n) => n.openid !== myOpenid)
      .sort((a, b) => (b.time || 0) - (a.time || 0))[0] || null;

  // 该帖是否已被「别的」进行中交换占住：帖主暂不能确认新申请，其它待开始也不能开始
  const map = busyMap || (await exchangeState.busyPostMap());
  const postBusy = !!map[e.postId] && e.status !== 'started';

  // 我和对方之间是否已有「别的」进行中交换（同一对用户同时只能开一摊）：
  // 自己就是 started 时不算（那正是这一摊本身），交付前端用于置灰「同意交换 / 开始」
  const pmap = pairMap || (await exchangeState.busyPairMap());
  const peerBusy = !!pmap[exchangeState.pairKey(myOpenid, peerId)] && e.status !== 'started';

  return Object.assign({}, e, {
    myRole: role,
    // 评价角色：teacher=教的人（只写评语不计分），learner=学的人（满意/不满意/不评价）
    evalRole: reviews.roleOf(e, myOpenid, postType),
    postType,
    evaluations,
    myEvaluation: evaluations.find((x) => x.openid === myOpenid) || null,
    // 对方的评价：前端「已评价后收起按钮 → 展示双方评价」用，避免前端自己做 openid 比对
    peerEvaluation: evaluations.find((x) => x.openid !== myOpenid) || null,
    peerName: peerId === e.applicantId ? e.applicantName : brief.name,
    peerAvatar: brief.avatar,
    // 双方联系方式（仅交换达成后）
    agreed,
    peerContact: agreed ? brief.contact : '',
    myContact,
    // 开始协作
    startBy,
    iAgreedStart: startBy.indexOf(myOpenid) >= 0,
    // 取消交换（仅 active 阶段可发起）
    cancelBy,
    iRequestedCancel: cancelBy.indexOf(myOpenid) >= 0,
    peerRequestedCancel: cancelBy.length > 0 && cancelBy.indexOf(myOpenid) < 0,
    peerCancelNote: peerNote,
    cancelNotes,
    // 该帖已有「别的」进行中交换：帖主暂不能确认新申请、其余待开始暂不能开始
    postBusy,
    // 我和对方之间已有「别的」进行中交换：同样不能确认 / 开始本条
    peerBusy,
  });
}

/** 列表装饰：一次批量取「进行中」帖子与「进行中用户对」，避免逐行查询（N+1） */
async function decorateAll(rows, myOpenid) {
  const [busyMap, pairMap] = await Promise.all([
    exchangeState.busyPostMap(),
    exchangeState.busyPairMap(),
  ]);
  return Promise.all((rows || []).map((e) => decorateExchange(e, myOpenid, busyMap, pairMap)));
}

module.exports = [
  { method: 'POST', path: '/api/exchanges', handler: create },
  { method: 'GET', path: '/api/exchanges/received', handler: received },
  { method: 'POST', path: '/api/exchanges/:id/confirm', handler: confirm },
  { method: 'POST', path: '/api/exchanges/:id/reject', handler: reject },
  { method: 'POST', path: '/api/exchanges/:id/start', handler: start },
  { method: 'POST', path: '/api/exchanges/:id/cancel-start', handler: cancelStart },
  { method: 'POST', path: '/api/exchanges/:id/cancel', handler: cancel },
  { method: 'GET', path: '/api/exchanges', handler: mine },
  { method: 'GET', path: '/api/exchanges/:id', handler: detail },
  { method: 'POST', path: '/api/exchanges/:id/complete', handler: complete },
  { method: 'POST', path: '/api/exchanges/:id/evaluate', handler: evaluate },
];
