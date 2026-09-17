import { createRouter, createWebHashHistory } from 'vue-router';
import { isLogin } from '../stores/user.js';

// hash 路由：云函数回落逻辑最简单，无需为 history 模式逐路径写规则
const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isLogin.value) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && isLogin.value) {
    return { name: 'home' };
  }
  return true;
});

export default router;
