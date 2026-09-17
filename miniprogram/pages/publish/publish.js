/**
 * 发布技能帖（Z-04 + Z-06 内容安全双层）
 * 流程：资料完整性校验（前端+后端） → 字段校验（前端） → POST /api/posts → 后端二次校验 + 词表 + TMS → 落库
 * 返回 status=passed（已通过）时直接 toast 成功并回首页；status=pending（待审）时也显示成功但提示审核中。
 */

/**
 * 发布前资料完整性校验（与「个人信息页」必填项对齐：姓名 + 学号）
 * 避免「静默登录即能发帖」导致帖子成无名氏、缺信任基础。
 */
function isProfileComplete(u) {
  if (!u) return false;
  const realName = String(u.realName || '').trim();
  const studentId = String(u.studentId || '').trim();
  return realName.length > 0 && /^\d{8,15}$/.test(studentId);
}

const { post } = require('../../utils/request.js');
const { CATEGORIES } = require('../../config/index.js');
const { ensureLogin, refreshUser, getCachedUser } = require('../../utils/auth.js');

const TITLE_MIN = 4;
const TITLE_MAX = 30;
const CONTENT_MIN = 10;
const CONTENT_MAX = 500;
const TAG_MAX_COUNT = 8;
const TAG_MAX_LEN = 12;

Page({
  data: {
    types: [
      { key: 'teach', label: '我能教', cls: 'teach' },
      { key: 'learn', label: '我想学', cls: 'learn' },
    ],
    type: 'teach',
    cats: CATEGORIES,
    catIndex: 0,
    catPickerShow: false,
    title: '',
    content: '',
    tagsText: '',

    titleCount: 0,
    contentCount: 0,
    tagCount: 0,

    submitting: false,
    // 当前登录用户（用于发布前资料完整性校验）
    user: null,
  },

  onLoad(options) {
    // 从广场空态进来时会带 type / category，预选好意图与分类，少一次操作
    this.applyPreset(options);
    // 进入即静默登录，保证 token 已就绪；未登录直接显示 toast
    ensureLogin()
      .then((u) => this.setData({ user: u }))
      .catch(() => {
        wx.showToast({ title: '请先登录', icon: 'none' });
      });
  },

  /**
   * 支持 /pages/publish/publish?type=learn&category=学业辅导 的预选
   * 只切意图与分类，不清空已填内容（与用户手动切换 onPickType 的语义区分）
   */
  applyPreset(options) {
    if (!options) return;
    const patch = {};
    if (options.type === 'teach' || options.type === 'learn') patch.type = options.type;
    if (options.category) {
      let cat = options.category;
      try {
        cat = decodeURIComponent(cat);
      } catch (e) {}
      const i = CATEGORIES.indexOf(cat);
      if (i >= 0) patch.catIndex = i;
    }
    if (Object.keys(patch).length) this.setData(patch);
  },

  onShow() {
    // 消费从广场空态通过 switchTab 带过来的预选参数（tabBar 页无法带 query）
    try {
      const preset = wx.getStorageSync('publish_preset');
      if (preset && typeof preset === 'object') {
        this.applyPreset(preset);
        wx.removeStorageSync('publish_preset');
      }
    } catch (e) {}

    // 每次进入（含从「个人信息」返回）以服务端数据刷新用户，确保资料状态最新
    refreshUser()
      .then((u) => this.setData({ user: u }))
      .catch(() => {});
  },

  onPickType(e) {
    const t = e.currentTarget.dataset.t;
    if (t === this.data.type) return;
    // 切换「我能教 / 我想学」时清空已填内容：两种意图不同，避免串味
    this.setData({
      type: t,
      title: '',
      content: '',
      tagsText: '',
      titleCount: 0,
      contentCount: 0,
      tagCount: 0,
    });
  },

  // 分类选择：自研 picker-sheet（原生 picker 弹层在深色模式下会变黑，无法用 CSS 覆盖）
  onOpenCat() {
    this.setData({ catPickerShow: true });
  },
  onCatChange(e) {
    const index = Number((e.detail || {}).index) || 0;
    this.setData({ catIndex: index, catPickerShow: false });
  },
  onCatCancel() {
    this.setData({ catPickerShow: false });
  },

  onTitle(e) {
    this.setData({ title: e.detail.value, titleCount: (e.detail.value || '').length });
  },

  onContent(e) {
    this.setData({ content: e.detail.value, contentCount: (e.detail.value || '').length });
  },

  onTags(e) {
    const raw = e.detail.value || '';
    // 输入时把中文逗号、顿号、分号统一替换为半角逗号，方便后续切分
    const normalized = raw.replace(/[，；、]/g, ',');
    const arr = normalized.split(',').map((s) => s.trim()).filter(Boolean);
    this.setData({
      tagsText: raw,
      tagCount: arr.length,
    });
  },

  /**
   * 前端校验：仅做「必填 + 字数 + 标签数量」白名单校验
   * 真正的内容安全拦截在后端做（本地词表 + TMS）
   */
  validate() {
    const title = (this.data.title || '').trim();
    const content = (this.data.content || '').trim();
    const tags = this.parseTags();

    if (title.length < TITLE_MIN) return '标题至少 ' + TITLE_MIN + ' 字';
    if (title.length > TITLE_MAX) return '标题不能超过 ' + TITLE_MAX + ' 字';
    if (content.length < CONTENT_MIN) return '正文至少 ' + CONTENT_MIN + ' 字';
    if (content.length > CONTENT_MAX) return '正文不能超过 ' + CONTENT_MAX + ' 字';
    if (tags.length > TAG_MAX_COUNT) return '标签最多 ' + TAG_MAX_COUNT + ' 个';
    if (tags.some((t) => t.length > TAG_MAX_LEN)) return '单个标签不超过 ' + TAG_MAX_LEN + ' 字';
    return '';
  },

  parseTags() {
    return (this.data.tagsText || '')
      .replace(/[，；、]/g, ',')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  onSubmit() {
    if (this.data.submitting) return;
    const err = this.validate();
    if (err) {
      wx.showToast({ title: err, icon: 'none' });
      return;
    }

    // 发布前资料完整性校验：姓名 + 学号未完善则拦截并引导去填写
    // data.user 为空时兜底读本地缓存（避免 onLoad 异步未完成时误判未完善）
    if (!isProfileComplete(this.data.user || getCachedUser())) {
      wx.showModal({
        title: '请先完善个人信息',
        content: '发布前需填写姓名与学号，便于同学之间建立信任与联系。是否前往填写？',
        confirmText: '去填写',
        cancelText: '稍后',
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    const payload = {
      type: this.data.type,
      category: CATEGORIES[this.data.catIndex],
      title: this.data.title.trim(),
      content: this.data.content.trim(),
      tags: this.parseTags(),
    };

    this.setData({ submitting: true });
    wx.showLoading({ title: '发布中', mask: true });
    post('/api/posts', payload, { auth: true })
      .then((post) => {
        wx.hideLoading();
        const status = post && post.status;
        if (status === 'passed') {
          wx.showToast({ title: '发布成功', icon: 'success' });
        } else if (status === 'pending') {
          wx.showToast({ title: '已提交，待审核', icon: 'none' });
        } else {
          wx.showToast({ title: '已发布', icon: 'success' });
        }
        // 互补推荐：发「我能教」→ 推荐同标签的「我想学」；发「我想学」→ 推荐同标签的「我能教」
        // 无标签时无法做同标签匹配，回广场
        const tags = this.parseTags();
        const opposite = this.data.type === 'teach' ? 'learn' : 'teach';
        const newId = (post && post._id) || '';

        // 先取完 tags 再清空表单，避免返回后重复提交
        this.setData({
          title: '', content: '', tagsText: '',
          titleCount: 0, contentCount: 0, tagCount: 0,
        });

        setTimeout(() => {
          if (tags.length) {
            wx.navigateTo({
              url:
                '/pages/recommend/recommend?type=' + opposite +
                '&tags=' + encodeURIComponent(tags.join(',')) +
                '&exclude=' + encodeURIComponent(newId),
            });
          } else {
            wx.switchTab({ url: '/pages/index/index' });
          }
        }, 700);
      })
      .catch(() => {
        wx.hideLoading();
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },
});