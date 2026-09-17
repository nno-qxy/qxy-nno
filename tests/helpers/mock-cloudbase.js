/**
 * CloudBase 云函数测试沙箱（供各阶段测试复用）
 *
 * 提供：
 * - 内存文档型数据库（users/posts/exchanges/configs），带 orderBy / field 投影 / limit
 * - mock 微信 code2Session
 * - mock 腾讯云 TMS 文本安全（可配置返回结论，默认为「未启用」走降级路径）
 * - 自动注入测试用环境变量
 *
 * 关键设计：mock 要尽量贴近真 MongoDB 行为，否则真 bug 会蒙混过关。
 * 已内置两条真实约束：
 *   1. 字段投影不能 true/false 混用（曾导致线上 500）
 *   2. where() 会重置上一次查询的 field/order/limit（db.js 缓存了 collection 对象）
 */

const Module = require('module');

const COLLECTIONS = ['users', 'posts', 'exchanges', 'configs'];

function matchOne(d, k, cond) {
  // 正则匹配：db.RegExp({regexp, options}) 的 mock 形态
  if (cond && cond.__regex) {
    try {
      const re = new RegExp(cond.__regex, (cond.__options || '').includes('i') ? 'i' : '');
      return re.test(String(d[k] == null ? '' : d[k]));
    } catch (_) {
      return false;
    }
  }
  // db.command 生成的算子对象：{ __op: '$in', v: [...] }
  if (cond && cond.__op) {
    const v = d[k];
    switch (cond.__op) {
      case '$eq': return v === cond.v;
      case '$ne': return v !== cond.v;
      // $in 对数组字段是「有交集」（tags: {$in: [...]} 命中 tags 含其一的文档），对标量字段是「属于」
      case '$in': {
        const list = Array.isArray(cond.v) ? cond.v : [cond.v];
        return Array.isArray(v) ? v.some((x) => list.indexOf(x) >= 0) : list.indexOf(v) >= 0;
      }
      case '$nin': {
        const list = Array.isArray(cond.v) ? cond.v : [cond.v];
        return Array.isArray(v) ? !v.some((x) => list.indexOf(x) >= 0) : list.indexOf(v) < 0;
      }
      case '$gt': return v > cond.v;
      case '$gte': return v >= cond.v;
      case '$lt': return v < cond.v;
      case '$lte': return v <= cond.v;
      case '$exists': return cond.v ? v !== undefined : v === undefined;
      default: return false;
    }
  }
  // 支持 { $lt: n } 等比较符（游标分页要用）
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.keys(cond).every((op) => {
      if (op === '$lt') return d[k] < cond[op];
      if (op === '$lte') return d[k] <= cond[op];
      if (op === '$gt') return d[k] > cond[op];
      if (op === '$gte') return d[k] >= cond[op];
      if (op === '$ne') return d[k] !== cond[op];
      if (op === '$in') {
        const list = Array.isArray(cond[op]) ? cond[op] : [cond[op]];
        return Array.isArray(d[k]) ? d[k].some((x) => list.indexOf(x) >= 0) : list.indexOf(d[k]) >= 0;
      }
      return d[k] === cond[op];
    });
  }
  return d[k] === cond;
}

function matchFilter(f) {
  const filter = f || {};
  const ors = filter.$or;
  const rest = Object.keys(filter).filter((k) => k !== '$or');
  const restOk = (d) => rest.every((k) => matchOne(d, k, filter[k]));
  // 顶层 $or：与其它条件之间是 AND（真 MongoDB 语义），不能只判 $or
  if (ors) {
    return (d) =>
      restOk(d) && ors.some((sub) => Object.keys(sub).every((k) => matchOne(d, k, sub[k])));
  }
  return (d) => Object.keys(filter).every((k) => matchOne(d, k, filter[k]));
}

/**
 * @param {object} opt
 *   tms: null | { suggestion, label, score }  为 null 时不注入 TMS 密钥（走降级）
 * @returns {{ stores, reset, setTms }}
 */
function install(opt = {}) {
  const stores = {};
  COLLECTIONS.forEach((c) => { stores[c] = []; });
  let seq = 0;

  function makeCollection(name) {
    const store = stores[name];
    const chain = { store, name, filter: {}, order: null, limitN: Infinity, fields: null };
    const api = {
      where(f) {
        chain.filter = f || {};
        chain.fields = null;
        chain.order = null;
        chain.limitN = Infinity;
        return api;
      },
      limit(n) { chain.limitN = n; return api; },
      orderBy(k, dir) { chain.order = `${k}_${dir || 'asc'}`; return api; },
      field(f) {
        chain.fields = f;
        const bools = Object.values(f || {}).filter((v) => typeof v === 'boolean');
        if (bools.some((v) => v === true) && bools.some((v) => v === false)) {
          throw new Error('Projection cannot have a mix of inclusion and exclusion');
        }
        return api;
      },
      skip() { return api; },
      async get() {
        let arr = store.filter(matchFilter(chain.filter));
        if (chain.order) {
          const [k, dir] = chain.order.split('_');
          arr = arr.slice().sort((a, b) => {
            if (a[k] === b[k]) return 0;
            return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
          });
        }
        if (chain.limitN !== Infinity) arr = arr.slice(0, chain.limitN);
        let out = arr.map((d) => JSON.parse(JSON.stringify(d)));
        if (chain.fields) {
          const allFalse = Object.values(chain.fields).every((v) => v === false);
          out = out.map((d) => {
            const o = {};
            Object.keys(d).forEach((k) => {
              // 全 false = 排除模式；否则 = 包含模式
              const keep = allFalse ? !chain.fields[k] : !!chain.fields[k];
              if (keep) o[k] = d[k];
            });
            return o;
          });
        }
        return { data: out };
      },
      async add(doc) {
        const d = Object.assign({ _id: 'id_' + ++seq }, doc);
        store.push(d);
        // 兼容多版本 SDK 的返回形态
        return { _id: d._id, id: d._id, ids: [d._id], insertedId: d._id };
      },
      async update(patch) {
        let n = 0;
        store.forEach((d) => {
          if (matchFilter(chain.filter)(d)) {
            Object.assign(d, JSON.parse(JSON.stringify(patch)));
            n++;
          }
        });
        return { stats: { updated: n } };
      },
      async remove() {
        const before = store.length;
        for (let i = store.length - 1; i >= 0; i--) {
          if (matchFilter(chain.filter)(store[i])) store.splice(i, 1);
        }
        return { stats: { removed: before - store.length } };
      },
      async count() {
        return { total: store.filter(matchFilter(chain.filter)).length };
      },
      doc(id) {
        // 仅支持 doc(id).update()/remove()，生产代码主要用 where().update()
        return {
          async update(patch) {
            const d = store.find((x) => x._id === id);
            if (d) Object.assign(d, JSON.parse(JSON.stringify(patch)));
            return { stats: { updated: d ? 1 : 0 } };
          },
          async remove() {
            const i = store.findIndex((x) => x._id === id);
            if (i >= 0) store.splice(i, 1);
            return { stats: { removed: i >= 0 ? 1 : 0 } };
          },
          async get() {
            const d = store.find((x) => x._id === id);
            return { data: d ? [JSON.parse(JSON.stringify(d))] : [] };
          },
        };
      },
    };
    return api;
  }

  // db.command 算子：生产代码里 cmd().in() / cmd().neq() 很常用，
  // 早期这里是空对象 {}，导致 cmd().xxx() === undefined —— 查询条件被静默降级成「字段等于 undefined」，
  // 相关推荐（related 用 tags: cmd().in([...])）在沙箱里其实一直返回空列表，等于没被测到。
  const OP = (op) => (v) => ({ __op: op, v });
  const command = {
    eq: OP('$eq'),
    neq: OP('$ne'),
    in: OP('$in'),
    nin: OP('$nin'),
    gt: OP('$gt'),
    gte: OP('$gte'),
    lt: OP('$lt'),
    lte: OP('$lte'),
    exists: OP('$exists'),
    and: (...args) => ({ __op: '$and', v: args }),
    or: (...args) => ({ __op: '$or', v: args }),
  };

  const mockSdk = {
    SYMBOL_CURRENT_ENV: 'mock-env',
    init() {
      return {
        database: () => ({
          collection: makeCollection,
          command,
          RegExp: (o) => ({ __regex: o.regexp, __options: o.options || '' }),
        }),
      };
    },
  };

  // TMS 返回：默认 undefined = 不注入密钥（走降级）
  let tmsResp = opt.tms || null;

  const mockHttps = {
    get(url, opts, cb) {
      const u = String(url);
      if (u.includes('jscode2session')) {
        const code = (u.match(/js_code=([^&]+)/) || [])[1];
        const body =
          code === 'BAD_CODE'
            ? JSON.stringify({ errcode: 40029, errmsg: 'invalid code' })
            : JSON.stringify({ openid: 'openid_from_' + code, session_key: 'sk' });
        process.nextTick(() => cb(fakeRes(body)));
        return { on() {}, destroy() {}, setTimeout() {} };
      }
      throw new Error('未预期的 https.get: ' + u);
    },
    request(opts, cb) {
      // TMS 文本审核
      return {
        on() { return this; },
        write() {},
        end() {
          const payload = tmsResp || { Suggestion: 'Pass', Label: 'Normal', Score: 0 };
          const body = JSON.stringify({ Response: payload });
          process.nextTick(() => {
            if (cb) cb(fakeResFull(body));
          });
        },
        destroy() {},
      };
    },
  };

  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === '@cloudbase/node-sdk') return mockSdk;
    if (request === 'https') return mockHttps;
    return origLoad.apply(this, arguments);
  };

  // 环境变量：必须在 require 业务代码之前设置
  process.env.WX_APPID = opt.wxAppId || 'wx_test_appid';
  process.env.WX_SECRET = opt.wxSecret || 'wx_test_secret';
  process.env.TOKEN_SECRET = opt.tokenSecret || 'test_token_secret';
  process.env.ADMIN_USER = opt.adminUser || 'admin';
  process.env.ADMIN_PASS_HASH = opt.adminPassHash || '';
  if (tmsResp) {
    process.env.TMS_SECRET_ID = 'test_tms_id';
    process.env.TMS_SECRET_KEY = 'test_tms_key';
  } else {
    delete process.env.TMS_SECRET_ID;
    delete process.env.TMS_SECRET_KEY;
  }
  // 测试沙盒：允许对自己的帖发起交换（单账号验收用）
  if (opt.sandbox) {
    process.env.SANDBOX_MODE = 'true';
  } else {
    delete process.env.SANDBOX_MODE;
  }

  return {
    stores,
    /** 清空所有集合，测试间隔离 */
    reset() {
      COLLECTIONS.forEach((c) => { stores[c].length = 0; });
      seq = 0;
    },
    /** 运行时切换 TMS 返回（用于测试 Block / Review 分支） */
    setTms(resp) { tmsResp = resp; },
  };
}

function fakeRes(body) {
  return {
    on(ev, fn) {
      if (ev === 'data') fn(body);
      if (ev === 'end') fn();
    },
  };
}

function fakeResFull(body) {
  return {
    on(ev, fn) {
      if (ev === 'data') fn(body);
      if (ev === 'end') fn();
    },
  };
}

module.exports = { install };