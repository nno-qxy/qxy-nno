# 数据库集合、索引与安全规则

> 数据库类型：CloudBase **文档型**数据库
> 环境 ID：`nno-d2gspwvpl6c3c9f46`（地域 ap-shanghai）
> 阶段 0 需在控制台建立以下 4 个集合并配置安全规则与索引。

## 1. 安全规则（必做，四个集合统一）

```json
{ "read": false, "write": false }
```

含义：端侧（小程序 / Web）完全禁止直连读写，所有数据访问只能在云函数内完成。
这是「前端不直连数据库」原则的强制保障——即便端侧拿到环境 ID 也读不到任何数据。

## 2. 索引

| 集合 | 索引 | 类型 | 说明 |
|---|---|---|---|
| users | `_openid` | 唯一 | 身份主键，登录与查询 |
| users | `studentId` | 普通 | 管理端按学号搜索（G-06） |
| posts | `status + createTime` | 联合，createTime 降序 | 广场与待审列表分页（Z-03、G-02） |
| posts | `authorId + createTime` | 联合，createTime 降序 | 我的发布（Z-12） |
| exchanges | `applicantId + createTime` | 联合，createTime 降序 | 我发起的交换（Z-10） |
| exchanges | `targetId + status` | 联合 | 收到的申请（Z-09） |
| exchanges | `postId + applicantId + status` | 普通（**切勿设为唯一**） | 「同一人对同一帖未结束申请」去重查询（Z-08），见下方警示 |

> 控制台入口：数据库 → 对应集合 → 索引管理 → 添加索引。
> 联合索引字段顺序按上表从左到右，降序字段勾选「降序」。

### ⚠️ exchanges 的 `postId + applicantId (+ status)` 必须是普通索引，不能是唯一索引

**2026-09-14 线上缺陷修复**：该索引最初建成了唯一索引（`postId_applicantId_unique`），
导致**交换完成后再申请同一帖时直接抛 `E11000 duplicate key`**，前端整屏弹出数据库原始报错。

原因：业务允许同一对 (postId, applicantId) 存在**多条历史记录**——
`completed`（做完想再做一次）/ `cancelled` / `rejected` 之后都必须能再次申请同一帖，
"同时只能有一笔"这条规则只针对 `pending / active / started`，是**业务层约束，不是数据库唯一约束**。

去重判断必须把状态下推到查询里（不能用 `limit(1)` 取一条再在内存里判状态，
那样可能取到已结束的旧记录而误放行）：

```js
// routes/exchanges.js · create()
.where({ postId, applicantId: auth.openid, status: cmd().in(['pending', 'active', 'started']) })
```

现状（2026-09-14 已按此调整）：
- 已删除 `postId_applicantId_unique`（唯一索引）
- 已新建 `postId_applicantId_status`（普通，方向 1/1/1），正好覆盖上面的去重查询
- 后端另有一层兜底：插入真被历史遗留的唯一索引拦下时，把 `E11000` 转成可读的 409，不透出原始报错

排查口径：控制台 → exchanges → 索引管理，确认该索引 `Unique` 为 `false`。
另：`users._openid` 的唯一索引与本问题无关，保持唯一。

## 3. 集合与字段定义

详见同目录 `collections.json`（可直接作为交付物中的「数据库结构说明」）。

- `users`：15 字段，含 `_openid`（主键）、学号姓名年级专业、标签、联系方式、封禁状态、好评统计
- `posts`：14 字段，含类型（teach/learn）、分类、正文、标签、审核状态与驳回原因
- `exchanges`：12 字段，含双方 openid、状态、开始记录 `startBy`/`startTime`、改约留言 `cancelNotes`、完成记录 `completedBy`、互评 `evaluations`
- `configs`：配置型数据，目前用于管理员登录失败计数与锁定（G-01）

## 4. 状态机

- `posts.status`：`pending → passed / rejected`；封禁时 `passed → offline`；驳回重提 `rejected → pending`
- `exchanges.status`：
  - 主线：`pending`（申请中）→ `active`（帖主已接受、待开始）→ `started`（双方都点了开始）→ `completed`
  - 拒绝：`pending → rejected`
  - 「临时有事 / 再约时间」不改变状态，只清空 `startBy` 并把留言追加到 `cancelNotes`，回到 `active` 可再次发起开始
- 交换占用（由 `exchanges` 实时推导，不冗余到 `posts`，见 `functions/skillswap-api/lib/exchangeState.js`）：
  - **`active`（已接受、待开始）不占用任何东西**：其他人随时可发起申请，帖主随时可 `confirm` 新申请
  - **帖子维度**（`of` / `busyPostMap`，2026-09-14 修订）：存在 `started` 交换 → `busy=true`：
    帖主不能 `confirm` 新申请，同帖其它 `active` 也不能 `start`（同帖同时只有一摊进行中）
  - **用户对维度**（`pairBusy` / `busyPairMap`，2026-09-15 新增）：
    同一对用户（`pairKey(a,b)` 顺序无关）之间同时只允许一摊 `started`；
    `confirm` / `start` 命中即 409。`applicantId === targetId`（沙盒自交换）不参与该约束。
  - 接口下发：详情 `post.exchangeState.busy`；交换列表每行 `postBusy`（帖子维度）与 `peerBusy`（用户对维度），
    前端据此置灰按钮并说明原因
- 待评价 / 已结束：**不新增枚举值**，由 `evaluations` 是否齐全在界面层判定
- `users.status`：`active / banned`
