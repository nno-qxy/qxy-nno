<template>
  <div class="layout">
    <!-- 左侧窄导航 -->
    <aside class="sidebar">
      <div class="brand">
        <span class="sq">技</span>
        <span class="brand-text">技能交换<br />管理端</span>
      </div>

      <nav class="nav">
        <div class="nav-group">总览</div>
        <a class="nav-item" :class="{ on: active === 'dash' }" @click="pick('dash')">数据看板</a>

        <div class="nav-group">内容审核</div>
        <a class="nav-item" :class="{ on: active === 'pending' }" @click="pick('pending')">
          待审列表
          <span class="badge" v-if="counts.pending">{{ counts.pending }}</span>
        </a>
        <a class="nav-item" :class="{ on: active === 'records' }" @click="pick('records')">已审记录</a>
        <a class="nav-item" :class="{ on: active === 'posts' }" @click="pick('posts')">所有帖子</a>

        <div class="nav-group">用户管理</div>
        <a class="nav-item" :class="{ on: active === 'users' }" @click="pick('users')">用户列表</a>
      </nav>

      <div class="side-foot">
        <div class="who">{{ username || '管理员' }}</div>
        <a class="logout" @click="onLogout">退出登录</a>
      </div>
    </aside>

    <!-- 主区 -->
    <main class="main">
      <header class="topbar">
        <div class="title">{{ titleText }}</div>
        <div class="top-right muted">环境：{{ envId }}</div>
      </header>

      <section class="content">
        <!-- 数据看板（首页总览） -->
        <div v-if="active === 'dash'">
          <div v-if="dashLoading" class="empty muted">加载中…</div>
          <template v-else-if="stats">
            <!-- 核心指标卡 -->
            <div class="kpi-row">
              <div class="kpi" @click="pick('users')">
                <div class="kpi-num">{{ stats.users.total }}</div>
                <div class="kpi-label">用户总数</div>
                <div class="kpi-sub muted">今日 +{{ stats.users.today }} · 封禁 {{ stats.users.banned }}</div>
              </div>
              <div class="kpi warn" @click="pick('pending')">
                <div class="kpi-num">{{ stats.posts.pending }}</div>
                <div class="kpi-label">待审核帖子</div>
                <div class="kpi-sub muted">今日新发布 {{ stats.posts.today }}</div>
              </div>
              <div class="kpi ok">
                <div class="kpi-num">{{ stats.posts.passed }}</div>
                <div class="kpi-label">已上广场</div>
                <div class="kpi-sub muted">驳回 {{ stats.posts.rejected }} · 下架 {{ stats.posts.offline }}</div>
              </div>
              <div class="kpi">
                <div class="kpi-num">{{ stats.exchanges.active }}</div>
                <div class="kpi-label">进行中交换</div>
                <div class="kpi-sub muted">申请中 {{ stats.exchanges.pending }} · 完成 {{ stats.exchanges.completed }}</div>
              </div>
            </div>

            <div class="dash-grid">
              <!-- 7 日发布趋势 -->
              <div class="panel-box">
                <div class="box-title">近 7 日发布趋势</div>
                <div class="trend">
                  <div v-for="d in stats.trend" :key="d.date" class="trend-col">
                    <div class="trend-num muted">{{ d.count || '' }}</div>
                    <div class="trend-bar-wrap">
                      <div class="trend-bar" :style="{ height: trendH(d.count) + 'px' }"></div>
                    </div>
                    <div class="trend-date muted">{{ d.date }}</div>
                  </div>
                </div>
              </div>

              <!-- 帖子状态分布（环形图） -->
              <div class="panel-box">
                <div class="box-title">帖子状态分布</div>
                <div class="donut-wrap">
                  <svg class="donut" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="46" fill="none" stroke="#EEEFF2" stroke-width="16" />
                    <circle
                      v-for="seg in donutSegs" :key="seg.key"
                      cx="60" cy="60" r="46" fill="none"
                      :stroke="seg.color" stroke-width="16"
                      :stroke-dasharray="seg.dash" :stroke-dashoffset="seg.offset"
                      transform="rotate(-90 60 60)"
                    />
                    <text x="60" y="57" text-anchor="middle" class="donut-num">{{ postsTotalShown }}</text>
                    <text x="60" y="73" text-anchor="middle" class="donut-label">帖子</text>
                  </svg>
                  <div class="legend">
                    <div v-for="seg in donutSegs" :key="seg.key" class="legend-item">
                      <span class="dot" :style="{ background: seg.color }"></span>
                      {{ seg.name }} <b>{{ seg.value }}</b>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 热门标签 -->
              <div class="panel-box">
                <div class="box-title">热门标签 Top 8（已上广场）</div>
                <div v-if="!stats.topTags.length" class="muted">暂无数据</div>
                <div v-for="t in stats.topTags" :key="t.tag" class="rank-row">
                  <span class="rank-name">{{ t.tag }}</span>
                  <div class="rank-bar-wrap"><div class="rank-bar" :style="{ width: barW(t.count, stats.topTags) }"></div></div>
                  <span class="rank-val muted">{{ t.count }}</span>
                </div>
              </div>

              <!-- 分类分布 -->
              <div class="panel-box">
                <div class="box-title">分类分布 Top 6（已上广场）</div>
                <div v-if="!stats.topCategories.length" class="muted">暂无数据</div>
                <div v-for="c in stats.topCategories" :key="c.category" class="rank-row">
                  <span class="rank-name">{{ c.category }}</span>
                  <div class="rank-bar-wrap"><div class="rank-bar purple" :style="{ width: barW(c.count, stats.topCategories) }"></div></div>
                  <span class="rank-val muted">{{ c.count }}</span>
                </div>
              </div>

              <!-- 好评用户 Top5 -->
              <div class="panel-box">
                <div class="box-title">好评用户 Top 5</div>
                <div v-if="!stats.topUsers.length" class="muted">暂无数据</div>
                <div v-for="(u, i) in stats.topUsers" :key="i" class="topu-row">
                  <span class="topu-rank" :class="'r' + (i + 1)">{{ i + 1 }}</span>
                  <span class="avatar sm" :style="{ background: u.avatarColor }">{{ u.name[0] }}</span>
                  <span class="topu-name">{{ u.name }}</span>
                  <span class="spacer" />
                  <span class="topu-rate"><b>{{ u.goodCount }}</b> / {{ u.totalCount }} 好评</span>
                </div>
              </div>

              <!-- 交换状态 -->
              <div class="panel-box">
                <div class="box-title">交换状态</div>
                <div class="ex-grid">
                  <div class="ex-cell"><div class="ex-num">{{ stats.exchanges.pending }}</div><div class="muted">申请中</div></div>
                  <div class="ex-cell"><div class="ex-num">{{ stats.exchanges.active }}</div><div class="muted">进行中</div></div>
                  <div class="ex-cell"><div class="ex-num">{{ stats.exchanges.completed }}</div><div class="muted">已完成</div></div>
                  <div class="ex-cell"><div class="ex-num">{{ stats.exchanges.cancelled }}</div><div class="muted">已取消</div></div>
                  <div class="ex-cell"><div class="ex-num">{{ stats.exchanges.rejected }}</div><div class="muted">已拒绝</div></div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 待审列表 -->
        <div v-else-if="active === 'pending'">
          <div v-if="loading" class="empty muted">加载中…</div>
          <div v-else-if="!list.length" class="empty muted">暂无待审核内容 🎉</div>
          <div v-else class="cards">
            <article v-for="p in list" :key="p._id" class="card">
              <div class="card-head">
                <span class="type" :class="p.type">{{ p.type === 'teach' ? '教' : '学' }}</span>
                <span class="cat">{{ p.category }}</span>
                <span class="spacer" />
                <span class="author">{{ p.authorName || '匿名' }}</span>
              </div>
              <h3 class="card-title">{{ p.title }}</h3>
              <p class="card-content">{{ p.content }}</p>
              <div class="tags" v-if="p.tags && p.tags.length">
                <span class="tag" v-for="t in p.tags" :key="t">#{{ t }}</span>
              </div>

              <!-- AI 预审结论条 -->
              <div v-if="p.ai" class="ai" :class="aiClass(p.ai)">
                <span class="ai-ico">AI</span>
                <span class="ai-text">{{ aiSummary(p.ai) }}</span>
              </div>

              <!-- 驳回原因输入 -->
              <div v-if="p.reasonMode" class="reject-box">
                <textarea
                  v-model="p.reason"
                  class="reason"
                  maxlength="100"
                  placeholder="请填写驳回原因（必填，≤100 字）"
                ></textarea>
                <div class="reject-actions">
                  <span class="counter">{{ (p.reason || '').length }}/100</span>
                  <button class="btn-ghost" @click="cancelReason(p)">取消</button>
                  <button class="btn-danger" :disabled="!(p.reason && p.reason.trim())" @click="confirmReason(p)">
                    确认驳回
                  </button>
                </div>
              </div>

              <!-- 操作区 -->
              <div v-else class="actions">
                <button class="btn-ghost" :disabled="p.busy" @click="runAi(p)">AI 预审</button>
                <span class="spacer" />
                <button class="btn-danger-ghost" :disabled="p.busy" @click="startReason(p, 'reject')">驳回</button>
                <button class="btn-primary" :disabled="p.busy" @click="doReview(p, 'pass')">通过</button>
              </div>
            </article>
          </div>
        </div>

        <!-- 已审记录 -->
        <div v-else-if="active === 'records'">
          <div v-if="loading" class="empty muted">加载中…</div>
          <div v-else-if="!list.length" class="empty muted">暂无审核记录</div>
          <div v-else class="cards">
            <article v-for="p in list" :key="p._id" class="card">
              <div class="card-head">
                <span class="type" :class="p.type">{{ p.type === 'teach' ? '教' : '学' }}</span>
                <span class="cat">{{ p.category }}</span>
                <span class="spacer" />
                <span class="st" :class="'st-' + p.status">{{ statusLabel(p.status) }}</span>
              </div>
              <h3 class="card-title">{{ p.title }}</h3>
              <p class="card-content">{{ p.content }}</p>
              <div class="meta muted" v-if="p.status === 'rejected'">驳回原因：{{ p.rejectReason }}</div>
              <div class="meta muted" v-if="p.reviewer">审核人：{{ p.reviewer }}</div>
            </article>
          </div>
        </div>

        <!-- 帖子管理（G-09：全量帖子检索与处置） -->
        <div v-else-if="active === 'posts'">
          <div class="filters">
            <select v-model="pf.status" class="sel" @change="loadPosts">
              <option value="all">全部状态</option>
              <option value="pending">待审核</option>
              <option value="passed">已通过</option>
              <option value="rejected">已驳回</option>
              <option value="offline">已下架</option>
            </select>
            <select v-model="pf.type" class="sel" @change="loadPosts">
              <option value="">全部类型</option>
              <option value="teach">我能教</option>
              <option value="learn">我想学</option>
            </select>
            <select v-model="pf.category" class="sel" @change="loadPosts">
              <option value="">全部分类</option>
              <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
            </select>
            <input
              v-model="pf.keyword"
              class="search-input"
              placeholder="搜索 标题 / 正文 / 标签 / 作者"
              @keyup.enter="loadPosts"
            />
            <button class="btn-primary" :disabled="postsLoading" @click="loadPosts">搜索</button>
            <button class="btn-ghost" :disabled="postsLoading" @click="resetFilters">重置</button>
          </div>

          <div class="list-head muted">
            共 {{ postsList.length }} 条{{ postsList.length >= 100 ? '（仅显示前 100 条，可用筛选缩小范围）' : '' }}
          </div>

          <div v-if="postsLoading" class="empty muted">加载中…</div>
          <div v-else-if="!postsList.length" class="empty muted">没有符合条件的帖子</div>

          <div v-else class="cards">
            <article v-for="p in postsList" :key="p._id" class="card">
              <div class="card-head">
                <span class="type" :class="p.type">{{ p.type === 'teach' ? '教' : '学' }}</span>
                <span class="cat">{{ p.category }}</span>
                <span class="spacer" />
                <span class="st" :class="'st-' + p.status">{{ statusLabel(p.status) }}</span>
              </div>
              <h3 class="card-title">{{ p.title }}</h3>
              <p class="card-content">{{ p.content }}</p>
              <div class="tags" v-if="p.tags && p.tags.length">
                <span class="tag" v-for="t in p.tags" :key="t">#{{ t }}</span>
              </div>
              <div class="meta muted">
                {{ p.authorName || '匿名' }} · 发布于 {{ fmtTime(p.createTime) }}
                <template v-if="p.status === 'rejected'"> · 驳回原因：{{ p.rejectReason || '—' }}</template>
                <template v-if="p.status === 'offline' && p.offlineReason"> · 下架原因：{{ p.offlineReason }}</template>
              </div>

              <!-- 原因输入（驳回 / 下架共用） -->
              <div v-if="p.reasonMode" class="reject-box">
                <textarea
                  v-model="p.reason"
                  class="reason"
                  maxlength="100"
                  :placeholder="p.reasonMode === 'reject' ? '请填写驳回原因（必填，≤100 字）' : '请填写下架原因（选填，≤100 字）'"
                ></textarea>
                <div class="reject-actions">
                  <span class="counter">{{ (p.reason || '').length }}/100</span>
                  <button class="btn-ghost" @click="cancelReason(p)">取消</button>
                  <button
                    class="btn-danger"
                    :disabled="p.busy || (p.reasonMode === 'reject' && !(p.reason || '').trim())"
                    @click="confirmReason(p)"
                  >{{ p.reasonMode === 'reject' ? '确认驳回' : '确认下架' }}</button>
                </div>
              </div>

              <div v-else class="actions">
                <template v-if="p.status === 'pending'">
                  <button class="btn-ghost" :disabled="p.busy" @click="runAi(p)">AI 预审</button>
                  <span class="spacer" />
                  <button class="btn-danger-ghost" :disabled="p.busy" @click="startReason(p, 'reject')">驳回</button>
                  <button class="btn-primary" :disabled="p.busy" @click="doReview(p, 'pass')">通过</button>
                </template>
                <template v-else-if="p.status === 'passed'">
                  <span class="spacer" />
                  <button class="btn-danger-ghost" :disabled="p.busy" @click="startReason(p, 'offline')">下架</button>
                </template>
                <template v-else-if="p.status === 'offline'">
                  <span class="spacer" />
                  <button class="btn-primary" :disabled="p.busy" @click="doRestore(p)">恢复上架</button>
                </template>
                <template v-else>
                  <span class="spacer" />
                  <span class="muted">已驳回，无需处置</span>
                </template>
              </div>

              <div v-if="p.ai" class="ai" :class="aiClass(p.ai)">
                <span class="ai-ico">AI</span>
                <span class="ai-text">{{ aiSummary(p.ai) }}</span>
              </div>
            </article>
          </div>
        </div>

        <!-- 用户管理（阶段 5：G-06 搜索 / G-07 详情 / G-08 封禁解封） -->
        <div v-else-if="active === 'users'">
          <div class="search-bar">
            <input
              v-model="keyword"
              class="search-input"
              placeholder="搜索 昵称 / 姓名 / 学号 / openid"
              @keyup.enter="searchUsers"
            />
            <button class="btn-primary" :disabled="usersLoading" @click="searchUsers">搜索</button>
          </div>

          <div v-if="usersLoading" class="empty muted">加载中…</div>
          <div v-else-if="!usersList.length" class="empty muted">暂无匹配用户</div>

          <div v-else class="users-wrap">
            <!-- 左：用户列表 -->
            <div class="user-cards">
              <article
                v-for="u in usersList"
                :key="u._openid"
                class="ucard"
                :class="{ on: selected && selected.user && selected.user._openid === u._openid }"
                @click="openUser(u._openid)"
              >
                <div class="ucard-head">
                  <span class="avatar" :style="{ background: u.avatarColor || '#B7BDC7' }">{{ (u.nickname || '?')[0] }}</span>
                  <span class="uname">{{ u.nickname || '匿名' }}</span>
                  <span class="spacer" />
                  <span class="st" :class="u.status === 'banned' ? 'st-rejected' : 'st-passed'">
                    {{ u.status === 'banned' ? '已封禁' : '正常' }}
                  </span>
                </div>
                <div class="umeta muted">学号 {{ u.studentId || '—' }} · {{ u.grade || '' }} {{ u.major || '' }}</div>
                <div class="umeta muted">好评 {{ u.goodCount || 0 }}/{{ u.totalCount || 0 }} · {{ (u._openid || '').slice(0, 12) }}…</div>
              </article>
            </div>

            <!-- 右：用户详情 -->
            <aside v-if="selected" class="udetail">
              <div class="ud-top">
                <div>
                  <div class="ud-name">{{ selected.user.nickname || '匿名' }}</div>
                  <div class="muted ud-sub">{{ selected.user.realName || '' }} · {{ selected.user.studentId || '' }}</div>
                </div>
                <button class="btn-ghost" @click="closeUser">关闭</button>
              </div>

              <div class="ud-section">
                <div class="ud-sec-title">基本信息</div>
                <div class="ud-row"><span>openid</span><b class="mono">{{ selected.user._openid }}</b></div>
                <div class="ud-row"><span>状态</span>
                  <b :class="selected.user.status === 'banned' ? 'txt-warn' : 'txt-ok'">
                    {{ selected.user.status === 'banned' ? '已封禁' : '正常' }}
                  </b>
                </div>
                <div class="ud-row"><span>年级/专业</span><b>{{ selected.user.grade || '—' }} {{ selected.user.major || '' }}</b></div>
                <div class="ud-row"><span>好评</span><b>{{ selected.user.goodCount || 0 }} / {{ selected.user.totalCount || 0 }}</b></div>
                <div class="ud-row"><span>注册时间</span><b>{{ fmtTime(selected.user.createTime) }}</b></div>
              </div>

              <div class="ud-section">
                <div class="ud-sec-title">发布（{{ selected.posts.length }}）</div>
                <div v-if="!selected.posts.length" class="muted ud-empty">暂无发布</div>
                <div v-for="p in selected.posts" :key="p._id" class="ud-item">
                  <span class="type" :class="p.type">{{ p.type === 'teach' ? '教' : '学' }}</span>
                  <span class="ud-item-title">{{ p.title }}</span>
                  <span class="st" :class="'st-' + p.status">{{ statusLabel(p.status) }}</span>
                </div>
              </div>

              <div class="ud-section">
                <div class="ud-sec-title">交换记录（{{ selected.exchanges.length }}）</div>
                <div v-if="!selected.exchanges.length" class="muted ud-empty">暂无交换</div>
                <div v-for="e in selected.exchanges" :key="e._id" class="ud-item">
                  <span class="ud-item-title">{{ e.postTitle }}</span>
                  <span class="st" :class="e.status === 'active' ? 'st-pending' : 'st-' + e.status">{{ exStatus(e) }}</span>
                </div>
              </div>

              <div class="ud-actions">
                <button
                  v-if="selected.user.status !== 'banned'"
                  class="btn-danger" :disabled="detailBusy"
                  @click="toggleBan(selected.user._openid, 'ban')"
                >封禁该用户</button>
                <button
                  v-else
                  class="btn-primary" :disabled="detailBusy"
                  @click="toggleBan(selected.user._openid, 'unban')"
                >解封该用户</button>
                <span v-if="detailBusy" class="muted">处理中…</span>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { get, post } from '../api/http.js';
import user, { clearSession } from '../stores/user.js';

const router = useRouter();
const active = ref('dash');
const list = ref([]);
const loading = ref(false);
const counts = ref({ pending: 0 });
const username = computed(() => user.username);
const envId = import.meta.env.VITE_ENV_ID || 'nno-d2gspwvpl6c3f46';

// 用户管理态
const keyword = ref('');
const usersList = ref([]);
const usersLoading = ref(false);
const selected = ref(null);
const detailBusy = ref(false);

// 帖子管理态（G-09）
const categories = ['学业辅导', '语言交流', '文艺特长', '体育健身', '数码技能', '生活服务'];
const pf = ref({ status: 'all', type: '', category: '', keyword: '' });
const postsList = ref([]);
const postsLoading = ref(false);

const titleMap = { dash: '数据看板', pending: '待审列表', records: '已审记录', posts: '所有帖子', users: '用户列表' };
const titleText = computed(() => titleMap[active.value] || '管理端');

// ---- 数据看板状态 ----
const stats = ref(null);
const dashLoading = ref(false);

const postsTotalShown = computed(() => {
  if (!stats.value) return 0;
  const p = stats.value.posts;
  return p.pending + p.passed + p.rejected + p.offline;
});

// 环形图分段：pending 橙 / passed 绿 / rejected 红 / offline 灰
const DONUT_COLORS = { pending: '#E8842C', passed: '#36B37E', rejected: '#C2183D', offline: '#B7BDC7' };
const DONUT_NAMES = { pending: '待审核', passed: '已通过', rejected: '已驳回', offline: '已下架' };
const donutSegs = computed(() => {
  if (!stats.value) return [];
  const p = stats.value.posts;
  const total = postsTotalShown.value || 1;
  const C = 2 * Math.PI * 46;
  let acc = 0;
  return ['pending', 'passed', 'rejected', 'offline'].map((key) => {
    const value = p[key];
    const frac = value / total;
    const seg = {
      key,
      name: DONUT_NAMES[key],
      value,
      color: DONUT_COLORS[key],
      dash: `${frac * C} ${C}`,
      offset: -acc * C,
    };
    acc += frac;
    return seg;
  });
});

function trendH(count) {
  const max = Math.max(...((stats.value && stats.value.trend) || [{ count: 0 }]).map((d) => d.count), 1);
  return Math.max(4, Math.round((count / max) * 96));
}
function barW(count, arr) {
  const max = Math.max(...arr.map((x) => x.count), 1);
  return Math.max(6, Math.round((count / max) * 100)) + '%';
}

async function loadDash() {
  dashLoading.value = true;
  try {
    stats.value = await get('/api/admin/stats', {});
  } catch (e) {
    /* http.js 已提示 */
  } finally {
    dashLoading.value = false;
  }
}

function pick(key) {
  active.value = key;
  selected.value = null;
  if (key === 'dash') {
    loadDash();
    return;
  }
  if (key === 'users') {
    keyword.value = '';
    searchUsers();
    return;
  }
  if (key === 'posts') {
    loadPosts();
    return;
  }
  load();
}

function statusLabel(s) {
  return { pending: '待审核', passed: '已通过', rejected: '已驳回', offline: '已下架' }[s] || s;
}
function exStatus(e) {
  // active=帖主已接受待开始，started=双方已确认开始（Z-14），cancelled=双方都确认取消（跳过评价）
  return { pending: '申请中', active: '待开始', started: '进行中', rejected: '已拒绝', completed: '已完成', cancelled: '已取消' }[e.status] || e.status;
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function load() {
  loading.value = true;
  list.value = [];
  try {
    if (active.value === 'pending') {
      const data = await get('/api/admin/posts', { status: 'pending' });
      list.value = (data.list || []).map((p) => decorate(p));
      counts.value.pending = list.value.length;
    } else if (active.value === 'records') {
      const [passed, rejected] = await Promise.all([
        get('/api/admin/posts', { status: 'passed' }),
        get('/api/admin/posts', { status: 'rejected' }),
      ]);
      list.value = [].concat(passed.list || [], rejected.list || []).map((p) => decorate(p));
    }
  } catch (e) {
    // http.js 已弹错；此处静默避免叠加提示
  } finally {
    loading.value = false;
  }
}

function decorate(p) {
  return Object.assign({}, p, { busy: false, reasonMode: '', reason: '', ai: null });
}

// ---- AI 预审 ----
async function runAi(p) {
  p.busy = true;
  p.ai = null;
  try {
    p.ai = await post(`/api/admin/posts/${p._id}/ai-audit`, {});
  } catch (e) {
    /* 错误由 http.js 提示 */
  } finally {
    p.busy = false;
  }
}
function aiClass(ai) {
  if (!ai) return '';
  if (ai.suggestion === 'Block') return 'ai-block';
  if (ai.suggestion === 'Review') return 'ai-review';
  return 'ai-pass';
}
function aiSummary(ai) {
  const src = ai.source === 'tms' ? '腾讯云' : '本地词表';
  let base = ai.summary || '';
  if (!base && ai.suggestion === 'Block') base = `建议驳回（${src}）`;
  if (!base && ai.suggestion === 'Pass') base = `建议通过（${src}${ai.degraded ? ' · 降级' : ''}）`;
  if (!base && ai.suggestion === 'Review') base = `建议人工复核（${src}）`;
  const extra = ai.word ? `命中「${ai.word}」` : ai.label ? `标签 ${ai.label}` : '';
  return base + (extra ? ` · ${extra}` : '') + (ai.degraded ? ' · TMS 不可用，已降级' : '');
}

// ---- 帖子管理：加载与筛选（G-09） ----
async function loadPosts() {
  postsLoading.value = true;
  try {
    const params = { status: pf.value.status, size: 100 };
    if (pf.value.type) params.type = pf.value.type;
    if (pf.value.category) params.category = pf.value.category;
    if (pf.value.keyword && pf.value.keyword.trim()) params.keyword = pf.value.keyword.trim();
    const data = await get('/api/admin/posts', params);
    postsList.value = (data.list || []).map((p) => decorate(p));
  } catch (e) {
    postsList.value = [];
  } finally {
    postsLoading.value = false;
  }
}

function resetFilters() {
  pf.value = { status: 'all', type: '', category: '', keyword: '' };
  loadPosts();
}

// ---- 通过 / 驳回 / 下架 / 恢复 ----
function startReason(p, mode) {
  p.reasonMode = mode;
  p.reason = '';
}
function cancelReason(p) {
  p.reasonMode = '';
  p.reason = '';
}

async function doReview(p, action) {
  if (action === 'reject' && !(p.reason && p.reason.trim())) return;
  p.busy = true;
  try {
    await post(`/api/admin/posts/${p._id}/review`, {
      action,
      reason: action === 'reject' ? p.reason.trim() : undefined,
    });
    if (active.value === 'posts') {
      // 帖子管理页保留在当前筛选视图，整体刷新
      await loadPosts();
    } else {
      list.value = list.value.filter((x) => x._id !== p._id);
      counts.value.pending = Math.max(0, counts.value.pending - 1);
    }
  } catch (e) {
    /* 错误由 http.js 提示 */
  } finally {
    p.busy = false;
    p.reasonMode = '';
  }
}

/** 原因框确认：驳回走 review；下架走 takedown */
async function confirmReason(p) {
  if (p.reasonMode !== 'offline') {
    await doReview(p, 'reject');
    return;
  }
  p.busy = true;
  try {
    await post(`/api/admin/posts/${p._id}/takedown`, {
      action: 'offline',
      reason: (p.reason || '').trim(),
    });
    await loadPosts();
  } catch (e) {
    /* 错误由 http.js 提示 */
  } finally {
    p.busy = false;
    p.reasonMode = '';
  }
}

/** 已下架帖子恢复上广场 */
async function doRestore(p) {
  p.busy = true;
  try {
    await post(`/api/admin/posts/${p._id}/takedown`, { action: 'restore' });
    await loadPosts();
  } catch (e) {
    /* 错误由 http.js 提示 */
  } finally {
    p.busy = false;
  }
}

// ---- 用户管理：G-06 搜索 ----
async function searchUsers() {
  usersLoading.value = true;
  selected.value = null;
  try {
    // size=100：管理端用户列表一屏看全（后端上限 100）
    const data = await get('/api/admin/users', { keyword: keyword.value, size: 100 });
    usersList.value = data.list || [];
  } catch (e) {
    usersList.value = [];
  } finally {
    usersLoading.value = false;
  }
}

// ---- 用户管理：G-07 详情 ----
async function openUser(openid) {
  detailBusy.value = true;
  selected.value = null;
  try {
    const data = await get(`/api/admin/users/${encodeURIComponent(openid)}`);
    selected.value = data;
  } catch (e) {
    selected.value = null;
  } finally {
    detailBusy.value = false;
  }
}
function closeUser() {
  selected.value = null;
}

// ---- 用户管理：G-08 封禁 / 解封 ----
async function toggleBan(openid, action) {
  detailBusy.value = true;
  try {
    await post(`/api/admin/users/${encodeURIComponent(openid)}/ban`, { action });
    // 刷新列表该用户状态 + 详情
    await searchUsers();
    if (selected.value) await openUser(openid);
  } catch (e) {
    /* 错误由 http.js 提示 */
  } finally {
    detailBusy.value = false;
  }
}

function onLogout() {
  clearSession();
  router.replace('/login');
}

onMounted(() => {
  // 默认进入数据看板
  loadDash();
});
</script>

<style scoped>
.layout { display: flex; min-height: 100vh; background: var(--canvas); }

.sidebar {
  width: 208px; flex: 0 0 208px;
  background: #fff; border-right: 1px solid var(--line);
  display: flex; flex-direction: column;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 18px 18px 16px; border-bottom: 1px solid var(--line-soft); }
.brand .sq {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--red-deep); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; flex: 0 0 auto;
}
.brand-text { font-size: 13px; font-weight: 700; color: var(--ink); line-height: 1.3; }

.nav { flex: 1; padding: 12px 10px; }
.nav-group { font-size: 11px; color: var(--muted); padding: 10px 10px 6px; letter-spacing: .5px; }
.nav-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border-radius: 8px;
  font-size: 14px; color: var(--ink-2); cursor: pointer; margin-bottom: 2px;
}
.nav-item:hover { background: var(--hover); }
.nav-item.on { background: rgba(194, 24, 61, 0.08); color: var(--red-deep); font-weight: 600; }
.badge { font-size: 11px; font-weight: 600; color: #fff; background: var(--red-deep); border-radius: 999px; padding: 1px 7px; }

.side-foot { padding: 14px 18px; border-top: 1px solid var(--line-soft); }
.who { font-size: 13px; font-weight: 600; color: var(--ink); }
.logout { font-size: 12px; color: var(--muted); cursor: pointer; }
.logout:hover { color: var(--red-deep); }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  height: 56px; flex: 0 0 56px; background: #fff;
  border-bottom: 1px solid var(--line);
  display: flex; align-items: center; justify-content: space-between; padding: 0 24px;
}
.title { font-size: 16px; font-weight: 600; color: var(--ink); }
.top-right { font-size: 12px; }

.content { flex: 1; padding: 20px 24px; overflow: auto; }
.empty { padding: 60px 0; text-align: center; }

.cards { display: grid; gap: 14px; max-width: 760px; }
.card {
  background: #fff; border: 1px solid var(--line-soft); border-radius: var(--radius);
  padding: 16px 18px; box-shadow: var(--shadow);
}
.card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.type {
  width: 22px; height: 22px; border-radius: 6px; display: inline-flex;
  align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700;
}
.type.teach { background: var(--teach); }
.type.learn { background: var(--learn); }
.cat { font-size: 12px; color: var(--muted); background: var(--hover); border-radius: 6px; padding: 2px 8px; }
.spacer { flex: 1; }
.author { font-size: 13px; color: var(--ink-2); }
.card-title { font-size: 16px; font-weight: 600; color: var(--ink); margin: 2px 0 6px; }
.card-content { font-size: 14px; color: var(--ink-2); line-height: 1.6; margin: 0; white-space: pre-wrap; }
.tags { margin-top: 8px; }
.tag { font-size: 12px; color: var(--muted); margin-right: 6px; }

.ai { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
.ai-ico { font-size: 11px; font-weight: 700; color: #fff; background: var(--ink-2); border-radius: 5px; padding: 1px 6px; }
.ai-pass { background: var(--ok-bg); color: var(--ok); }
.ai-review { background: var(--pending-bg); color: var(--pending); }
.ai-block { background: var(--warn-bg); color: var(--warn); }

.reject-box { margin-top: 12px; }
.reason {
  width: 100%; min-height: 64px; border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 10px; font-size: 13px; color: var(--ink); resize: vertical; outline: none;
}
.reason:focus { border-color: var(--red); }
.reject-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.counter { font-size: 12px; color: var(--muted); margin-right: auto; }

.actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.btn-primary {
  background: var(--red-deep); color: #fff; border: none; border-radius: 8px;
  padding: 8px 18px; font-size: 14px; font-weight: 600;
}
.btn-primary:disabled { opacity: .6; cursor: not-allowed; }
.btn-danger-ghost {
  background: #fff; color: var(--red-deep); border: 1px solid rgba(194, 24, 61, 0.4);
  border-radius: 8px; padding: 8px 16px; font-size: 14px;
}
.btn-danger-ghost:disabled { opacity: .5; cursor: not-allowed; }
.btn-danger {
  background: var(--red-deep); color: #fff; border: none; border-radius: 8px;
  padding: 8px 16px; font-size: 14px; font-weight: 600;
}
.btn-danger:disabled { opacity: .5; cursor: not-allowed; }
.btn-ghost {
  background: #fff; color: var(--ink-2); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 14px; font-size: 14px;
}
.btn-ghost:disabled { opacity: .5; cursor: not-allowed; }

.meta { font-size: 12px; margin-top: 8px; }
.st { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
.st-passed { background: var(--ok-bg); color: var(--ok); }
.st-rejected { background: var(--warn-bg); color: var(--warn); }
.st-pending { background: var(--pending-bg); color: var(--pending); }
.st-offline { background: var(--hover); color: var(--muted); }
.st-completed, .st-cancelled { background: var(--hover); color: var(--muted); }

.panel { background: #fff; border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 28px; }
.placeholder-title { font-size: 15px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
.muted { color: var(--muted); }

/* ===== 帖子管理 ===== */
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.sel {
  height: 38px; border: 1px solid var(--line); border-radius: 8px;
  padding: 0 10px; font-size: 14px; color: var(--ink); background: #fff; outline: none;
}
.sel:focus { border-color: var(--red); }
.filters .search-input { flex: 0 1 260px; }
.list-head { font-size: 12px; margin-bottom: 10px; }

/* ===== 用户管理 ===== */
.search-bar { display: flex; gap: 10px; max-width: 520px; margin-bottom: 16px; }
.search-input {
  flex: 1; height: 38px; border: 1px solid var(--line); border-radius: 8px;
  padding: 0 12px; font-size: 14px; color: var(--ink); outline: none; background: #fff;
}
.search-input:focus { border-color: var(--red); }

.users-wrap { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 18px; align-items: start; }
.user-cards { display: grid; gap: 10px; }
.ucard {
  background: #fff; border: 1px solid var(--line-soft); border-radius: var(--radius);
  padding: 12px 14px; cursor: pointer; transition: border-color .15s;
}
.ucard:hover { border-color: rgba(194, 24, 61, 0.3); }
.ucard.on { border-color: var(--red-deep); box-shadow: 0 0 0 1px var(--red-deep); }
.ucard-head { display: flex; align-items: center; gap: 8px; }
.avatar {
  width: 26px; height: 26px; border-radius: 7px; color: #fff; font-size: 13px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.uname { font-size: 14px; font-weight: 600; color: var(--ink); }
.umeta { font-size: 12px; margin-top: 4px; }

.udetail {
  background: #fff; border: 1px solid var(--line-soft); border-radius: var(--radius);
  padding: 16px 18px; box-shadow: var(--shadow); position: sticky; top: 0;
}
.ud-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.ud-name { font-size: 17px; font-weight: 700; color: var(--ink); }
.ud-sub { font-size: 12px; margin-top: 2px; }
.ud-section { border-top: 1px solid var(--line-soft); padding-top: 12px; margin-top: 12px; }
.ud-sec-title { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 8px; }
.ud-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
.ud-row span { color: var(--muted); }
.ud-row b { color: var(--ink); font-weight: 600; }
.ud-row .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; text-align: right; max-width: 70%; }
.ud-empty { font-size: 13px; padding: 4px 0; }
.ud-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
.ud-item-title { color: var(--ink-2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.txt-ok { color: var(--ok); }
.txt-warn { color: var(--warn); }
.ud-actions { border-top: 1px solid var(--line-soft); padding-top: 14px; margin-top: 14px; display: flex; align-items: center; gap: 10px; }

/* ===== 数据看板 ===== */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi {
  background: #fff; border: 1px solid var(--line-soft); border-radius: var(--radius);
  padding: 16px 18px; box-shadow: var(--shadow); cursor: pointer;
  border-top: 3px solid var(--teach);
}
.kpi:hover { transform: translateY(-1px); transition: transform .15s; }
.kpi.warn { border-top-color: #E8842C; }
.kpi.ok { border-top-color: #36B37E; }
.kpi:last-child { border-top-color: var(--learn); }
.kpi-num { font-size: 30px; font-weight: 800; color: var(--ink); line-height: 1.2; }
.kpi-label { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-top: 2px; }
.kpi-sub { font-size: 11px; margin-top: 6px; }

.dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.panel-box {
  background: #fff; border: 1px solid var(--line-soft); border-radius: var(--radius);
  padding: 16px 18px; box-shadow: var(--shadow); min-width: 0;
}
.box-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 12px; }

.trend { display: flex; align-items: flex-end; gap: 10px; height: 150px; padding-top: 8px; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.trend-num { font-size: 11px; }
.trend-bar-wrap { width: 100%; display: flex; justify-content: center; align-items: flex-end; flex: 1; }
.trend-bar { width: 55%; max-width: 34px; background: linear-gradient(180deg, var(--teach), #6E8FE8); border-radius: 6px 6px 2px 2px; }
.trend-date { font-size: 11px; }

.donut-wrap { display: flex; align-items: center; gap: 18px; }
.donut { width: 150px; height: 150px; flex: 0 0 auto; }
.donut-num { font-size: 22px; font-weight: 800; fill: var(--ink); }
.donut-label { font-size: 10px; fill: var(--muted); }
.legend { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--ink-2); }
.legend-item { display: flex; align-items: center; gap: 8px; }
.legend-item b { color: var(--ink); }
.dot { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }

.rank-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.rank-name { width: 88px; font-size: 13px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.rank-bar-wrap { flex: 1; background: var(--hover); border-radius: 6px; height: 14px; overflow: hidden; }
.rank-bar { height: 100%; background: linear-gradient(90deg, var(--teach), #6E8FE8); border-radius: 6px; }
.rank-bar.purple { background: linear-gradient(90deg, var(--learn), #A56EE8); }
.rank-val { width: 28px; font-size: 12px; }

.topu-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 13px; }
.topu-rank {
  width: 20px; height: 20px; border-radius: 6px; font-size: 12px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--hover); color: var(--muted); flex: 0 0 auto;
}
.topu-rank.r1 { background: #FFD54D; color: #7A5800; }
.topu-rank.r2 { background: #E4E7EC; color: var(--ink-2); }
.topu-rank.r3 { background: #F0C6A0; color: #7A4A1D; }
.topu-name { font-weight: 600; color: var(--ink); }
.topu-rate { font-size: 12px; }
.topu-rate b { color: var(--ok); }
.avatar.sm { width: 24px; height: 24px; border-radius: 7px; font-size: 12px; }
.ex-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.ex-cell { text-align: center; background: var(--hover); border-radius: 10px; padding: 12px 0; }
.ex-num { font-size: 20px; font-weight: 800; color: var(--ink); }

@media (max-width: 900px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .dash-grid { grid-template-columns: 1fr; }
}
</style>
