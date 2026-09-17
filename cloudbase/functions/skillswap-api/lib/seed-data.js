/**
 * 测试数据基底（约 150 条跨类型）
 * - users     22 条（含 1 个已封禁账号，用于测试 G-08 封禁）
 * - posts    100 条（passed 88 / offline 3 / rejected 4 / pending 5；teach+learn 成对，覆盖 6 大分类）
 * - exchanges 28 条（pending 7 / active 8 / completed 10 / rejected 3；completed 带互评）
 * 合计 150 条。
 *
 * 设计要点：
 * - teach 与 learn 在热门标签上成对存在，便于验证「发布我能教→推荐同标签我想学」的互补推荐。
 * - pending 帖带风控词、rejected 帖带驳回原因，便于直接验收审核队列与已审记录。
 * - 帖子 authorId / 交换 applicantId·targetId 均引用预置 _openid，保证引用一致。
 * 用法：runSeed(db, COLLECTIONS, { reset }) —— reset=true 先清空三集合再写入，否则追加。
 * 该文件不依赖任何云 SDK，db 由调用方（云函数）注入，便于本地单测用 mock 验证。
 */

const AVATAR_COLORS = ['#2B62E0', '#7A3FE0', '#FF7A45', '#36B37E', '#00A3BF', '#6554C0'];

// 22 名用户：openid 固定，便于帖子/交换引用；day 为「距今天数」用于生成 createTime
const USERS = [
  { openid: 'seed_u01', nickname: '林晓', realName: '林晓', studentId: '2023110101', grade: '大三', major: '计算机科学与技术', tags: ['Python', '编程', '算法'],     contact: 'wx_linxiao',     status: 'active', goodCount: 12, totalCount: 13, day: 20 },
  { openid: 'seed_u02', nickname: '陈悦', realName: '陈悦', studentId: '2023110202', grade: '大二', major: '英语',             tags: ['英语', '口语', '四六级'],     contact: 'wx_chenyue',     status: 'active', goodCount: 8,  totalCount: 9,  day: 20 },
  { openid: 'seed_u03', nickname: '王浩', realName: '王浩', studentId: '2023110303', grade: '大三', major: '数学',             tags: ['高数', '线代', '考研数学'],   contact: 'wx_wanghao',     status: 'active', goodCount: 5,  totalCount: 6,  day: 19 },
  { openid: 'seed_u04', nickname: '李娜', realName: '李娜', studentId: '2023110404', grade: '大二', major: '视觉传达设计',     tags: ['摄影', 'PS', '设计'],         contact: 'wx_lina',        status: 'active', goodCount: 9,  totalCount: 10, day: 19 },
  { openid: 'seed_u05', nickname: '张伟', realName: '张伟', studentId: '2023110505', grade: '大四', major: '体育教育',         tags: ['健身', '篮球', '游泳'],       contact: 'wx_zhangwei',    status: 'active', goodCount: 6,  totalCount: 7,  day: 18 },
  { openid: 'seed_u06', nickname: '刘洋', realName: '刘洋', studentId: '2023110606', grade: '大三', major: '软件工程',         tags: ['Java', '前端', '小程序'],     contact: 'wx_liuyang',     status: 'active', goodCount: 4,  totalCount: 5,  day: 18 },
  { openid: 'seed_u07', nickname: '赵敏', realName: '赵敏', studentId: '2023110707', grade: '大二', major: '音乐表演',         tags: ['吉他', '钢琴', '声乐'],       contact: 'wx_zhaomin',     status: 'active', goodCount: 7,  totalCount: 8,  day: 17 },
  { openid: 'seed_u08', nickname: '孙强', realName: '孙强', studentId: '2023110808', grade: '大三', major: '电子信息',         tags: ['电路', '单片机', 'Arduino'],  contact: 'wx_sunqiang',    status: 'active', goodCount: 3,  totalCount: 4,  day: 17 },
  { openid: 'seed_u09', nickname: '周婷', realName: '周婷', studentId: '2023110909', grade: '大四', major: '汉语言文学',       tags: ['写作', '书法', '国学'],       contact: 'wx_zhouting',    status: 'active', goodCount: 10, totalCount: 11, day: 16 },
  { openid: 'seed_u10', nickname: '吴磊', realName: '吴磊', studentId: '2023110110', grade: '大二', major: '自动化',           tags: ['Python', '机器学习', '数模'], contact: 'wx_wulei',       status: 'active', goodCount: 2,  totalCount: 3,  day: 16 },
  { openid: 'seed_u11', nickname: '郑爽', realName: '郑爽', studentId: '2023110111', grade: '大三', major: '金融',             tags: ['理财', 'Excel', '证券'],      contact: 'wx_zhengshuang', status: 'active', goodCount: 5,  totalCount: 6,  day: 15 },
  { openid: 'seed_u12', nickname: '黄蓉', realName: '黄蓉', studentId: '2023110112', grade: '大二', major: '临床医学',         tags: ['解剖', '生理', '考研'],       contact: 'wx_huangrong',   status: 'banned', goodCount: 0,  totalCount: 1,  day: 15 },
  { openid: 'seed_u13', nickname: '冯磊', realName: '冯磊', studentId: '2023110113', grade: '大三', major: '日语',             tags: ['日语', '韩语'],               contact: 'wx_fenglei',     status: 'active', goodCount: 6,  totalCount: 7,  day: 14 },
  { openid: 'seed_u14', nickname: '何静', realName: '何静', studentId: '2023110114', grade: '大二', major: '食品科学',         tags: ['烹饪', '烘焙'],               contact: 'wx_hejing',      status: 'active', goodCount: 8,  totalCount: 9,  day: 14 },
  { openid: 'seed_u15', nickname: '许洋', realName: '许洋', studentId: '2023110115', grade: '大四', major: '体育训练',         tags: ['羽毛球', '网球', '乒乓球'],   contact: 'wx_xuyang',      status: 'active', goodCount: 4,  totalCount: 5,  day: 13 },
  { openid: 'seed_u16', nickname: '邓丽', realName: '邓丽', studentId: '2023110116', grade: '大三', major: '服装设计',         tags: ['化妆', '穿搭', '收纳'],       contact: 'wx_dengli',      status: 'active', goodCount: 9,  totalCount: 10, day: 13 },
  { openid: 'seed_u17', nickname: '曹阳', realName: '曹阳', studentId: '2023110117', grade: '大二', major: '广播电视编导',     tags: ['剪辑', '摄影', '新媒体'],     contact: 'wx_caoyang',     status: 'active', goodCount: 7,  totalCount: 8,  day: 12 },
  { openid: 'seed_u18', nickname: '彭飞', realName: '彭飞', studentId: '2023110118', grade: '大三', major: '信息管理',         tags: ['Excel', 'PPT', 'Office'],     contact: 'wx_pengfei',     status: 'active', goodCount: 5,  totalCount: 6,  day: 12 },
  { openid: 'seed_u19', nickname: '苏晴', realName: '苏晴', studentId: '2023110119', grade: '大二', major: '舞蹈学',           tags: ['舞蹈', '瑜伽'],               contact: 'wx_suqing',      status: 'active', goodCount: 3,  totalCount: 4,  day: 11 },
  { openid: 'seed_u20', nickname: '卢明', realName: '卢明', studentId: '2023110120', grade: '大三', major: '应用物理',         tags: ['物理', 'CAD'],                contact: 'wx_luming',      status: 'active', goodCount: 2,  totalCount: 3,  day: 11 },
  { openid: 'seed_u21', nickname: '韩雪', realName: '韩雪', studentId: '2023110121', grade: '大二', major: '民族音乐',         tags: ['古筝', '钢琴', '绘画'],       contact: 'wx_hanxue',      status: 'active', goodCount: 6,  totalCount: 7,  day: 10 },
  { openid: 'seed_u22', nickname: '秦朗', realName: '秦朗', studentId: '2023110122', grade: '大四', major: '播音主持',         tags: ['演讲', '辩论', '主持'],       contact: 'wx_qinlang',     status: 'active', goodCount: 4,  totalCount: 5,  day: 10 },
];

// 100 条帖子。key 供交换引用；status 决定其在广场/审核队列的表现。
// day 为「距今天数」：passed 多分布在近 20 天以丰富趋势图；pending/rejected/offline 分散。
// 每个用户 4 条 passed（2 teach + 2 learn），保证 teach/learn 在热门标签上成对。
const POSTS = [
  // ================= 88 条 passed（p01–p88）=================
  // --- seed_u01 林晓（计算机）---
  { key: 'p01', authorId: 'seed_u01', type: 'teach', category: '学业辅导', title: 'Python 编程一对一辅导',   tags: ['Python', '编程', '算法'],      content: '零基础到能写小脚本，按需定制计划，可线下也可线上。', day: 1 },
  { key: 'p02', authorId: 'seed_u01', type: 'teach', category: '数码技能', title: '数据结构与算法辅导',     tags: ['数据结构', '算法', '编程'],    content: '链表树图递归全覆盖，附手写代码模板与真题演练。', day: 8 },
  { key: 'p03', authorId: 'seed_u01', type: 'learn', category: '语言交流', title: '想练英语口语',           tags: ['英语', '口语'],                content: '读写还行，一开口就卡，想找人每周练两次。', day: 3 },
  { key: 'p04', authorId: 'seed_u01', type: 'learn', category: '数码技能', title: '想学 PS 修图',           tags: ['PS', '设计'],                  content: '会写代码但审美为零，想学人像修图与调色。', day: 12 },

  // --- seed_u02 陈悦（英语）---
  { key: 'p05', authorId: 'seed_u02', type: 'teach', category: '语言交流', title: '英语口语陪练（四六级）', tags: ['英语', '口语', '四六级'],      content: '每天半小时陪练，纠正发音与表达，备考更高效。', day: 2 },
  { key: 'p06', authorId: 'seed_u02', type: 'teach', category: '语言交流', title: '雅思口语模考陪练',       tags: ['雅思', '英语', '口语'],        content: '还原考场流程，part1-3 逐题反馈与素材积累。', day: 7 },
  { key: 'p07', authorId: 'seed_u02', type: 'learn', category: '数码技能', title: '想学视频剪辑',           tags: ['剪辑', '新媒体'],              content: '想自己剪 vlog 和课程作业，求带入门。', day: 9 },
  { key: 'p08', authorId: 'seed_u02', type: 'learn', category: '文艺特长', title: '想学吉他和弦',           tags: ['吉他'],                        content: '一直想弹唱，能坚持每周练琴三次。', day: 14 },

  // --- seed_u03 王浩（数学）---
  { key: 'p09', authorId: 'seed_u03', type: 'teach', category: '学业辅导', title: '高等数学期中复习串讲',   tags: ['高数', '考研数学'],            content: '极限、微分、积分重点梳理，配套真题演练。', day: 2 },
  { key: 'p10', authorId: 'seed_u03', type: 'teach', category: '学业辅导', title: '线性代数答疑',           tags: ['线代', '高数', '考研数学'],    content: '矩阵、特征值、线性方程组，讲懂为止。', day: 9 },
  { key: 'p11', authorId: 'seed_u03', type: 'learn', category: '语言交流', title: '想学日语入门',           tags: ['日语'],                        content: '五十音图刚背完，想找人练发音和简单会话。', day: 6 },
  { key: 'p12', authorId: 'seed_u03', type: 'learn', category: '数码技能', title: '想学前端开发',           tags: ['前端', '小程序'],              content: '有编程基础，想做个人主页和校园小工具。', day: 13 },

  // --- seed_u04 李娜（设计）---
  { key: 'p13', authorId: 'seed_u04', type: 'teach', category: '文艺特长', title: '人像摄影基础教学',       tags: ['摄影', 'PS', '设计'],          content: '从构图用光到后期调色，带相机来即可上手。', day: 3 },
  { key: 'p14', authorId: 'seed_u04', type: 'teach', category: '数码技能', title: 'Photoshop 修图入门',     tags: ['PS', '设计', '摄影'],          content: '人像磨皮调色、海报排版，案例驱动教学。', day: 8 },
  { key: 'p15', authorId: 'seed_u04', type: 'learn', category: '文艺特长', title: '想学钢琴',               tags: ['钢琴'],                        content: '零基础，想学一首完整的曲子，可以慢慢练。', day: 5 },
  { key: 'p16', authorId: 'seed_u04', type: 'learn', category: '生活服务', title: '想学做菜',               tags: ['烹饪'],                        content: '天天外卖吃腻了，想学几个拿手的家常菜。', day: 15 },

  // --- seed_u05 张伟（体育）---
  { key: 'p17', authorId: 'seed_u05', type: 'teach', category: '体育健身', title: '健身房私教体验课',       tags: ['健身', '篮球'],                content: '科学增肌减脂计划，第一次体验课免费评估。', day: 3 },
  { key: 'p18', authorId: 'seed_u05', type: 'teach', category: '体育健身', title: '游泳私教（成人/中考）',  tags: ['游泳', '健身'],                content: '蛙泳自由泳零基础包会，分阶小班教学。', day: 11 },
  { key: 'p19', authorId: 'seed_u05', type: 'learn', category: '生活服务', title: '想学理财',               tags: ['理财'],                        content: '有闲钱不知道怎么打理，想学记账和定投。', day: 4 },
  { key: 'p20', authorId: 'seed_u05', type: 'learn', category: '数码技能', title: '想学 Excel',             tags: ['Excel'],                       content: '实习要用到数据透视表，想找人速成。', day: 16 },

  // --- seed_u06 刘洋（软件）---
  { key: 'p21', authorId: 'seed_u06', type: 'teach', category: '数码技能', title: '微信小程序开发带做',     tags: ['小程序', '前端'],              content: '从云开发到上线，帮你做出第一个可运行的小程序。', day: 4 },
  { key: 'p22', authorId: 'seed_u06', type: 'teach', category: '数码技能', title: 'Java 后端入门',          tags: ['Java', '编程'],                content: '从语法到 Spring Boot 写接口，项目驱动教学。', day: 10 },
  { key: 'p23', authorId: 'seed_u06', type: 'learn', category: '学业辅导', title: '想学机器学习',           tags: ['机器学习', 'Python'],          content: '有 Python 基础，想入门模型训练与调参。', day: 6 },
  { key: 'p24', authorId: 'seed_u06', type: 'learn', category: '文艺特长', title: '想学钢琴即兴伴奏',       tags: ['钢琴'],                        content: '会五线谱，想学给流行歌配伴奏。', day: 17 },

  // --- seed_u07 赵敏（音乐）---
  { key: 'p25', authorId: 'seed_u07', type: 'teach', category: '文艺特长', title: '吉他入门十节课',         tags: ['吉他', '声乐'],                content: '民谣弹唱入门，十节课学会三首完整曲目。', day: 4 },
  { key: 'p26', authorId: 'seed_u07', type: 'teach', category: '文艺特长', title: '钢琴陪练（初级）',       tags: ['钢琴', '声乐'],                content: '纠正手型与节奏，考级曲目逐句打磨。', day: 9 },
  { key: 'p27', authorId: 'seed_u07', type: 'learn', category: '文艺特长', title: '想学古筝',               tags: ['古筝'],                        content: '喜欢民乐，想从零开始学一首《渔舟唱晚》。', day: 7 },
  { key: 'p28', authorId: 'seed_u07', type: 'learn', category: '体育健身', title: '想学瑜伽',               tags: ['瑜伽'],                        content: '久坐腰疼，想学几个舒缓体式在家练。', day: 18 },

  // --- seed_u08 孙强（电子）---
  { key: 'p29', authorId: 'seed_u08', type: 'teach', category: '数码技能', title: '电子电路焊接指导',       tags: ['电路', '单片机'],              content: '焊接、调试、读图全教，实验室器材可用。', day: 5 },
  { key: 'p30', authorId: 'seed_u08', type: 'teach', category: '数码技能', title: 'Arduino 创客入门',       tags: ['Arduino', '单片机', '电路'],   content: '点亮第一颗灯到智能小车，软硬件都讲。', day: 11 },
  { key: 'p31', authorId: 'seed_u08', type: 'learn', category: '数码技能', title: '想学 CAD 制图',          tags: ['CAD'],                         content: '课程设计要画装配图，求带入门。', day: 8 },
  { key: 'p32', authorId: 'seed_u08', type: 'learn', category: '语言交流', title: '想练英语口语',           tags: ['英语', '口语'],                content: '要过六级，听力和口语都弱，想找人陪练。', day: 15 },

  // --- seed_u09 周婷（人文）---
  { key: 'p33', authorId: 'seed_u09', type: 'teach', category: '文艺特长', title: '硬笔书法公益课',         tags: ['书法', '写作'],                content: '楷书钢笔字结构训练，免费带纸笔来即可。', day: 5 },
  { key: 'p34', authorId: 'seed_u09', type: 'teach', category: '文艺特长', title: '新媒体写作分享',         tags: ['写作', '新媒体'],              content: '公众号推文结构与方法，附改稿案例。', day: 10 },
  { key: 'p35', authorId: 'seed_u09', type: 'learn', category: '文艺特长', title: '想学摄影',               tags: ['摄影'],                        content: '想拍好看的照片发公众号，需要学构图。', day: 6 },
  { key: 'p36', authorId: 'seed_u09', type: 'learn', category: '数码技能', title: '想学 PPT 设计',          tags: ['PPT', 'Office'],               content: '答辩 PPT 总被说土，想学配色和排版。', day: 16 },

  // --- seed_u10 吴磊（自动化）---
  { key: 'p37', authorId: 'seed_u10', type: 'teach', category: '学业辅导', title: '机器学习导论答疑',       tags: ['机器学习', 'Python', '算法'],  content: '回归分类基础讲透，配套作业讲解与上机。', day: 6 },
  { key: 'p38', authorId: 'seed_u10', type: 'teach', category: '学业辅导', title: '数学建模竞赛辅导',       tags: ['数模', '算法', 'Python'],      content: '选题、建模、论文全流程，送往年获奖模板。', day: 12 },
  { key: 'p39', authorId: 'seed_u10', type: 'learn', category: '生活服务', title: '想学做菜',               tags: ['烹饪'],                        content: '一个人住，想学几道简单又好吃的菜。', day: 9 },
  { key: 'p40', authorId: 'seed_u10', type: 'learn', category: '语言交流', title: '想学韩语',               tags: ['韩语'],                        content: '喜欢韩综，想学日常会话和发音。', day: 17 },

  // --- seed_u11 郑爽（金融）---
  { key: 'p41', authorId: 'seed_u11', type: 'teach', category: '生活服务', title: '个人理财规划咨询',       tags: ['理财', 'Excel'],               content: '记账、定投、保险基础，帮你理清收支。', day: 6 },
  { key: 'p42', authorId: 'seed_u11', type: 'teach', category: '数码技能', title: 'Excel 数据可视化速成',   tags: ['Excel', '理财'],               content: '透视表、图表、看板，办公效率翻倍。', day: 11 },
  { key: 'p43', authorId: 'seed_u11', type: 'learn', category: '文艺特长', title: '想学书法',               tags: ['书法'],                        content: '想练一手好字，求老师带基本笔画。', day: 8 },
  { key: 'p44', authorId: 'seed_u11', type: 'learn', category: '体育健身', title: '想学健身',               tags: ['健身'],                        content: '想减脂塑形，需要有人带练和纠正动作。', day: 18 },

  // --- seed_u12 黄蓉（医学，已封禁）---
  { key: 'p45', authorId: 'seed_u12', type: 'teach', category: '学业辅导', title: '解剖学记忆法分享',       tags: ['解剖', '考研'],                content: '口诀加图谱记忆，医学考研解剖不再怕。', day: 7 },
  { key: 'p46', authorId: 'seed_u12', type: 'teach', category: '学业辅导', title: '生理学期末冲刺',         tags: ['生理', '考研'],                content: '循环、呼吸、神经重点串讲，配历年真题。', day: 13 },
  { key: 'p47', authorId: 'seed_u12', type: 'learn', category: '生活服务', title: '想学收纳整理',           tags: ['收纳'],                        content: '宿舍东西太多，想学收纳和断舍离。', day: 10 },
  { key: 'p48', authorId: 'seed_u12', type: 'learn', category: '文艺特长', title: '想学水彩绘画',           tags: ['绘画'],                        content: '零基础，想画简单的植物和风景。', day: 19 },

  // --- seed_u13 冯磊（语言）---
  { key: 'p49', authorId: 'seed_u13', type: 'teach', category: '语言交流', title: '日语零基础入门',         tags: ['日语'],                        content: '五十音到 N4 基础语法，配套听力练习。', day: 7 },
  { key: 'p50', authorId: 'seed_u13', type: 'teach', category: '语言交流', title: '韩语发音入门',           tags: ['韩语'],                        content: '从收音规则到连音，纠正常见发音错误。', day: 12 },
  { key: 'p51', authorId: 'seed_u13', type: 'learn', category: '数码技能', title: '想学 Python',            tags: ['Python', '编程'],              content: '文科生想学编程做数据整理，求入门。', day: 9 },
  { key: 'p52', authorId: 'seed_u13', type: 'learn', category: '学业辅导', title: '想学高数',               tags: ['高数'],                        content: '转专业要补高数，基础薄弱求带。', day: 17 },

  // --- seed_u14 何静（美食）---
  { key: 'p53', authorId: 'seed_u14', type: 'teach', category: '生活服务', title: '家常菜烹饪教学',         tags: ['烹饪'],                        content: '十道拿手家常菜，从备菜到火候全教。', day: 8 },
  { key: 'p54', authorId: 'seed_u14', type: 'teach', category: '生活服务', title: '烘焙入门（蛋糕面包）',   tags: ['烘焙', '烹饪'],                content: '戚风、吐司、曲奇，配方与手法都给你。', day: 14 },
  { key: 'p55', authorId: 'seed_u14', type: 'learn', category: '数码技能', title: '想学 PS 修图',           tags: ['PS', '设计'],                  content: '想把菜品照片修得更好看，求带入。', day: 10 },
  { key: 'p56', authorId: 'seed_u14', type: 'learn', category: '文艺特长', title: '想学舞蹈',               tags: ['舞蹈'],                        content: '想学一支简单的爵士，活动身体。', day: 18 },

  // --- seed_u15 许洋（运动）---
  { key: 'p57', authorId: 'seed_u15', type: 'teach', category: '体育健身', title: '羽毛球技术训练',         tags: ['羽毛球', '网球'],              content: '高远球、杀球、步法，按水平分组带练。', day: 8 },
  { key: 'p58', authorId: 'seed_u15', type: 'teach', category: '体育健身', title: '网球发球陪练',           tags: ['网球', '羽毛球'],              content: '发球抛球分解教学，陪练纠正动作。', day: 13 },
  { key: 'p59', authorId: 'seed_u15', type: 'learn', category: '学业辅导', title: '想学概率论',             tags: ['概率论', '考研数学'],          content: '考研数学概率部分一直学不明白，求带。', day: 11 },
  { key: 'p60', authorId: 'seed_u15', type: 'learn', category: '生活服务', title: '想学化妆',               tags: ['化妆', '美妆'],                content: '面试和答辩想化个干净的妆，求入门。', day: 19 },

  // --- seed_u16 邓丽（美妆）---
  { key: 'p61', authorId: 'seed_u16', type: 'teach', category: '生活服务', title: '日常妆容教学',           tags: ['化妆', '美妆'],                content: '底妆、眉形、眼妆，手把手教到能上手。', day: 9 },
  { key: 'p62', authorId: 'seed_u16', type: 'teach', category: '生活服务', title: '穿搭风格诊断',           tags: ['穿搭', '化妆'],                content: '按身材和场合给搭配建议，帮你整理衣橱。', day: 15 },
  { key: 'p63', authorId: 'seed_u16', type: 'learn', category: '数码技能', title: '想学视频剪辑',           tags: ['剪辑', '新媒体'],              content: '想把穿搭做成短视频，求带剪辑入门。', day: 11 },
  { key: 'p64', authorId: 'seed_u16', type: 'learn', category: '数码技能', title: '想学 Excel 函数',        tags: ['Excel', 'Office'],             content: '做表格总是手动算，想学函数和透视表。', day: 19 },

  // --- seed_u17 曹阳（视频）---
  { key: 'p65', authorId: 'seed_u17', type: 'teach', category: '数码技能', title: '短视频剪辑入门',         tags: ['剪辑', '新媒体'],              content: '剪映与 Pr 基础，从素材到成片全流程。', day: 9 },
  { key: 'p66', authorId: 'seed_u17', type: 'teach', category: '文艺特长', title: '手机摄影技巧',           tags: ['摄影', '剪辑'],                content: '构图、光线、后期，一部手机拍大片。', day: 14 },
  { key: 'p67', authorId: 'seed_u17', type: 'learn', category: '数码技能', title: '想学小程序开发',         tags: ['小程序', '前端'],              content: '想给自己的视频号做个展示小程序。', day: 12 },
  { key: 'p68', authorId: 'seed_u17', type: 'learn', category: '语言交流', title: '想学日语',               tags: ['日语'],                        content: '想看生肉番剧，想学听力和会话。', day: 20 },

  // --- seed_u18 彭飞（办公）---
  { key: 'p69', authorId: 'seed_u18', type: 'teach', category: '数码技能', title: 'PPT 演示设计',           tags: ['PPT', 'Office'],               content: '版式、配色、动画，答辩汇报不再土。', day: 10 },
  { key: 'p70', authorId: 'seed_u18', type: 'teach', category: '数码技能', title: 'Excel 函数与透视表',     tags: ['Excel', 'Office'],             content: '常用函数搭配数据透视，处理表格效率翻倍。', day: 15 },
  { key: 'p71', authorId: 'seed_u18', type: 'learn', category: '数码技能', title: '想学前端开发',           tags: ['前端', '小程序'],              content: '做运营想自己改页面，学点前端基础。', day: 13 },
  { key: 'p72', authorId: 'seed_u18', type: 'learn', category: '文艺特长', title: '想学吉他弹唱',           tags: ['吉他'],                        content: '想在公司年会上弹唱一首，求带。', day: 20 },

  // --- seed_u19 苏晴（舞蹈）---
  { key: 'p73', authorId: 'seed_u19', type: 'teach', category: '文艺特长', title: '街舞入门教学',           tags: ['舞蹈', '瑜伽'],                content: '基础律动与成品舞，零基础也能跟上。', day: 10 },
  { key: 'p74', authorId: 'seed_u19', type: 'teach', category: '体育健身', title: '瑜伽体式纠正',           tags: ['瑜伽', '舞蹈'],                content: '针对久坐人群的体式纠正与呼吸练习。', day: 16 },
  { key: 'p75', authorId: 'seed_u19', type: 'learn', category: '生活服务', title: '想学烘焙',               tags: ['烘焙'],                        content: '想学做蛋糕给朋友过生日，求带。', day: 14 },
  { key: 'p76', authorId: 'seed_u19', type: 'learn', category: '数码技能', title: '想学 CAD 制图',          tags: ['CAD'],                         content: '想学画简单的平面图，用于家庭改造。', day: 20 },

  // --- seed_u20 卢明（理工）---
  { key: 'p77', authorId: 'seed_u20', type: 'teach', category: '学业辅导', title: '大学物理答疑',           tags: ['物理'],                        content: '力学、电磁学重点梳理，配例题精讲。', day: 11 },
  { key: 'p78', authorId: 'seed_u20', type: 'teach', category: '数码技能', title: 'CAD 制图入门',           tags: ['CAD', '物理'],                 content: 'AutoCAD 二维绘图与标注，课程设计够用。', day: 16 },
  { key: 'p79', authorId: 'seed_u20', type: 'learn', category: '学业辅导', title: '想学线性代数',           tags: ['线代', '高数'],                content: '备考需要补线代，求系统讲解。', day: 15 },
  { key: 'p80', authorId: 'seed_u20', type: 'learn', category: '学业辅导', title: '想学机器学习',           tags: ['机器学习', 'Python'],          content: '想用机器学习做物理数据分析，求入门。', day: 20 },

  // --- seed_u21 韩雪（艺术）---
  { key: 'p81', authorId: 'seed_u21', type: 'teach', category: '文艺特长', title: '古筝入门教学',           tags: ['古筝', '钢琴'],                content: '手型、指法、简单曲目，零基础可学。', day: 11 },
  { key: 'p82', authorId: 'seed_u21', type: 'teach', category: '文艺特长', title: '水彩绘画基础',           tags: ['绘画', '摄影'],                content: '水彩晕染与配色，从静物到风景。', day: 17 },
  { key: 'p83', authorId: 'seed_u21', type: 'learn', category: '文艺特长', title: '想学书法',               tags: ['书法'],                        content: '想练好硬笔字，求老师指点结构。', day: 16 },
  { key: 'p84', authorId: 'seed_u21', type: 'learn', category: '体育健身', title: '想学游泳',               tags: ['游泳'],                        content: '完全不会换气，想在暑假学会蛙泳。', day: 20 },

  // --- seed_u22 秦朗（演讲）---
  { key: 'p85', authorId: 'seed_u22', type: 'teach', category: '生活服务', title: '公众演讲训练',           tags: ['演讲', '辩论'],                content: '克服紧张、结构表达、临场应变，实战演练。', day: 12 },
  { key: 'p86', authorId: 'seed_u22', type: 'teach', category: '文艺特长', title: '活动主持入门',           tags: ['演讲', '新媒体'],              content: '从串词撰写到台上控场，晚会主持全流程。', day: 17 },
  { key: 'p87', authorId: 'seed_u22', type: 'learn', category: '数码技能', title: '想学 Office 三件套',     tags: ['Office', 'PPT'],               content: '实习要用 Word、Excel、PPT，想系统学一遍。', day: 18 },
  { key: 'p88', authorId: 'seed_u22', type: 'learn', category: '学业辅导', title: '想学考研数学',           tags: ['考研数学', '高数'],            content: '准备跨考，数学基础弱，想找人带。', day: 20 },

  // ================= 3 条 offline（作者主动下架，p89–p91）=================
  { key: 'p89', authorId: 'seed_u05', type: 'teach', category: '体育健身', title: '夜跑约伴（已暂停）',     tags: ['跑步', '健身'],                content: '原每晚操场夜跑，近期暂停，恢复后重发。', day: 5, status: 'offline' },
  { key: 'p90', authorId: 'seed_u07', type: 'teach', category: '文艺特长', title: '古筝试听课（暂下线）',   tags: ['古筝', '声乐'],                content: '因器材调整暂下线，后续重新开放预约。', day: 6, status: 'offline' },
  { key: 'p91', authorId: 'seed_u18', type: 'teach', category: '数码技能', title: 'Word 排版服务（已下架）', tags: ['Office', 'PPT'],               content: '原提供论文排版服务，现因故暂停接单。', day: 7, status: 'offline' },

  // ================= 4 条 rejected（带驳回原因，p92–p95）=================
  { key: 'p92', authorId: 'seed_u12', type: 'teach', category: '生活服务', title: '代写毕业论文包过',       tags: ['代写', '包过'],                content: '各科论文代写，查重包过，联系微信详谈。', day: 2, status: 'rejected', rejectReason: '疑似代写代考，违反平台内容规范' },
  { key: 'p93', authorId: 'seed_u12', type: 'learn', category: '学业辅导', title: '求代考英语四级',         tags: ['代考', '有偿代'],              content: '四级一直不过，出钱找人替考一次。', day: 3, status: 'rejected', rejectReason: '代考属严重违规行为，已驳回' },
  { key: 'p94', authorId: 'seed_u05', type: 'teach', category: '体育健身', title: '出售健身补剂一件代发',   tags: ['健身'],                        content: '各类增肌粉低价出，量大从优加微信。', day: 4, status: 'rejected', rejectReason: '含商业推销内容，不符合技能交换定位' },
  { key: 'p95', authorId: 'seed_u09', type: 'teach', category: '文艺特长', title: '代写各类演讲稿',         tags: ['代写', '写作'],                content: '承接各类演讲稿代写，按字数收费。', day: 5, status: 'rejected', rejectReason: '涉及代写服务，已驳回' },

  // ================= 5 条 pending（含风控词，p96–p100）=================
  { key: 'p96', authorId: 'seed_u03', type: 'teach', category: '学业辅导', title: '期末考试内部资料分享',   tags: ['高数', '内部资料'],            content: '历年期末卷与答案整理，需要的同学私我。', day: 0, status: 'pending' },
  { key: 'p97', authorId: 'seed_u08', type: 'learn', category: '数码技能', title: '求刷课代刷网课',         tags: ['刷课', '代做'],                content: '这学期网课太多，有没有靠谱的代刷帮忙。', day: 0, status: 'pending' },
  { key: 'p98', authorId: 'seed_u09', type: 'teach', category: '学业辅导', title: '考研包过冲刺班',         tags: ['考研', '包过'],                content: '签约保过，不过退费，名额有限速来。', day: 1, status: 'pending' },
  { key: 'p99', authorId: 'seed_u11', type: 'learn', category: '数码技能', title: '有偿代做课程设计',       tags: ['代做', '有偿代'],              content: '急！本周课程设计求代做，可付费报酬。', day: 1, status: 'pending' },
  { key: 'p100', authorId: 'seed_u04', type: 'teach', category: '文艺特长', title: '先付定金预约拍摄',      tags: ['摄影', '先付定金'],            content: '档期紧张，需先付定金锁定拍摄时间。', day: 1, status: 'pending' },
];

// 28 条交换。postKey 引用上面 passed 帖（交换只对 passed 帖有效）；applicantId ≠ targetId。
// status 覆盖 pending/active/completed/rejected；completed 带 evaluations（satisfied 表示对搭档满意）。
const EXCHANGES = [
  { postKey: 'p01', applicantId: 'seed_u02', targetId: 'seed_u01', status: 'pending',   message: '想学 Python，可以用英语口语陪你换', day: 1 },
  { postKey: 'p05', applicantId: 'seed_u01', targetId: 'seed_u02', status: 'active',    message: '想练英语口语，时间灵活', day: 2 },
  { postKey: 'p09', applicantId: 'seed_u15', targetId: 'seed_u03', status: 'pending',   message: '考研数学基础弱，求带高数', day: 2 },
  { postKey: 'p13', applicantId: 'seed_u16', targetId: 'seed_u04', status: 'completed', message: '想学人像摄影，可换化妆教学', day: 6,
    completedBy: ['seed_u16', 'seed_u04'],
    evaluations: [{ openid: 'seed_u16', satisfied: true, time: 0 }, { openid: 'seed_u04', satisfied: true, time: 0 }] },
  { postKey: 'p21', applicantId: 'seed_u10', targetId: 'seed_u06', status: 'active',    message: '我想学小程序，可以用 Python 答疑跟你换', day: 3 },
  { postKey: 'p25', applicantId: 'seed_u02', targetId: 'seed_u07', status: 'completed', message: '零基础学吉他，可换英语陪练', day: 7,
    completedBy: ['seed_u02', 'seed_u07'],
    evaluations: [{ openid: 'seed_u02', satisfied: true, time: 0 }, { openid: 'seed_u07', satisfied: false, time: 0 }] },
  { postKey: 'p37', applicantId: 'seed_u03', targetId: 'seed_u10', status: 'pending',   message: '机器学习答疑，约周末线上', day: 3 },
  { postKey: 'p41', applicantId: 'seed_u05', targetId: 'seed_u11', status: 'active',    message: '想学理财规划，可换健身私教课', day: 4 },
  { postKey: 'p49', applicantId: 'seed_u03', targetId: 'seed_u13', status: 'completed', message: '想学日语入门，可换高数辅导', day: 8,
    completedBy: ['seed_u03', 'seed_u13'],
    evaluations: [{ openid: 'seed_u03', satisfied: true, time: 0 }, { openid: 'seed_u13', satisfied: true, time: 0 }] },
  { postKey: 'p53', applicantId: 'seed_u20', targetId: 'seed_u14', status: 'pending',   message: '想学家常菜，物理答疑跟你换', day: 4 },
  { postKey: 'p57', applicantId: 'seed_u19', targetId: 'seed_u15', status: 'active',    message: '想学羽毛球，可教街舞或瑜伽', day: 5 },
  { postKey: 'p61', applicantId: 'seed_u15', targetId: 'seed_u16', status: 'completed', message: '答辩想学会化妆，可陪练网球', day: 9,
    completedBy: ['seed_u15', 'seed_u16'],
    evaluations: [{ openid: 'seed_u15', satisfied: true, time: 0 }, { openid: 'seed_u16', satisfied: true, time: 0 }] },
  { postKey: 'p65', applicantId: 'seed_u02', targetId: 'seed_u17', status: 'pending',   message: '想学视频剪辑，英语陪练可换', day: 5 },
  { postKey: 'p69', applicantId: 'seed_u09', targetId: 'seed_u18', status: 'active',    message: '想学 PPT 设计，可教写作或书法', day: 6 },
  { postKey: 'p73', applicantId: 'seed_u14', targetId: 'seed_u19', status: 'completed', message: '想学街舞，可教烘焙', day: 10,
    completedBy: ['seed_u14', 'seed_u19'],
    evaluations: [{ openid: 'seed_u14', satisfied: true, time: 0 }, { openid: 'seed_u19', satisfied: true, time: 0 }] },
  { postKey: 'p77', applicantId: 'seed_u04', targetId: 'seed_u20', status: 'rejected',  message: '想补大学物理，可教摄影后期', day: 7 },
  { postKey: 'p81', applicantId: 'seed_u07', targetId: 'seed_u21', status: 'active',    message: '想学古筝，钢琴陪练可换', day: 7 },
  { postKey: 'p85', applicantId: 'seed_u09', targetId: 'seed_u22', status: 'pending',   message: '想练公众演讲，可教新媒体写作', day: 7 },
  { postKey: 'p09', applicantId: 'seed_u01', targetId: 'seed_u03', status: 'rejected',  message: '想补高数，可教 Python 编程', day: 8 },
  { postKey: 'p62', applicantId: 'seed_u19', targetId: 'seed_u16', status: 'completed', message: '想学穿搭，可教瑜伽体式', day: 11,
    completedBy: ['seed_u19', 'seed_u16'],
    evaluations: [{ openid: 'seed_u19', satisfied: true, time: 0 }, { openid: 'seed_u16', satisfied: true, time: 0 }] },
  { postKey: 'p13', applicantId: 'seed_u17', targetId: 'seed_u04', status: 'completed', message: '想学摄影构图，可教视频剪辑', day: 12,
    completedBy: ['seed_u17', 'seed_u04'],
    evaluations: [{ openid: 'seed_u17', satisfied: true, time: 0 }, { openid: 'seed_u04', satisfied: false, time: 0 }] },
  { postKey: 'p25', applicantId: 'seed_u05', targetId: 'seed_u07', status: 'rejected',  message: '想学吉他，健身私教可换', day: 9 },
  { postKey: 'p37', applicantId: 'seed_u06', targetId: 'seed_u10', status: 'completed', message: '想学机器学习，可教 Java 后端', day: 13,
    completedBy: ['seed_u06', 'seed_u10'],
    evaluations: [{ openid: 'seed_u06', satisfied: true, time: 0 }, { openid: 'seed_u10', satisfied: true, time: 0 }] },
  { postKey: 'p41', applicantId: 'seed_u22', targetId: 'seed_u11', status: 'active',    message: '想学理财，可教公众演讲', day: 10 },
  { postKey: 'p49', applicantId: 'seed_u17', targetId: 'seed_u13', status: 'completed', message: '想学日语，视频剪辑可换', day: 14,
    completedBy: ['seed_u17', 'seed_u13'],
    evaluations: [{ openid: 'seed_u17', satisfied: true, time: 0 }, { openid: 'seed_u13', satisfied: true, time: 0 }] },
  { postKey: 'p70', applicantId: 'seed_u22', targetId: 'seed_u18', status: 'pending',   message: '想学 Excel，可教主持与演讲', day: 11 },
  { postKey: 'p77', applicantId: 'seed_u21', targetId: 'seed_u20', status: 'active',    message: '想补物理，可教古筝或绘画', day: 12 },
  { postKey: 'p45', applicantId: 'seed_u02', targetId: 'seed_u12', status: 'completed', message: '想了解解剖记忆法，英语陪练可换', day: 15,
    completedBy: ['seed_u02', 'seed_u12'],
    evaluations: [{ openid: 'seed_u02', satisfied: true, time: 0 }, { openid: 'seed_u12', satisfied: true, time: 0 }] },
];

/** 取插入后自增返回的文档 id（兼容不同版本 SDK 的返回结构） */
function extractId(r) {
  if (!r) return null;
  return (r.ids && r.ids[0]) || r._id || r.id || r.insertedId || null;
}

/** 清空一个集合（CloudBase 无 drop，先查后删；上限保护避免死循环） */
async function clearCollection(coll) {
  for (let i = 0; i < 50; i++) {
    const r = await coll.limit(1000).get();
    const ids = (r.data || []).map((d) => d._id).filter(Boolean);
    if (!ids.length) break;
    await Promise.all(ids.map((id) => coll.doc(id).remove()));
  }
}

/**
 * 灌库主函数
 * @param {object} db 云函数数据库对象（lib/db 的 db(name) 工厂）
 * @param {object} COLLECTIONS 集合名映射
 * @param {object} opts { reset } reset=true 先清空三集合再写入
 * @returns {Promise<{users:number, posts:number, exchanges:number, postIdMap:object}>}
 */
async function runSeed(db, COLLECTIONS, opts = {}) {
  const reset = opts.reset === true;
  const base = Date.now();
  const ts = (day, min = 0) => base - day * 86400000 - min * 60000;

  if (reset) {
    await clearCollection(db(COLLECTIONS.USERS));
    await clearCollection(db(COLLECTIONS.POSTS));
    await clearCollection(db(COLLECTIONS.EXCHANGES));
  }

  // 1) 用户
  for (const u of USERS) {
    const doc = {
      _openid: u.openid,
      role: 'user',
      nickname: u.nickname,
      avatarColor: AVATAR_COLORS[USERS.indexOf(u) % AVATAR_COLORS.length],
      studentId: u.studentId,
      realName: u.realName,
      grade: u.grade,
      major: u.major,
      tags: u.tags,
      contact: u.contact,
      status: u.status,
      goodCount: u.goodCount,
      totalCount: u.totalCount,
      createTime: ts(u.day),
      updateTime: ts(u.day),
    };
    await db(COLLECTIONS.USERS).add(doc);
  }

  // 2) 帖子（记录 key -> 真实 _id，供交换引用）
  const postIdMap = {};
  for (const p of POSTS) {
    const author = USERS.find((x) => x.openid === p.authorId);
    const doc = {
      title: p.title,
      type: p.type,
      category: p.category,
      content: p.content,
      tags: p.tags,
      authorId: p.authorId,
      authorName: author ? author.nickname : '',
      authorAvatar: author ? AVATAR_COLORS[USERS.indexOf(author) % AVATAR_COLORS.length] : '',
      status: p.status || 'passed',
      rejectReason: p.rejectReason || '',
      createTime: ts(p.day),
      updateTime: ts(p.day),
    };
    if (doc.status !== 'passed') {
      doc.reviewTime = ts(p.day);
      doc.reviewer = 'seed';
    }
    const r = await db(COLLECTIONS.POSTS).add(doc);
    postIdMap[p.key] = extractId(r) || p.key;
  }

  // 3) 交换
  for (const e of EXCHANGES) {
    const post = POSTS.find((x) => x.key === e.postKey);
    const applicant = USERS.find((x) => x.openid === e.applicantId);
    const doc = {
      postId: postIdMap[e.postKey],
      postTitle: post ? post.title : '',
      applicantId: e.applicantId,
      applicantName: applicant ? applicant.nickname : '',
      targetId: e.targetId,
      message: e.message || '',
      status: e.status,
      completedBy: e.completedBy || [],
      evaluations: (e.evaluations || []).map((ev) => ({ ...ev, time: ev.time || ts(e.day) })),
      createTime: ts(e.day),
      updateTime: ts(e.day),
    };
    await db(COLLECTIONS.EXCHANGES).add(doc);
  }

  return {
    users: USERS.length,
    posts: POSTS.length,
    exchanges: EXCHANGES.length,
    postIdMap,
  };
}

module.exports = { USERS, POSTS, EXCHANGES, runSeed };
