/**
 * 临时种子函数：仅用于验收 Z-07「相关推荐」效果，灌一批标签重叠的 passed 帖。
 * 不暴露 HTTP，无安全漏洞。
 * 用法：
 *   tcb fn deploy seed-related -e nno-d2gspwvpl6c3c9f46
 *   tcb fn invoke seed-related -e nno-d2gspwvpl6c3c9f46
 * 清理：
 *   tcb fn delete seed-related -e nno-d2gspwvpl6c3c9f46
 *   （删除函数不会删数据；如需清帖，调用带 {clean:true} 再删函数，或手动在云数据库删 seedMark='rel_related' 的 posts）
 */
const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

const SEED_MARK = 'rel_related'; // 便于清理：所有演示帖带此标记

const PALETTE = ['#2B62E0', '#7A3FE0', '#FF7A45', '#36B37E', '#00A3BF', '#6554C0'];

// 四个主题簇，标签刻意重叠：打开任一帖都能看到明显的相关推荐
const POSTS = [
  // —— 英语簇（英语 / 口语 / 听力 / 写作 / 四六级）——
  { authorId: 'rel_demo1', authorName: '林晓', type: 'teach', category: '学业辅导', title: '雅思口语陪练 30 分钟', content: '雅思 7 分，陪你练口语、纠发音和表达，每周可约两次。', tags: ['英语', '口语', '四六级'] },
  { authorId: 'rel_demo2', authorName: '陈昊', type: 'teach', category: '学业辅导', title: '英语写作批改（四六级/考研）', content: '帮你改作文、讲模板和逻辑，四六级与考研写作都能接。', tags: ['英语', '写作', '四六级'] },
  { authorId: 'rel_demo3', authorName: '王萌', type: 'learn', category: '学业辅导', title: '想找人练英语听力', content: '每天想练 30 分钟听力，最好能互相提问纠正，求搭子。', tags: ['英语', '听力'] },
  { authorId: 'rel_demo1', authorName: '林晓', type: 'teach', category: '学业辅导', title: '四六级冲刺陪跑', content: '听力+阅读+写作串讲，考前一个月带你冲 550+。', tags: ['英语', '四六级', '听力'] },

  // —— 高数/数学簇（高数 / 数学 / 微积分 / 线代 / 概率论）——
  { authorId: 'rel_demo2', authorName: '陈昊', type: 'teach', category: '学业辅导', title: '高数期末答疑', content: '极限、导数、积分一锅端，期末复习不踩坑。', tags: ['高数', '数学', '微积分'] },
  { authorId: 'rel_demo3', authorName: '王萌', type: 'teach', category: '学业辅导', title: '线性代数辅导', content: '矩阵、行列式、特征值，帮你建立直观理解。', tags: ['高数', '数学', '线代'] },
  { authorId: 'rel_demo4', authorName: '赵敏', type: 'learn', category: '学业辅导', title: '想学微积分', content: '微积分跟不上，想找同学每周两次补一补，互相进步。', tags: ['高数', '微积分'] },
  { authorId: 'rel_demo5', authorName: '李雷', type: 'teach', category: '学业辅导', title: '概率论与数理统计答疑', content: '随机变量、大数定律、参数估计，考研概率也能讲。', tags: ['数学', '概率论'] },

  // —— 编程簇（编程 / Python / 数据结构 / 算法 / C++）——
  { authorId: 'rel_demo1', authorName: '林晓', type: 'teach', category: '技能教学', title: 'Python 入门辅导', content: '零基础带写小项目，语法+爬虫+数据分析都行。', tags: ['编程', 'Python'] },
  { authorId: 'rel_demo2', authorName: '陈昊', type: 'teach', category: '技能教学', title: '数据结构精讲', content: '树、图、排序、查找，配合代码讲透，期末无忧。', tags: ['编程', '数据结构'] },
  { authorId: 'rel_demo6', authorName: '周强', type: 'learn', category: '技能教学', title: '想一起刷算法题', content: '每周刷 LeetCode，互相讲题，备战实习笔试。', tags: ['编程', '数据结构', '算法'] },
  { authorId: 'rel_demo5', authorName: '李雷', type: 'teach', category: '技能教学', title: 'C++ 课程答疑', content: '指针、STL、面向对象，作业和实验都能帮你看。', tags: ['编程', 'C++'] },

  // —— 兴趣簇（吉他 / 音乐 / 摄影，刻意让两帖共享「音乐」标签，避免相关为空）——
  { authorId: 'rel_demo4', authorName: '赵敏', type: 'teach', category: '兴趣生活', title: '吉他入门教学', content: '和弦、节奏、弹唱，零基础四周能弹一首歌。', tags: ['吉他', '音乐'] },
  { authorId: 'rel_demo6', authorName: '周强', type: 'teach', category: '兴趣生活', title: '摄影构图与后期', content: '手机也能拍，讲构图、光线和简单后期，音乐节跟拍也接。', tags: ['摄影', '音乐'] },
];

async function countMarked() {
  const r = await db.collection('posts').where({ seedMark: SEED_MARK }).count();
  return (r.total || 0);
}

exports.main = async (event = {}) => {
  const clean = event && event.clean === true;
  if (clean) {
    const del = await db.collection('posts').where({ seedMark: SEED_MARK }).remove();
    return { code: 0, msg: '已清理相关推荐演示帖', removed: del.removed || 0 };
  }

  const exist = await countMarked();
  if (exist > 0) {
    return { code: 0, msg: `已存在 ${exist} 篇相关推荐演示帖，无需重复灌（如需重灌请带 {clean:true}）`, count: exist };
  }

  const now = Date.now();
  const postDocs = POSTS.map((p, i) => ({
    ...p,
    seedMark: SEED_MARK,
    status: 'passed',
    authorAvatar: PALETTE[i % PALETTE.length],
    rejectReason: '',
    reviewTime: 0,
    reviewer: '',
    createTime: now - (POSTS.length - i) * 3600000,
    updateTime: now - (POSTS.length - i) * 3600000,
  }));

  const pRes = await db.collection('posts').add(postDocs);
  const added = (pRes.ids || []).length || (pRes.data || []).length || 0;

  return {
    code: 0,
    msg: '相关推荐演示帖已写入',
    posts: added,
    themes: {
      英语: POSTS.filter((p) => p.tags.includes('英语')).length,
      高数数学: POSTS.filter((p) => p.tags.includes('高数') || p.tags.includes('数学')).length,
      编程: POSTS.filter((p) => p.tags.includes('编程')).length,
      兴趣: POSTS.filter((p) => p.tags.includes('吉他') || p.tags.includes('摄影')).length,
    },
  };
};
