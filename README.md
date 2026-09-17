# 校园技能交换与知识共享平台

一个面向高校学生的技能互助平台：**把「我会什么」和「我想学什么」变成可检索、可撮合、可评价的闭环**。

平台由**微信小程序用户端**（学生发起与参与技能交换）和 **Web 管理端**（内容审核与用户治理）两部分组成，后端统一收敛到腾讯云开发 CloudBase 上的**单个业务云函数**，不依赖任何自建服务器。

![平台](https://img.shields.io/badge/客户端-微信小程序%20%2B%20Web-2B62E0)
![后端](https://img.shields.io/badge/后端-CloudBase%20云函数-0052D9)
![依赖](https://img.shields.io/badge/运行时依赖-仅%201%20个-4CB782)
![测试](https://img.shields.io/badge/测试-379%20项通过-brightgreen)

---

## 目录

- [背景与目标](#背景与目标)
- [功能概览](#功能概览)
- [系统架构](#系统架构)
- [技术选型](#技术选型)
- [目录结构](#目录结构)
- [接口一览](#接口一览)
- [数据模型](#数据模型)
- [交换状态机](#交换状态机)
- [评价体系](#评价体系)
- [快速开始](#快速开始)
- [测试](#测试)
- [几处值得说明的设计](#几处值得说明的设计)
- [已知限制](#已知限制)

---

## 背景与目标

校园里技能供需信息长期散落在社团群、朋友圈和公告栏：**有技能的人不知道谁想学，想学的人找不到谁能教**。同时双方对彼此的可靠程度缺乏判断依据，一次「约了又黄」的合作几乎不会留下任何痕迹。

本项目把这件事收进一个结构化流程：

1. **发帖**——声明自己能教什么或想学什么，附分类与技能标签；
2. **撮合**——按分类、标签、关键词检索，相关推荐按标签重合度排序；
3. **成约**——申请、确认、双方各自确认开始，任一阶段都可取消并留下原因；
4. **评价**——交换完成后双方互评，学员的满意度计入对方好评率。

## 功能概览

### 小程序用户端（10 个页面 / 3 个公共组件）

| 模块 | 说明 |
|---|---|
| 技能广场 | 分类 Tab（6 类）、意图筛选（我能教 / 我想学）、标签与关键词搜索、游标分页加载 |
| 发布技能帖 | 标题、正文、分类、标签（最多 8 个），提交后进入内容安全校验 |
| 帖子详情 | 作者信息、联系方式（成约后可见）、评价列表与好评率、相关推荐、发起交换 |
| 我的发布 | 分类查看各状态帖子，被驳回的帖可修改后重新提交 |
| 我的交换 | 两个页签分别承载「我发起的」与「我收到的」，按状态推进 |
| 用户公开页 | 从帖子作者头像进入，展示脱敏资料、发布过的帖、收到的评价 |
| 资料维护 | 昵称、学号、真实姓名、年级、专业、技能标签、联系方式 |
| 隐私与安全 | 交换安全提醒与联系方式披露规则说明 |

### Web 管理端（Vue 3 单页应用）

| 模块 | 说明 |
|---|---|
| 管理员登录 | 账号 + 口令，口令以 PBKDF2-SHA256 哈希存储，连续输错 5 次锁定 30 分钟 |
| 数据看板 | 用户总数、封禁数、待审/已上广场/驳回/下架帖子数、进行中与申请中交换数、发布趋势、状态分布、热门标签 |
| 内容审核 | 待审列表与已审记录，可触发 AI 预审、通过或驳回 |
| 所有帖子 | 按状态、分类、类型、关键词筛选，可下架与恢复 |
| 用户管理 | 按学号/昵称搜索，查看用户详情与其发布、交换记录，封禁/解封（连带其帖子下架与恢复） |

## 系统架构

```
        微信小程序用户端                        Web 管理端
        （原生 WXML / WXSS / JS）              （Vue 3 + Vite）
                 │                                   │
                 └───────────────┬───────────────────┘
                                 │  HTTPS + JSON
                                 ▼
                  CloudBase HTTP 访问服务 · 网关路由
                  /skillswap-api          /skillswap-web
                                 │
                                 ▼
                    云函数 skillswap-api（36 个接口）
             请求解析 → 身份识别 → 路由分发 → 业务处理 → 响应封装
                                 │
                                 ▼
              CloudBase 文档数据库（4 个集合，端侧读写全禁用）
                                 │
                                 ▼
        外部服务：微信开放接口 · 腾讯云文本内容安全
                  （均为可选，未配置或调用异常时自动降级）
```

客户端到后端只有一条链路：**所有业务数据都经过云函数**。数据库四个集合统一配置 `{ "read": false, "write": false }`，端侧即使拿到环境 ID 也无法直连读写，鉴权与权限判断只存在于服务端。

## 技术选型

| 层次 | 选型 | 理由 |
|---|---|---|
| 小程序端 | 微信原生框架 | 调试链路最短，不引入构建工具；页面数量与交互复杂度未到需要跨端框架的程度 |
| 管理端 | Vue 3 + Vite + vue-router | 构建产物合计约 136 KB（gzip 后约 49 KB），主包不足 100 KB；不使用 UI 组件库，样式按设计令牌手写，与小程序端保持同一套视觉语言 |
| 后端 | CloudBase 云函数（Node.js 18） | 免运维、按量计费、与数据库同环境内网直连，冷启动可控 |
| 路由 | 自研极简路由（51 行） | 不引入 Express：部署包更小、冷启动更快、资源消耗更低；仅需支持 `/api/posts/:id` 这一种路径参数 |
| 数据库 | CloudBase 文档型数据库 | 集合数量少、文档结构内聚，评价与状态记录以数组内嵌，规避文档数据库不擅长的关联查询 |
| 依赖 | 运行时仅 `@cloudbase/node-sdk` | 减少部署包体积与供应链风险 |

整体只遵循一条原则：**在满足业务与验收要求的前提下，依赖最少、部署最简单**。

## 目录结构

```
skillswap/
├── miniprogram/                  微信小程序用户端
│   ├── app.js / app.json / app.wxss
│   ├── config/index.js           环境 ID、API 地址、分类与分页常量
│   ├── pages/                    10 个页面
│   ├── components/               empty / picker-sheet / post-card
│   ├── styles/tokens.wxss        设计令牌
│   └── utils/                    auth / request / format / safety
│
├── admin-web/                    Web 管理端（Vue 3 + Vite）
│   ├── src/api/http.js           统一请求封装
│   ├── src/views/                LoginView / HomeView
│   ├── src/stores/               登录态
│   └── vite.config.js            基础路径 /skillswap-web/
│
├── cloudbase/                    CloudBase 后端
│   ├── cloudbaserc.json
│   ├── db/
│   │   ├── collections.json      4 个集合的字段定义
│   │   └── indexes.md            索引与安全规则（含一次线上缺陷的记录）
│   └── functions/
│       ├── skillswap-api/        业务云函数（36 接口）
│       │   ├── index.js          入口：CORS、路径归一化、异常兜底
│       │   ├── config.js         只读环境变量，不硬编码任何密钥
│       │   ├── lib/              12 个通用模块
│       │   ├── routes/           5 个路由文件
│       │   └── services/         用户服务层
│       ├── admin-static/         托管管理端构建产物
│       ├── seed-data/            种子数据
│       └── seed-related/         关联数据
│
├── tests/                        15 套自动化测试 + 小程序静态检查
├── scripts/                      部署、口令哈希、种子数据脚本
└── 部署说明.md                    环境变量、部署步骤与验证清单
```

## 接口一览

统一响应格式为 `{ code, msg, data }`，业务错误通过 HTTP 状态码与 `code` 双重表达。

### 认证与资料（4）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 微信登录，`code` 换 `openid` 并建号 |
| GET | `/api/auth/me` | 获取当前登录用户 |
| POST | `/api/auth/profile` | 维护个人资料 |
| POST | `/api/auth/test-login` | 沙盒模式专用，仅供单设备验收 |

### 技能帖（9）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/posts` | 广场列表：分类、意图、标签、关键词、游标分页 |
| GET | `/api/posts/:id` | 帖子详情 |
| GET | `/api/posts/mine` | 我的发布（按状态筛选） |
| GET | `/api/posts/related` | 相关推荐，按标签重合度排序 |
| GET | `/api/posts/counts` | 我的发布各状态计数 |
| GET | `/api/posts/tags` | 标签聚合 |
| GET | `/api/posts/:id/reviews` | 帖子收到的评价与好评率 |
| POST | `/api/posts` | 发布技能帖（经内容安全校验） |
| POST | `/api/posts/:id/republish` | 被驳回的帖修改后重新提交 |

### 用户公开信息（2）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/users/:openid/profile` | 脱敏资料（不下发真实姓名、学号、联系方式） |
| GET | `/api/users/:openid/reviews` | 该用户收到的评价 |

### 交换（11）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/exchanges` | 发起交换申请 |
| GET | `/api/exchanges` | 我发起的交换 |
| GET | `/api/exchanges/received` | 我收到的申请 |
| GET | `/api/exchanges/:id` | 交换详情（成约后含双方联系方式） |
| POST | `/api/exchanges/:id/confirm` | 帖主接受申请 |
| POST | `/api/exchanges/:id/reject` | 帖主驳回申请 |
| POST | `/api/exchanges/:id/start` | 确认开始协作（双方各一次） |
| POST | `/api/exchanges/:id/cancel-start` | 临时有事，回到待开始并留言 |
| POST | `/api/exchanges/:id/cancel` | 取消交换（仅待开始阶段） |
| POST | `/api/exchanges/:id/complete` | 标记完成（双方各一次） |
| POST | `/api/exchanges/:id/evaluate` | 提交评价 |

### 管理端（10）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/login` | 管理员登录（连续失败锁定） |
| GET | `/api/admin/stats` | 看板统计 |
| GET | `/api/admin/posts` | 帖子列表（状态/分类/类型/关键词） |
| POST | `/api/admin/posts/:id/ai-audit` | 触发 AI 预审 |
| POST | `/api/admin/posts/:id/review` | 通过 / 驳回 |
| POST | `/api/admin/posts/:id/takedown` | 下架 / 恢复 |
| GET | `/api/admin/users` | 用户搜索 |
| GET | `/api/admin/users/:openid` | 用户详情及其发布、交换记录 |
| POST | `/api/admin/users/:openid/ban` | 封禁 / 解封 |
| POST | `/api/admin/seed` | 灌入测试数据 |

另有 `GET /api/health` 用于联通性检查，回显各配置项是否就绪（只回显布尔值，不回显内容）。

## 数据模型

四个集合，安全规则统一为 `{ "read": false, "write": false }`。

| 集合 | 说明 | 关键字段 |
|---|---|---|
| `users` | 用户 | `_openid`（唯一）、`role`、`nickname`、`studentId`、`realName`、`tags[]`、`contact`、`status`、`goodCount / totalCount` |
| `posts` | 技能帖 | `authorId`、`title`、`content`、`category`、`tags[]`、`type`（`teach` / `learn`）、`status`（`pending` / `passed` / `rejected` / `offline`）、`createTime` |
| `exchanges` | 交换关系 | `postId`、`applicantId`、`targetId`、`status`、`startBy[]`、`cancelBy[]`、`cancelNotes[]`、`completedBy[]`、`evaluations[]` |
| `configs` | 配置 | 管理员登录失败计数与锁定时间 |

索引（`cloudbase/db/indexes.md` 有完整表格）：

| 集合 | 索引 | 类型 |
|---|---|---|
| users | `_openid` | 唯一 |
| users | `studentId` | 普通 |
| posts | `status + createTime` | 联合（降序） |
| posts | `authorId + createTime` | 联合（降序） |
| exchanges | `applicantId + createTime` | 联合（降序） |
| exchanges | `targetId + status` | 联合 |
| exchanges | `postId + applicantId + status` | **普通，切勿设为唯一** |

最后一条索引有一次真实的踩坑：最初建成了唯一索引，导致**交换完成后再申请同一帖直接抛 `E11000 duplicate key`**。原因是业务允许同一对 `(postId, applicantId)` 保留多条历史记录，而「同时只能有一笔未结束的申请」是**业务层约束，不是数据库唯一约束**。修复方式是把状态下推到查询条件里，而不是取出最近一条再在内存中判断。

## 交换状态机

```
                    ┌─────────┐
                    │ pending │  申请中
                    └────┬────┘
             帖主驳回 ←──┤──→ 帖主接受
                    │         │
                    ▼         ▼
              ┌─────────┐  ┌────────┐
              │ rejected│  │ active │  待开始（双方可各取消一次）
              └─────────┘  └───┬────┘
                               │ 双方各自确认开始
                               ▼
                          ┌─────────┐
                          │ started │  进行中
                          └────┬────┘
                               │ 双方各自标记完成
                               ▼
                          ┌───────────┐
                          │ completed │ → 进入互评
                          └───────────┘
```

`rejected` 与 `cancelled` 是终态：**跳过评价、不占用任何资源、不再互发联系方式**。

成约后有两层互斥保护，均由服务端实时推导（不往帖子文档写冗余字段）：

- **帖子维度**：一个帖子有进行中的交换时，该帖的其它申请无法确认或开始；
- **用户对维度**：同一对用户之间同时只允许一摊进行中的交换。

## 评价体系

评价记录写入 `exchanges.evaluations`，每条含 `openid`、`role`、`rating`、`comment`、`time`：

| 角色 | 可选评价 | 是否计入对方好评率 |
|---|---|---|
| 学员（learner） | 满意 / 不满意 / 仅评语 | **计**（`rating` 进入 `goodCount` / `totalCount`） |
| 教学者（teacher） | 仅评语 | 不计 |

角色由帖子类型推导：`teach` 帖的帖主是教学者、申请人是学员；`learn` 帖相反。教学者一端在服务端被强制为「仅评语」，前端据服务端下发的角色字段决定展示三态按钮还是纯文本框。

评价完成后按钮收起，改为展示「我的评价」与「对方的评价」两栏。

## 快速开始

### 前置要求

- 微信开发者工具（调试小程序端）
- Node.js 18 及以上
- 一个腾讯云开发 CloudBase 环境
- CloudBase CLI：`npm i -g @cloudbase/cli` 后 `tcb login`

### 1. 准备云端资源

在 CloudBase 控制台完成一次性配置，详细步骤见 **`部署说明.md`**：

1. 创建 4 个集合：`users`、`posts`、`exchanges`、`configs`；
2. 为 4 个集合统一设置安全规则 `{ "read": false, "write": false }`；
3. 按 `cloudbase/db/indexes.md` 添加索引；
4. 创建云函数 `skillswap-api`（Node.js 18）与 `admin-static`，并**开启 HTTP 访问服务**；
5. 在 **HTTP 网关 → 路由管理**添加路由，路径透传一律**关闭**：

   | 路径 | 资源对象 |
   |---|---|
   | `/skillswap-api/` | `skillswap-api` |
   | `/skillswap-web/` | `admin-static` |

> 路径透传关闭时网关会剥掉前缀，函数收到的路径是 `/api/health`，正好命中代码中的路由表。这一步不配置的话外网无法访问。

6. 为 `skillswap-api` 添加环境变量：

   | 变量 | 说明 | 是否必需 |
   |---|---|---|
   | `WX_APPID` / `WX_SECRET` | 小程序 AppID 与密钥 | 生产必需 |
   | `TOKEN_SECRET` | 自签 token 密钥 | 必需 |
   | `ADMIN_USER` | 管理员账号 | 必需 |
   | `ADMIN_PASS_HASH` | 管理员口令哈希，见下方生成命令 | 必需 |
   | `TMS_SECRET_ID` / `TMS_SECRET_KEY` | 腾讯云文本内容安全 | 可选，不填则降级为本地词表 |
   | `SANDBOX_MODE` | 测试沙盒开关，**上线前务必移除** | 仅验收用 |

> 修改环境变量后**必须重新部署一次云函数**才会生效。

### 2. 生成管理员口令哈希

口令绝不以明文存储，环境变量里放的是 PBKDF2-SHA256 哈希：

```bash
node scripts/gen-admin-hash.js <你的管理员口令>
```

把输出整段填进 `ADMIN_PASS_HASH`。哈希格式为 `pbkdf2$<迭代次数>$<salt-hex>$<hash-hex>`，校验时使用恒定时间比较，避免通过响应时间差推测口令内容。

### 3. 部署云函数

```bash
cd cloudbase
tcb fn deploy skillswap-api --force -e <你的环境ID>
tcb fn deploy admin-static  --force -e <你的环境ID>
```

### 4. 构建并部署管理端

管理端产物由 `admin-static` 云函数托管，构建脚本会自动把 `dist` 拷进该函数目录：

```bash
cd admin-web
npm install
npm run build:deploy
```

然后按第 3 步重新部署 `admin-static`。访问入口为 `https://<域名>/skillswap-web/`。

### 5. 运行小程序端

1. 打开 `miniprogram/config/index.js`，把 `ENV_ID` 与 `HTTP_DOMAIN` 改成你自己的环境；
2. 微信开发者工具导入 `miniprogram/` 目录；
3. 在微信公众平台把上述域名加入 **request 合法域名**。

## 测试

测试不依赖网络与云端资源：用内存数据库替换数据访问层、用模拟对象替换外部服务，业务代码无需改动即可在本地秒级跑完全部用例。

```bash
# 全量逻辑测试（自动发现同目录下的 *.test.js）
node tests/run-all.js

# 小程序端静态检查（语法、页面文件完整性、tabBar、组件声明、跳转路径）
node tests/check-miniprogram.js
```

当前结果：

```
[全量测试] skillswap 本地套件

  seed-data / stage0 / stage2 / stage2-mp / stage2b-hybrid
  stage3 / stage4 / stage4-sandbox-account / stage5 / stage6-reviews
  stage7-exchange-start / stage8-search / stage9-cancel-exchange
  stage10-reapply / stage11-pair-busy

合计：通过 379 / 失败 0
```

15 套件 / 379 项断言。覆盖范围包括登录建号、资料校验、发布与内容安全降级、审核闭环、交换全状态机、双层占用互斥、取消留言、重复申请、评价计分角色判定、搜索与分页边界、封禁连带下架。

## 几处值得说明的设计

**前端不直连数据库。** 四个集合的读写规则全部关闭，端侧只能通过云函数访问。这样权限判断只有一处实现，也不会因为环境 ID 泄漏而暴露数据。

**状态与占用不在数据库里冗余存储。** 帖子是否被占用、用户之间是否已有进行中的交换，都由云函数在读取时实时推导，避免出现「冗余字段没同步」导致的脏数据。

**同一份业务规则只实现一次。** 鉴权、数据访问、评价计分、交换状态推导、搜索匹配都沉在 `lib/` 里，路由层只负责组织调用。

**第三方服务一律可降级。** 文本内容安全未配置或调用异常时，回落本地敏感词表并转入人工审核队列——外部服务故障只降低自动化程度，不降低可用性。

**游标分页而非偏移分页。** 用最后一条记录的时间与标识作为下一页游标，既准确判断翻页边界，也避免深翻页时的性能衰减。

**首页判空与状态提示统一走组件。** 10 个页面共用 3 个公共组件，空态、帖子卡片、下拉选择器各只有一份实现；下拉选择器为自研组件，因为原生选择器的弹出层由宿主渲染，深色模式下无法覆盖样式。

## 已知限制

- 技能分类固定为 6 类，未做分类管理功能；
- 未接入支付、即时通讯与消息推送，联系方式的交换靠双方在成约后自行查看；
- 沙盒模式仅用于单设备验收，上线前需移除 `SANDBOX_MODE` 环境变量；
- 管理端为单账号模型，未做多管理员与权限分级。

---

后端部署的完整步骤、环境变量清单与验收清单见 [`部署说明.md`](./部署说明.md)；数据库字段定义见 [`cloudbase/db/collections.json`](./cloudbase/db/collections.json)。


