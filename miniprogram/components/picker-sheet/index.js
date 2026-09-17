/**
 * picker-sheet：自定义底部选择器
 *
 * 为什么不用原生 <picker>：
 *   原生 picker 的弹层由微信客户端（iOS UIPickerView / Android 原生控件）渲染，
 *   属于 Native 层，Web 层 CSS 无法覆盖。系统开启深色模式时弹层会变黑底，
 *   我们的页面是浅色主题，就会出现"黑边"。自研该组件后样式 100% 可控。
 *
 * 用法：
 *   <picker-sheet
 *     show="{{catPickerShow}}" range="{{cats}}" value="{{catIndex}}" title="选择分类"
 *     bind:change="onCatChange" bind:cancel="onCatCancel"
 *   />
 *   change 事件 detail：{ index, value }
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    range: { type: Array, value: [] },
    value: { type: Number, value: 0 },
    title: { type: String, value: '请选择' },
    cancelText: { type: String, value: '取消' },
    confirmText: { type: String, value: '确定' },
  },

  data: {
    tmpIndex: 0,
  },

  observers: {
    // 每次打开时把确认前的临时选中项同步为当前值
    show(v) {
      if (v) this.setData({ tmpIndex: Number(this.data.value) || 0 });
    },
  },

  methods: {
    /** 用于 catchtap / catchtouchmove 阻断穿透 */
    noop() {},

    onPick(e) {
      this.setData({ tmpIndex: Number(e.currentTarget.dataset.i) || 0 });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      const index = this.data.tmpIndex;
      this.triggerEvent('change', { index, value: this.data.range[index] });
    },
  },
});
