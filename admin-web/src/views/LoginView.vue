<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <span class="sq">技</span>
        <div>
          <div class="lt">技能交换平台</div>
          <div class="ls">管理端 · 管理员登录</div>
        </div>
      </div>

      <div class="err" v-if="error">{{ error }}</div>

      <div class="field">
        <label>账号</label>
        <input class="input" v-model="form.username" placeholder="请输入管理员账号" autocomplete="username" />
      </div>
      <div class="field">
        <label>密码</label>
        <input
          class="input"
          v-model="form.password"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
          @keyup.enter="onSubmit"
        />
      </div>

      <button class="btn-primary" :disabled="loading" @click="onSubmit">
        {{ loading ? '登录中…' : '登 录' }}
      </button>

      <div class="login-hint">连续输错 5 次将锁定账号 30 分钟</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { post } from '../api/http.js';
import { setSession } from '../stores/user.js';

const route = useRoute();
const router = useRouter();

const form = ref({ username: '', password: '' });
const error = ref('');
const loading = ref(false);

async function onSubmit() {
  if (loading.value) return;
  if (!form.value.username || !form.value.password) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const data = await post('/api/admin/login', {
      username: form.value.username,
      password: form.value.password,
    });
    setSession(data.token, data.username || form.value.username);
    router.replace(route.query.redirect || '/');
  } catch (e) {
    error.value = e.message || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--canvas);
  padding: 30px;
}
.login-card {
  width: 384px;
  background: #fff;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  padding: 34px 32px;
}
.login-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.login-logo .sq {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: var(--red-deep);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  flex: 0 0 auto;
}
.login-logo .lt { font-size: 17px; font-weight: 700; color: var(--ink); line-height: 1.3; }
.login-logo .ls { font-size: 12px; color: var(--muted); }

.err {
  font-size: 13px;
  color: var(--red-deep);
  background: var(--warn-bg);
  border: 1px solid rgba(194, 24, 61, 0.25);
  border-radius: 9px;
  padding: 9px 12px;
  margin-bottom: 16px;
  line-height: 1.5;
}

.field { margin-bottom: 16px; }
.field label { display: block; font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 7px; }
.input {
  width: 100%;
  height: 44px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 14px;
  font-size: 14px;
  color: var(--ink);
  background: #fff;
  outline: none;
}
.input:focus { border-color: var(--red); }

.btn-primary {
  width: 100%;
  height: 46px;
  background: var(--red-deep);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 4px;
  margin-top: 4px;
}
.btn-primary:disabled { opacity: .7; cursor: not-allowed; }

.login-hint {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  margin-top: 16px;
  line-height: 1.5;
}
</style>
