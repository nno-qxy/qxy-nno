/**
 * 线下交换安全提示（双方共用）
 *
 * 使用时机：
 * - 帖主点「同意交换」成功 → 弹窗强调一次（交换正式达成）
 * - 「我的交换」中 active / completed 的卡片内 → 常驻提示条（双方都能看到）
 * - 帖子详情页交换区 → 一行轻提示
 */

const SAFETY_TITLE = '交换安全提醒';

/** 完整条款（弹窗用，按重要度排序） */
const SAFETY_TIPS = [
  '首次见面约在校内公共场所（图书馆、食堂、教学楼），尽量不要单独去陌生地点或对方住处',
  '正规技能交换不涉及费用：不转账、不发红包、不代付，任何"押金/保证金/材料费"都是骗局',
  '不外借身份证、银行卡、校园卡和账号，不帮陌生人代收快递或代取现金',
  '晚间或校外见面时，把时间地点告诉一位同学或室友',
  '遇到骚扰、诈骗或让你不适的情况，立刻停止联系并反馈给我们',
];

/** 弹窗正文（带序号换行） */
function safetyModalContent() {
  return SAFETY_TIPS.map((t, i) => i + 1 + '. ' + t).join('\n');
}

/** 列表内的精简提示 */
const SAFETY_BRIEF = '注意人身与财产安全：约在校内公共场所见面，任何名义的转账都不要答应。';

/** 详情页一行轻提示 */
const SAFETY_LINE = '见面请优先选择校内公共场所；涉及转账、押金的都是骗局';

module.exports = {
  SAFETY_TITLE,
  SAFETY_TIPS,
  SAFETY_BRIEF,
  SAFETY_LINE,
  safetyModalContent,
};
