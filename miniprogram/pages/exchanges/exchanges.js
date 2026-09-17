/**
 * 技能交换页（Z-09 收到的申请 / Z-10 我的交换 / Z-11 完成与互评 / Z-14 开始协作）
 * 后端契约：
 * - GET  /api/exchanges/received   帖主视角收到的申请
 * - GET  /api/exchanges            我的交换（发起方或帖主都算）
 * - POST /api/exchanges/:id/confirm | /reject    帖主处理 pending（Z-09）
 * - POST /api/exchanges/:id/start                双方各自点一次「开始」（Z-14）
 * - POST /api/exchanges/:id/cancel-start         「临时有事 / 再约时间」并留取消留言（Z-14）
 * - POST /api/exchanges/:id/cancel               双方各自确认「取消交换」→ cancelled（跳过评价）
 * - POST /api/exchanges/:id/complete             双方都「开始」后各点一次完成 → completed（Z-11）
 * - POST /api/exchanges/:id/evaluate             completed 后互评（Z-11）
 *
 * 按钮出现规则（与后端一致）：
 *   pending  → 帖主：拒绝 / 同意交换
 *   active   → 双方：开始 / 临时有事 · 再约时间 / 取消交换（此阶段没有「标记完成」）
 *   started  → 双方：标记完成（两人都点 → completed，进入评价）
 *   cancelled→ 终态，直接跳过评价，列表显示「已取消」
 */

const { get, post } = require('../../utils/request.js');
const { ensureLogin, getMyOpenid } = require('../../utils/auth.js');
const { timeAgo } = require('../../utils/format.js');
const { SAFETY_TITLE, SAFETY_BRIEF, safetyModalContent } = require('../../utils/safety.js');

const STATUS_TEXT = {
  pending: '申请中',
  active: '待开始',
  started: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  rejected: '已拒绝',
};

const RATING_TEXT = { satisfied: '满意', dissatisfied: '不满意', none: '暂不评价' };
/** 交换达成（帖主已接受）后才互相可见联系方式 */
const AGREED_STATUSES = ['active', 'started', 'completed'];

Page({
  data: {
    tab: 'received', // received=收到的申请 | mine=我的交换
    list: [],
    loading: false,
    loaded: false,
    safetyBrief: SAFETY_BRIEF,
  },

  onLoad(options) {
    this.setData({ tab: options.tab === 'mine' ? 'mine' : 'received' });
  },

  onShow() {
    // 先保证登录态，再拉列表（两个接口都要求登录）
    ensureLogin()
      .catch(() => {})
      .then(() => this.load());
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab, list: [] });
    this.load();
  },

  load() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    const url = this.data.tab === 'received' ? '/api/exchanges/received' : '/api/exchanges';
    return get(url, {}, { silent: true })
      .then((data) => {
        const me = getMyOpenid();
        const list = (data && data.list || []).map((e) => this.decorate(e, me));
        this.setData({ list, loading: false, loaded: true });
      })
      .catch((err) => {
        this.setData({ loading: false, loaded: true });
        wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
      });
  },

  /** 附加展示字段与按钮可见性 */
  decorate(e, myOpenid) {
    const me = myOpenid || '';
    const done = !!me && (e.completedBy || []).includes(me);
    const evaluations = e.evaluations || [];
    // 我的评价：以后端下发的 myEvaluation 为主判据，不再只依赖 openid 比对
    //（openid 一旦解析为空，就会把"已评价"误判成"未评价"，按钮永远收不起来）
    const myEval =
      e.myEvaluation || (me ? evaluations.filter((x) => x.openid === me)[0] : null) || null;
    const evaluated = !!myEval;
    // 对方的评价：用于「收起按钮后展示双方评价」
    const peerEval =
      e.peerEvaluation || (me ? evaluations.filter((x) => x.openid && x.openid !== me)[0] : null) || null;
    // evalRole：teacher=教的人（只写评语）| learner=学的人（满意/不满意/暂不评价）
    const evalRole = e.evalRole || 'learner';
    const isTeacher = evalRole === 'teacher';

    // 开始协作（Z-14）：startBy 记录已点「开始」的人
    const startBy = e.startBy || [];
    const iAgreed = !!me && startBy.indexOf(me) >= 0;
    const peerAgreed = startBy.length > 0 && !iAgreed;
    const isActive = e.status === 'active';
    const isStarted = e.status === 'started';
    const isCancelled = e.status === 'cancelled';
    const canOperate = isActive || isStarted;

    // 取消交换（只在 active 阶段出现，替代原来的「标记完成」）：
    // 双方各确认一次 → cancelled，直接跳过评价，列表显示「已取消」
    const cancelBy = e.cancelBy || [];
    const iCanceled = !!me && cancelBy.indexOf(me) >= 0;
    const peerCanceled = cancelBy.length > 0 && !iCanceled;

    // 对方留下的取消留言（临时有事 / 再约时间）
    const peerNote = e.peerCancelNote || null;
    const showContact = AGREED_STATUSES.indexOf(e.status) >= 0;

    // 该帖已被「别的」进行中交换占住（后端 postBusy）：帖主暂不能确认新申请，其它待开始也不能开始
    const postBusy = !!e.postBusy;
    // 我和 TA 之间已有「别的」进行中交换（后端 peerBusy）：同一对用户同时只能开一摊
    // 注意这是本次修复的要点：甲和乙在两门课上各有一条待开始，先开始一摊后，另一摊必须被拦住
    const peerBusy = !!e.peerBusy;
    const startBlocked = isActive && (postBusy || peerBusy);

    return Object.assign({}, e, {
      statusText: STATUS_TEXT[e.status] || e.status,
      timeText: timeAgo(e.createTime),
      roleText: e.myRole === 'applicant' ? '我发起' : '向我申请',
      evalRole,
      evalHint: isTeacher
        ? '这次你是教学者，给 TA 写句评语吧（不计入评分）'
        : '这次你是学员，评价一下 TA 的教学：满意 / 不满意 / 暂不评价',

      // —— 开始协作 ——
      // 自己还没表态 → 可以点「教学开始 / 申请开始」；对方已表态时按钮变「确认开始」
      // 该帖已有进行中的交换（postBusy）时：不能开始，按钮换成说明
      canStart: isActive && !iAgreed && !postBusy && !peerBusy,
      startBlocked,
      startBusyTip: peerBusy
        ? '你和 TA 之间已有进行中的交换，先完成或取消这次再开始'
        : '这条帖已有进行中的交换，等这次结束后再开始',
      startLabel: peerAgreed ? '确认开始' : isTeacher ? '教学开始' : '申请开始',
      startIsConfirm: peerAgreed,
      startIsTeacher: isTeacher,
      // 对方申请开始后，我方可以「临时有事 / 再约时间」并把留言发给对方
      canDecline: isActive && peerAgreed,
      declineLabel: isTeacher ? '再约时间' : '临时有事',
      // 自己已表态、还在等对方
      startWaiting: isActive && iAgreed,
      isStarted,
      isCancelled,

      // —— 取消交换（仅「待开始」阶段出现，替代原来的「标记完成」）——
      // 两人都确认 → cancelled：直接跳过评价，列表状态显示「已取消」
      canCancel: isActive && !iCanceled,
      cancelLabel: peerCanceled ? '确认取消' : '取消交换',
      cancelIsConfirm: peerCanceled,
      cancelWaiting: isActive && iCanceled,
      cancelPeerTip: peerCanceled ? '对方申请取消这次交换，确认后即取消，不会进入评价' : '',
      cancelDoneTip: '这次交换已取消，不会进入评价',

      // —— 联系方式（交换达成后互相可见；后端已做门槛，这里再兜一层）——
      showContact,
      contactText: showContact ? e.peerContact || '' : '',
      myContactText: showContact ? e.myContact || '' : '',
      peerNoteText: peerNote ? peerNote.text : '',
      peerNoteTime: peerNote ? timeAgo(peerNote.time) : '',

      // 该帖已有进行中的交换 → 帖主暂不能确认新申请（按钮置灰并说明）
      canDecide: e.myRole === 'target' && e.status === 'pending',
      decideBlocked: postBusy || peerBusy,
      decideBusyTip: peerBusy
        ? '你和 TA 之间已有进行中的交换，等这次结束后再确认新的申请'
        : '这条帖已有进行中的交换，等这次结束后再确认新的申请',
      canComplete: isStarted && !done,
      waitingOther: isStarted && done,
      // 评价：我提交过之后立刻收起评价按钮，改为展示「评价结果」（我的 + 对方的）
      canEvaluate: e.status === 'completed' && !evaluated,
      evaluated,
      bothEvaluated: evaluated && !!peerEval,
      evalDoneTip: !evaluated
        ? ''
        : peerEval
          ? '双方评价已完成，这次交换已结束'
          : '你已完成评价，等对方评价',
      myEval: this.evalView(myEval),
      peerEval: this.evalView(peerEval),
      myEvalText: this.evalText(myEval),
      // 交换已达成（待开始/进行中/已完成但还没评价）：双方都看到安全提示条
      showSafety: (canOperate || e.status === 'completed') && !evaluated,
    });
  },

  /** 把一条评价渲染成展示对象（「我的评价」与「对方的评价」共用） */
  evalView(ev) {
    if (!ev) return null;
    return {
      rating: ev.rating || '',
      ratingText: RATING_TEXT[ev.rating] || '',
      ok: ev.rating === 'satisfied',
      bad: ev.rating === 'dissatisfied',
      comment: ev.comment || '',
      isTeacher: ev.role === 'teacher',
      timeText: ev.time ? timeAgo(ev.time) : '',
    };
  },

  /** 我已提交的评价文案：评分 + 评语 */
  evalText(ev) {
    if (!ev) return '';
    const parts = [];
    if (RATING_TEXT[ev.rating]) parts.push(RATING_TEXT[ev.rating]);
    if (ev.comment) parts.push(ev.comment);
    return parts.join(' · ') || '已提交';
  },

  // Z-09：帖主同意 → 交换正式达成，立刻向帖主强调一次安全须知
  onConfirm(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    post('/api/exchanges/' + id + '/confirm', {}, { loading: true })
      .then(() => {
        wx.showToast({ title: '已同意', icon: 'none' });
        this.load();
        // 等 toast 先起势再弹窗，避免两个浮层互相顶掉
        setTimeout(() => this.showSafetyModal(), 350);
      })
      .catch(() => this.load());
  },

  /** 安全须知弹窗：同意后自动弹一次，点提示条「详情」也可再查看 */
  showSafetyModal() {
    wx.showModal({
      title: SAFETY_TITLE,
      content: safetyModalContent(),
      showCancel: false,
      confirmText: '我知道了',
    });
  },

  onSafety() {
    this.showSafetyModal();
  },
  onReject(e) {
    this.runAction(e, '/reject', '已拒绝');
  },
  onComplete(e) {
    this.runAction(e, '/complete', '已标记完成');
  },

  /**
   * 取消交换（只在双方还没开始协作的「待开始」阶段出现）：
   * 双方各确认一次，两人都确认 → 已取消，**直接跳过评价**。
   * 对方已申请取消时，本按钮文案变为「确认取消」。
   */
  onCancel(e) {
    const ds = e.currentTarget.dataset;
    const id = ds.id;
    if (!id) return;
    const isConfirm = ds.confirm === '1' || ds.confirm === 1;
    wx.showModal({
      title: isConfirm ? '确认取消这次交换？' : '要取消这次交换吗？',
      content: isConfirm
        ? '确认后这次交换就结束了，不会进入评价。'
        : '需要对方也确认，双方都确认后这次交换即取消，不会进入评价。',
      confirmText: isConfirm ? '确认取消' : '申请取消',
      success: (r) => {
        if (!r.confirm) return;
        post('/api/exchanges/' + id + '/cancel', {}, { loading: true })
          .then((res) => {
            wx.showToast({
              title: res && res.status === 'cancelled' ? '这次交换已取消' : '已申请取消，等对方确认',
              icon: 'none',
            });
            this.load();
          })
          .catch(() => this.load());
      },
    });
  },

  /**
   * Z-14 开始协作：双方各自点一次
   * - 我先点：告诉对方「我已申请开始」，等 TA 确认
   * - 对方先点（此时按钮显示「确认开始」）：我一点，双方都确认 → 进入进行中
   */
  onStart(e) {
    const ds = e.currentTarget.dataset;
    const id = ds.id;
    if (!id) return;
    post('/api/exchanges/' + id + '/start', {}, { loading: true })
      .then((res) => {
        let title;
        if (res && res.status === 'started') title = '双方已确认开始，去准备吧';
        else if (ds.confirm === '1' || ds.confirm === 1) title = '已确认开始，等对方确认';
        else if (ds.teacher === '1' || ds.teacher === 1) title = '已发起教学开始，等对方确认';
        else title = '已发起开始申请，等对方确认';
        wx.showToast({ title, icon: 'none' });
        this.load();
      })
      .catch(() => this.load());
  },

  /** Z-14 临时有事 / 再约时间：撤回本次开始，并给对方留一条取消留言 */
  onCancelStart(e) {
    const id = e.currentTarget.dataset.id;
    const label = e.currentTarget.dataset.label || '临时有事';
    if (!id) return;
    wx.showModal({
      title: label + '，给对方留句话',
      editable: true,
      placeholderText: '如：这周有点忙，我们下周三晚上再约可以吗',
      success: (r) => {
        if (!r.confirm) return;
        post('/api/exchanges/' + id + '/cancel-start', { text: r.content || '' }, { loading: true })
          .then(() => {
            wx.showToast({ title: '留言已发送', icon: 'none' });
            this.load();
          })
          .catch(() => this.load());
      },
    });
  },

  /** 长按复制联系方式：避免手动抄微信号 */
  onCopyContact(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    const done = () => wx.showToast({ title: '已复制', icon: 'none' });
    if (typeof wx.setClipboardData !== 'function') {
      done();
      return;
    }
    wx.setClipboardData({ data: String(text), success: done });
  },
  /** 学员：满意 / 不满意 → 先补一句评语（可留空）再提交 */
  onEvaluate(e) {
    const ds = e.currentTarget.dataset;
    this.askComment(ds.id, ds.rating);
  },

  /** 学员：暂不评价 —— 不计入对方好评率，仅标记为已表态，不再重复提示 */
  onSkipEvaluate(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.runAction(e, '/evaluate', '已选暂不评价', { rating: 'none' });
  },

  /** 教学者：只写评语，不做满意 / 不满意 */
  onComment(e) {
    const id = e.currentTarget.dataset.id;
    this.askComment(id, null);
  },

  /** 弹出评语输入（可留空）→ 提交 { rating?, comment } */
  askComment(id, rating) {
    if (!id) return;
    const isTeacher = !rating;
    wx.showModal({
      title: isTeacher ? '给 TA 写一句评语' : '再补一句评语（可留空）',
      editable: true,
      placeholderText: isTeacher ? '如：学得很快、基础扎实' : '如：讲得很清楚、很有耐心',
      success: (r) => {
        if (!r.confirm) return;
        const body = { comment: r.content || '' };
        if (rating) body.rating = rating;
        post('/api/exchanges/' + id + '/evaluate', body, { loading: true })
          .then(() => {
            const map = { satisfied: '已评价：满意', dissatisfied: '已评价：不满意' };
            wx.showToast({ title: isTeacher ? '评语已提交' : (map[rating] || '已提交'), icon: 'none' });
            this.load();
          })
          .catch(() => this.load());
      },
    });
  },

  /** 统一动作：从 dataset 取 id → POST → 刷新 */
  runAction(e, suffix, title, extra) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    post('/api/exchanges/' + id + suffix, extra || {}, { loading: true })
      .then(() => {
        wx.showToast({ title, icon: 'none' });
        this.load();
      })
      .catch(() => {
        // 错误 toast 已由 request 层弹出（如重复操作 409）
        this.load();
      });
  },

  onTapPost(e) {
    const id = e.currentTarget.dataset.postid;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },
});
