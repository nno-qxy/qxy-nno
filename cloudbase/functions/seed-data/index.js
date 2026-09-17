/**
 * 临时种子函数：仅用于演示期灌入测试用户与帖子，不暴露 HTTP，无安全漏洞。
 * 用法：tcb fn deploy seed-data -e nno-d2gspwvpl6c3c9f46 && tcb fn invoke seed-data -e nno-d2gspwvpl6c3c9f46
 * 完成后：tcb fn delete seed-data -e nno-d2gspwvpl6c3c9f46
 */
const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

const SENTINEL = 'seed_lin'; // 幂等标记：已存在则跳过（除非 force）

const USERS = [
  { _openid: 'seed_lin',  nickname: '林晓', realName: '林晓', studentId: '2023110101', grade: '大三', major: '计算机学院', tags: ['英语', '编程'], contact: 'lin@example.com' },
  { _openid: 'seed_chen', nickname: '陈昊', realName: '陈昊', studentId: '2023110102', grade: '大二', major: '软件学院', tags: ['数学'], contact: 'chen@example.com' },
  { _openid: 'seed_wang', nickname: '王萌', realName: '王萌', studentId: '2023110103', grade: '大三', major: '金融学院', tags: ['金融'], contact: 'wang@example.com' },
  { _openid: 'seed_li',   nickname: '李雷', realName: '李雷', studentId: '2023110104', grade: '大四', major: '物理系', tags: ['物理'], contact: 'li@example.com' },
  { _openid: 'seed_zhao', nickname: '赵敏', realName: '赵敏', studentId: '2023110105', grade: '大一', major: '设计学院', tags: ['设计'], contact: 'zhao@example.com' },
  { _openid: 'seed_zhou', nickname: '周强', realName: '周强', studentId: '2023110106', grade: '大二', major: '化学系', tags: ['化学'], contact: 'zhou@example.com' },
];

const PALETTE = ['#2B62E0', '#7A3FE0', '#FF7A45', '#36B37E', '#00A3BF', '#6554C0'];

// status: passed 上广场；pending 进人工审核队列（演示 G-02/03/04）
const POSTS = [
  { authorId: 'seed_lin',  authorName: '林晓', type: 'teach', category: '学业辅导', title: '雅思口语陪练 30 分钟', content: '雅思 7 分，可以陪你练口语，纠正发音和表达，每周可约两次。', tags: ['英语', '口语'], status: 'passed' },
  { authorId: 'seed_chen', authorName: '陈昊', type: 'teach', category: '学业辅导', title: '数据结构期末答疑', content: '帮你梳理树、图、排序算法，期末复习不踩坑。', tags: ['编程', '算法'], status: 'passed' },
  { authorId: 'seed_wang', authorName: '王萌', type: 'learn', category: '学业辅导', title: '求高数辅导', content: '想找同学帮忙补习高数，每周两次，互相进步。', tags: ['数学'], status: 'passed' },
  { authorId: 'seed_li',   authorName: '李雷', type: 'teach', category: '实验指导', title: '大学物理实验指导', content: '物理实验报告不会写？一起讨论实验思路与数据处理。', tags: ['物理'], status: 'passed' },

  // —— 以下为「安全问题 / 待审核」演示帖（合规风险内容）——
  { authorId: 'seed_zhao', authorName: '赵敏', type: 'teach', category: '学业辅导', title: '有偿代写课程论文，包过', content: '期末论文没时间写？我帮你代写，质量有保证，费用好商量，包修改到通过。', tags: ['论文'], status: 'pending' },
  { authorId: 'seed_zhou', authorName: '周强', type: 'teach', category: '考试相关', title: '考试代考，费用好商量', content: '考试周太忙？可以提供代考服务，安全靠谱，价格优惠，先付定金。', tags: ['代考'], status: 'pending' },
  { authorId: 'seed_zhao', authorName: '赵敏', type: 'learn', category: '生活服务', title: '求购可复制校园卡', content: '想要一张能复制的校园卡，方便进出图书馆，有渠道的联系我。', tags: ['校园卡'], status: 'pending' },
  { authorId: 'seed_chen', authorName: '陈昊', type: 'teach', category: '学习服务', title: '专业刷课刷分，百分百搞定', content: '网课太多刷不过来？专业代刷，保过，不通过不收费。', tags: ['刷课'], status: 'pending' },
];

async function exist(openid) {
  const r = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return !!(r.data && r.data.length);
}

exports.main = async (event = {}) => {
  const force = event && event.force === true;
  if (!force && (await exist(SENTINEL))) {
    return { code: 0, msg: '已灌过种子数据（sentinel 存在），如需重灌请带 {force:true} 调用' };
  }
  if (force) {
    await db.collection('users').where({ _openid: db.RegExp({ regexp: '^seed_', options: 'i' }) }).remove();
    await db.collection('posts').where({ authorId: db.RegExp({ regexp: '^seed_', options: 'i' }) }).remove();
  }

  const now = Date.now();
  const userDocs = USERS.map((u, i) => ({
    ...u,
    role: 'user',
    avatarColor: PALETTE[i % PALETTE.length],
    status: 'active',
    goodCount: 0,
    totalCount: 0,
    bannedPosts: [],
    createTime: now - (USERS.length - i) * 86400000,
    updateTime: now - (USERS.length - i) * 86400000,
  }));
  const postDocs = POSTS.map((p, i) => ({
    ...p,
    authorAvatar: PALETTE[USERS.findIndex((u) => u._openid === p.authorId) % PALETTE.length],
    rejectReason: '',
    reviewTime: 0,
    reviewer: '',
    createTime: now - (POSTS.length - i) * 3600000,
    updateTime: now - (POSTS.length - i) * 3600000,
  }));

  const uRes = await db.collection('users').add(userDocs);
  const pRes = await db.collection('posts').add(postDocs);

  return {
    code: 0,
    msg: '种子数据已写入',
    users: (uRes.ids || []).length || (uRes.data || []).length || 0,
    posts: (pRes.ids || []).length || (pRes.data || []).length || 0,
    pendingPosts: POSTS.filter((p) => p.status === 'pending').length,
    passedPosts: POSTS.filter((p) => p.status === 'passed').length,
  };
};
