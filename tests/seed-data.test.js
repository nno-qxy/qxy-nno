/**
 * 测试数据基底校验（本地逻辑单测，无需联网/云资源）
 * 校验 runSeed 的计数与引用完整性：150 条总量、各状态分布、交换引用一致、teach/learn 成对。
 * 运行：node tests/seed-data.test.js
 */

const assert = require('assert');
const path = require('path');
const { runSeed, USERS, POSTS, EXCHANGES } = require('../cloudbase/functions/skillswap-api/lib/seed-data');

const COLLECTIONS = { USERS: 'users', POSTS: 'posts', EXCHANGES: 'exchanges', CONFIGS: 'configs' };

/** 内存版 mock 数据库：db(name) 返回带 add / limit().get() / doc().remove() 的集合 */
function makeMockDb() {
  const store = { users: [], posts: [], exchanges: [], configs: [] };
  let seq = 0;
  function coll(name) {
    const arr = store[name];
    return {
      add(doc) {
        const id = name + '_' + ++seq;
        arr.push(Object.assign({ _id: id }, doc));
        return { _id: id, ids: [id] };
      },
      limit(n) {
        return {
          async get() {
            return { data: arr.slice(0, n).map((d) => Object.assign({}, d)) };
          },
        };
      },
      doc(id) {
        return {
          async remove() {
            const idx = arr.findIndex((d) => d._id === id);
            if (idx >= 0) {
              arr.splice(idx, 1);
              return { removed: 1 };
            }
            return { removed: 0 };
          },
        };
      },
      where(q) {
        return {
          limit() {
            return {
              async remove() {
                if (Object.keys(q || {}).length === 0) {
                  const removed = arr.length;
                  arr.length = 0;
                  return { removed };
                }
                return { removed: 0 };
              },
            };
          },
        };
      },
    };
  }
  return { db: coll, store };
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log('  ✓', name);
}

(async () => {
  console.log('运行 seed-data 校验…');

  await step('总量 150 条（22 用户 + 100 帖 + 28 交换）', () => {
    assert.strictEqual(USERS.length, 22, '用户应为 22');
    assert.strictEqual(POSTS.length, 100, '帖子应为 100');
    assert.strictEqual(EXCHANGES.length, 28, '交换应为 28');
    assert.strictEqual(USERS.length + POSTS.length + EXCHANGES.length, 150, '合计应为 150');
  });

  await step('帖子状态分布正确（passed88/pending5/rejected4/offline3）', () => {
    const cnt = (s) => POSTS.filter((p) => (p.status || 'passed') === s).length;
    assert.strictEqual(cnt('passed'), 88);
    assert.strictEqual(cnt('pending'), 5);
    assert.strictEqual(cnt('rejected'), 4);
    assert.strictEqual(cnt('offline'), 3);
  });

  await step('交换状态分布正确（pending7/active8/completed10/rejected3）', () => {
    const cnt = (s) => EXCHANGES.filter((e) => e.status === s).length;
    assert.strictEqual(cnt('pending'), 7);
    assert.strictEqual(cnt('active'), 8);
    assert.strictEqual(cnt('completed'), 10);
    assert.strictEqual(cnt('rejected'), 3);
  });

  await step('字段约束合法（标题≥4、正文≥10、标签≤8且单个≤12、分类合法、type 合法）', () => {
    const CATS = ['学业辅导', '语言交流', '文艺特长', '体育健身', '数码技能', '生活服务'];
    POSTS.forEach((p) => {
      assert.ok(p.title.length >= 4, '标题过短: ' + p.key);
      assert.ok(p.content.length >= 10, '正文过短: ' + p.key);
      assert.ok(p.tags.length <= 8, '标签过多: ' + p.key);
      assert.ok(p.tags.every((t) => t.length <= 12), '单个标签过长: ' + p.key);
      assert.ok(CATS.includes(p.category), '分类非法: ' + p.key);
      assert.ok(['teach', 'learn'].includes(p.type), 'type 非法: ' + p.key);
    });
    EXCHANGES.forEach((e) => {
      assert.ok(['pending', 'active', 'completed', 'rejected'].includes(e.status), '交换状态非法');
    });
  });

  await step('帖子 key 唯一（交换引用映射的前提）', () => {
    const keys = new Set(POSTS.map((p) => p.key));
    assert.strictEqual(keys.size, POSTS.length, '帖子 key 应唯一');
  });

  const mock = makeMockDb();
  const summary = await runSeed(mock.db, COLLECTIONS, { reset: false });

  await step('runSeed 返回计数与定义一致', () => {
    assert.strictEqual(summary.users, 22);
    assert.strictEqual(summary.posts, 100);
    assert.strictEqual(summary.exchanges, 28);
  });

  const userOpenids = new Set(mock.store.users.map((u) => u._openid));
  await step('用户 openid 唯一且含 1 个 banned', () => {
    assert.strictEqual(userOpenids.size, 22, 'openid 应唯一');
    assert.strictEqual(mock.store.users.filter((u) => u.status === 'banned').length, 1);
  });

  await step('帖子 authorId 均引用已存在用户；passed 帖标签互有重叠（Z-07 可用）', () => {
    const passedTags = {};
    mock.store.posts.forEach((p) => {
      assert.ok(userOpenids.has(p.authorId), '帖子作者不存在: ' + p.authorId);
      if (p.status === 'passed') (passedTags[p._id] = p.tags);
    });
    // 至少存在一对 passed 帖共享标签
    const keys = Object.keys(passedTags);
    let overlapFound = false;
    for (let i = 0; i < keys.length && !overlapFound; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        if (passedTags[keys[i]].some((t) => passedTags[keys[j]].includes(t))) { overlapFound = true; break; }
      }
    }
    assert.ok(overlapFound, 'passed 帖之间应存在标签重叠以支持相关推荐');
  });

  await step('热门标签下 teach/learn 成对（互补推荐可命中）', () => {
    const byTag = (tag) => {
      const hits = POSTS.filter((p) => (p.status || 'passed') === 'passed' && (p.tags || []).includes(tag));
      return { teach: hits.some((p) => p.type === 'teach'), learn: hits.some((p) => p.type === 'learn') };
    };
    ['Python', '高数', '英语', '吉他', '摄影', '理财', '小程序', '钢琴', '日语', 'Excel'].forEach((tag) => {
      const r = byTag(tag);
      assert.ok(r.teach, '标签「' + tag + '」应至少有一条 teach 帖');
      assert.ok(r.learn, '标签「' + tag + '」应至少有一条 learn 帖（否则互补推荐命中不到）');
    });
  });

  await step('交换只引用 passed 帖（审核中/已驳回/已下架不可交换）', () => {
    const passedKeys = new Set(
      POSTS.filter((p) => (p.status || 'passed') === 'passed').map((p) => p.key)
    );
    EXCHANGES.forEach((e, i) => {
      assert.ok(passedKeys.has(e.postKey), '第 ' + (i + 1) + ' 条交换引用了非 passed 帖: ' + e.postKey);
    });
  });

  await step('交换引用一致：postId 真实存在、applicant≠target、均引用已存在用户', () => {
    const postIds = new Set(mock.store.posts.map((p) => p._id));
    mock.store.exchanges.forEach((e) => {
      assert.ok(postIds.has(e.postId), '交换引用的帖子不存在');
      assert.ok(userOpenids.has(e.applicantId), '申请人不存在');
      assert.ok(userOpenids.has(e.targetId), '帖主不存在');
      assert.notStrictEqual(e.applicantId, e.targetId, '不能与自己交换');
    });
  });

  await step('completed 交换均带 2 条互评且 completedBy 长度为 2', () => {
    mock.store.exchanges
      .filter((e) => e.status === 'completed')
      .forEach((e) => {
        assert.strictEqual(e.evaluations.length, 2, '互评应为 2 条');
        assert.strictEqual(e.completedBy.length, 2, 'completedBy 应为 2');
      });
  });

  await step('reset=true 先清空后写入，最终仍为 150 条且无重复', async () => {
    const mock2 = makeMockDb();
    await runSeed(mock2.db, COLLECTIONS, { reset: false });
    await runSeed(mock2.db, COLLECTIONS, { reset: false });
    // 不 reset 两次 → 翻倍（验证 reset 前会累加）
    assert.strictEqual(mock2.store.users.length, 44, '未 reset 两次应累加');
    const mock3 = makeMockDb();
    await runSeed(mock3.db, COLLECTIONS, { reset: true });
    await runSeed(mock3.db, COLLECTIONS, { reset: true });
    assert.strictEqual(mock3.store.users.length, 22, 'reset 后不应累加');
    assert.strictEqual(mock3.store.posts.length, 100);
    assert.strictEqual(mock3.store.exchanges.length, 28);
  });

  console.log(`\n✅ 全部 ${passed} 项校验通过，测试数据基底可用（150 条）。`);
})().catch((e) => {
  console.error('\n❌ 校验失败：', e.message);
  process.exit(1);
});
