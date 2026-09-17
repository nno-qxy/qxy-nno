const { typeInfo, timeAgo, avatarOf } = require('../../utils/format.js');

Component({
  properties: {
    item: { type: Object, value: null },
  },

  data: {
    type: { text: '', cls: 'teach', arrow: '→' },
    timeText: '',
    initial: '同',
  },

  observers: {
    item: function (it) {
      if (!it) return;
      this.setData({
        type: typeInfo(it.type),
        timeText: timeAgo(it.createTime),
        initial: avatarOf(it.authorName),
      });
    },
  },

  methods: {
    onTap() {
      if (!this.data.item) return;
      this.triggerEvent('tap', { id: this.data.item._id, item: this.data.item });
    },
  },
});
