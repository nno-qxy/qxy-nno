/**
 * 交换占用状态（发起申请 / 帖主确认 / 开始协作 多处共用）
 *
 * 产品规则（2026-09-14 修订 + 2026-09-15 补「同一对用户」维度）：
 *   1. 「待开始(active)」不占用任何东西：
 *      - 其他同学随时可以发起申请（帖子始终开放）
 *      - 帖主也随时可以把新的申请确认成「待开始」
 *   2. 只有「进行中(started)」才占用，且占用分两层：
 *      a) 帖子维度（`of` / `busyPostMap`）：同一帖子同时只能有一摊进行中的交换
 *         - 帖主不能把新的申请确认成「待开始」
 *         - 同帖其它「待开始」的交换也不能进入开始流程
 *      b) 用户对维度（`pairBusy` / `busyPairMap`）：同一对用户之间同时只能有一摊进行中的交换
 *         - 甲和乙已经在进行一摊交换时，甲不能再确认 / 开始「乙对甲另一条帖」的申请，
 *           反之亦然（同一对人不能同时在两个课程上并行）
 *         - 只约束「同一对」，甲与丙、乙与丁之间的交换不受影响
 *   3. 进行中的交换完成（completed）或被取消（cancelled）后，两个维度都自然释放
 *
 *   注意：pairKey 对 a===b 返回空串 —— 沙盒单账号「自交换」(applicantId===targetId)
 *   不参与用户对约束，否则一个测试号没法同时验两条自交换。
 *
 * 占用状态由 exchanges 实时推导，不往 posts 上写冗余字段，避免两边不同步。
 */

const { db, cmd, COLLECTIONS } = require('./db');

const BUSY_STATUS = 'started'; // 双方已开始 → 该帖/该对用户暂时不能再开新的一摊
/** 批量查询占用时，最多扫多少条进行中的交换 */
const SCAN_LIMIT = 200;

const EMPTY = { hasStarted: false, busy: false };

/**
 * 单帖占用状态
 * @param {string} postId
 * @returns {Promise<{hasStarted:boolean,busy:boolean}>}
 */
async function of(postId) {
  if (!postId) return Object.assign({}, EMPTY);
  let n = 0;
  try {
    const r = await db(COLLECTIONS.EXCHANGES).where({ postId, status: BUSY_STATUS }).count();
    n = (r && r.total) || 0;
  } catch (_) {
    // 查询异常时不锁帖，交由其它校验兜底，避免误伤正常流程
    return Object.assign({}, EMPTY);
  }
  return { hasStarted: n > 0, busy: n > 0 };
}

/**
 * 批量占用状态：返回「存在进行中交换的 postId」字典
 * 列表页每行都调 of() 会 N+1，这里一次查询后在内存分组。
 * @returns {Promise<Object<string, boolean>>}
 */
async function busyPostMap() {
  const map = Object.create(null);
  try {
    const r = await db(COLLECTIONS.EXCHANGES)
      .where({ status: BUSY_STATUS })
      .limit(SCAN_LIMIT)
      .get();
    (r.data || []).forEach((e) => {
      if (e && e.postId) map[e.postId] = true;
    });
  } catch (_) { /* 异常时视为无占用 */ }
  return map;
}

/**
 * 用户对身份键：顺序无关（甲→乙 与 乙→甲 是同一对）。
 * 两侧任一为空、或两侧是同一个人（沙盒自交换）时返回空串 = 不参与该约束。
 */
function pairKey(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y || x === y) return '';
  return x < y ? x + '||' + y : y + '||' + x;
}

/**
 * 同一对用户之间是否已有「进行中(started)」的交换
 * @param {string} a 用户 openid
 * @param {string} b 另一用户 openid
 * @returns {Promise<boolean>}
 */
async function pairBusy(a, b) {
  const key = pairKey(a, b);
  if (!key) return false;
  try {
    const r = await db(COLLECTIONS.EXCHANGES)
      .where({
        status: BUSY_STATUS,
        applicantId: cmd().in([a, b]),
        targetId: cmd().in([a, b]),
      })
      .limit(20)
      .get();
    // in 查询会带上 (a,a)/(b,b) 这类组合，这里用 pairKey 再精确比对一次
    return (r.data || []).some((e) => pairKey(e.applicantId, e.targetId) === key);
  } catch (_) {
    return false;
  }
}

/**
 * 批量：返回「该对人之间存在进行中交换」的键字典（pairKey → true）
 * @returns {Promise<Object<string, boolean>>}
 */
async function busyPairMap() {
  const map = Object.create(null);
  try {
    const r = await db(COLLECTIONS.EXCHANGES)
      .where({ status: BUSY_STATUS })
      .limit(SCAN_LIMIT)
      .get();
    (r.data || []).forEach((e) => {
      const k = pairKey(e.applicantId, e.targetId);
      if (k) map[k] = true;
    });
  } catch (_) { /* 异常时视为无占用 */ }
  return map;
}

module.exports = { of, busyPostMap, pairBusy, busyPairMap, pairKey, BUSY_STATUS };
