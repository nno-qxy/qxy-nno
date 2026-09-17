/**
 * 个人信息维护（Z-02）
 * 学号、姓名、年级、专业、技能标签、联系方式
 */

const { post } = require('../../utils/request.js');
const { refreshUser, getCachedUser } = require('../../utils/auth.js');

Page({
  data: {
    form: { studentId: '', realName: '', grade: '', major: '', contact: '' },
    tags: [],
    tagInput: '',
    saving: false,
    // 用户已编辑过的字段；onShow 异步拉服务端刷新时跳过这些字段，
    // 避免 fill() 把正在填的表单覆盖回后端的旧值（导致「输入框有值、保存判空」）
    dirty: {},
  },

  onLoad() {
    const u = getCachedUser();
    if (u) this.fill(u);
  },

  onShow() {
    refreshUser()
      .then((u) => this.fill(u))
      .catch(() => {});
  },

  fill(u) {
    const d = this.data.dirty || {};
    const cur = this.data.form || {};
    this.setData({
      form: {
        studentId: d.studentId ? cur.studentId : (u.studentId || ''),
        realName:   d.realName   ? cur.realName   : (u.realName   || ''),
        grade:      d.grade      ? cur.grade      : (u.grade      || ''),
        major:      d.major      ? cur.major      : (u.major      || ''),
        contact:    d.contact    ? cur.contact    : (u.contact    || ''),
      },
      tags: d.tags ? this.data.tags : (u.tags || []),
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const dirty = Object.assign({}, this.data.dirty, { [key]: true });
    this.setData({ ['form.' + key]: e.detail.value, dirty });
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value });
  },

  onAddTag() {
    const v = String(this.data.tagInput || '').trim();
    if (!v) return;
    if (this.data.tags.length >= 8) {
      wx.showToast({ title: '最多 8 个标签', icon: 'none' });
      return;
    }
    if (this.data.tags.indexOf(v) >= 0) {
      wx.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }
    this.setData({
      tags: this.data.tags.concat([v]),
      tagInput: '',
      dirty: Object.assign({}, this.data.dirty, { tags: true }),
    });
  },

  onRemoveTag(e) {
    const i = e.currentTarget.dataset.index;
    const tags = this.data.tags.slice();
    tags.splice(i, 1);
    this.setData({ tags, dirty: Object.assign({}, this.data.dirty, { tags: true }) });
  },

  onSave() {
    if (this.data.saving) return;
    const f = this.data.form;
    if (!/^\d{8,15}$/.test(String(f.studentId || '').trim())) {
      wx.showToast({ title: '学号应为 8-15 位数字', icon: 'none' });
      return;
    }
    if (!String(f.realName || '').trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    post('/api/auth/profile', Object.assign({}, f, { tags: this.data.tags }), { loading: true })
      .then(() => refreshUser())
      .then(() => {
        wx.showToast({ title: '保存成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {})
      .finally(() => this.setData({ saving: false }));
  },
});
