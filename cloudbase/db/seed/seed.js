/**
 * 演示种子数据（阶段 6 验收演示 / 录屏用）
 * 运行方式：把本文件内容复制到 CloudBase 控制台「数据库 → 集合 → 导入」
 *          或在本地用 @cloudbase/node-sdk 脚本写入（需 CLI 已登录）
 *
 * 注意：_openid 字段在控制台导入时可直接写入；
 *      若通过 SDK add()，须用 { _openid: '...' } 显式指定。
 */

const now = Date.now();
const H = 3600 * 1000;
const D = 24 * H;

const users = [
  {
    _openid: 'demo_user_qi',
    role: 'user', nickname: '齐·同学', avatarColor: '#FF7A45',
    studentId: '2023010101', realName: '齐明', grade: '大三', major: '计算机科学与技术',
    tags: ['考研', '高数'], contact: '138****0001',
    status: 'active', goodCount: 12, totalCount: 14,
    createTime: now - 20 * D, updateTime: now - 2 * D,
  },
  {
    _openid: 'demo_user_lin',
    role: 'user', nickname: '林·同学', avatarColor: '#36B37E',
    studentId: '2023010102', realName: '林悦', grade: '大二', major: '音乐学',
    tags: ['吉他', '弹唱'], contact: '138****0002',
    status: 'active', goodCount: 8, totalCount: 9,
    createTime: now - 18 * D, updateTime: now - 3 * D,
  },
  {
    _openid: 'demo_user_chen',
    role: 'user', nickname: '陈·同学', avatarColor: '#6554C0',
    studentId: '2023010103', realName: '陈可', grade: '大一', major: '日语',
    tags: ['日语', '零基础'], contact: '138****0003',
    status: 'active', goodCount: 3, totalCount: 4,
    createTime: now - 15 * D, updateTime: now - 5 * D,
  },
  {
    _openid: 'demo_user_wang',
    role: 'user', nickname: '王·同学', avatarColor: '#00A3BF',
    studentId: '2023010104', realName: '王一鸣', grade: '大四', major: '视觉传达',
    tags: ['PS', '设计'], contact: '138****0004',
    status: 'active', goodCount: 20, totalCount: 21,
    createTime: now - 30 * D, updateTime: now - 1 * D,
  },
];

const posts = [
  {
    title: '考研高数重点串讲', type: 'teach', category: '学业辅导',
    content: '本人考研数学一 132 分，可系统串讲高数重点章节，每周两次，地点图书馆研讨区，免费互助。',
    tags: ['考研', '高数'], authorId: 'demo_user_qi', authorName: '齐·同学', authorAvatar: '#FF7A45',
    status: 'passed', rejectReason: '', reviewTime: now - 19 * D, reviewer: 'admin',
    createTime: now - 2 * H, updateTime: now - 2 * H,
  },
  {
    title: '吉他入门零基础教学', type: 'teach', category: '文艺特长',
    content: '音乐学专业，可带零基础同学学会基础和弦与简单弹唱，提供练习琴，时间灵活。',
    tags: ['吉他', '弹唱'], authorId: 'demo_user_lin', authorName: '林·同学', authorAvatar: '#36B37E',
    status: 'passed', rejectReason: '', reviewTime: now - 17 * D, reviewer: 'admin',
    createTime: now - 5 * H, updateTime: now - 5 * H,
  },
  {
    title: '想学日语五十音', type: 'learn', category: '语言交流',
    content: '想找同学带我入门日语五十音，可以用英语四六级备考经验交换。',
    tags: ['日语', '零基础'], authorId: 'demo_user_chen', authorName: '陈·同学', authorAvatar: '#6554C0',
    status: 'passed', rejectReason: '', reviewTime: now - 14 * D, reviewer: 'admin',
    createTime: now - 1 * D, updateTime: now - 1 * D,
  },
  {
    title: 'PS 海报设计速成', type: 'teach', category: '数码技能',
    content: '视传专业，可教 PS 海报与排版基础，从零到能独立出图，欢迎交换其它技能。',
    tags: ['PS', '设计'], authorId: 'demo_user_wang', authorName: '王·同学', authorAvatar: '#00A3BF',
    status: 'passed', rejectReason: '', reviewTime: now - 29 * D, reviewer: 'admin',
    createTime: now - 1 * D - 3 * H, updateTime: now - 1 * D - 3 * H,
  },
  {
    title: '求带 Python 爬虫入门', type: 'learn', category: '数码技能',
    content: '想学 Python 爬虫基础，可用吉他教学或高数辅导交换。',
    tags: ['Python', '爬虫'], authorId: 'demo_user_lin', authorName: '林·同学', authorAvatar: '#36B37E',
    status: 'pending', rejectReason: '',
    createTime: now - 20 * 60 * 1000, updateTime: now - 20 * 60 * 1000,
  },
];

const exchanges = [
  {
    postId: 'demo_post_001', postTitle: '考研高数重点串讲',
    applicantId: 'demo_user_chen', targetId: 'demo_user_qi',
    status: 'completed',
    completedBy: ['demo_user_chen', 'demo_user_qi'],
    evaluations: [
      { openid: 'demo_user_chen', satisfied: true, time: now - 2 * D },
      { openid: 'demo_user_qi', satisfied: true, time: now - 2 * D },
    ],
    createTime: now - 10 * D, updateTime: now - 2 * D,
  },
  {
    postId: 'demo_post_002', postTitle: '吉他入门零基础教学',
    applicantId: 'demo_user_wang', targetId: 'demo_user_lin',
    status: 'completed',
    completedBy: ['demo_user_wang'],
    evaluations: [{ openid: 'demo_user_wang', satisfied: true, time: now - 12 * H }],
    createTime: now - 6 * D, updateTime: now - 12 * H,
  },
  {
    postId: 'demo_post_004', postTitle: 'PS 海报设计速成',
    applicantId: 'demo_user_qi', targetId: 'demo_user_wang',
    status: 'active', completedBy: [], evaluations: [],
    createTime: now - 1 * D, updateTime: now - 1 * D,
  },
];

module.exports = { users, posts, exchanges };

// 直接 node seed.js 时输出 JSON，便于导出为导入文件
if (require.main === module) {
  console.log(JSON.stringify({ users, posts, exchanges }, null, 2));
}
