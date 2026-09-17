import { reactive, computed } from 'vue';
import { getToken, setToken, clearToken } from '../api/http.js';

const USER_KEY = 'skillswap_admin_user';

const state = reactive({
  token: getToken(),
  username: localStorage.getItem(USER_KEY) || '',
});

export function setSession(token, username) {
  state.token = token;
  state.username = username;
  setToken(token);
  localStorage.setItem(USER_KEY, username || '');
}

export function clearSession() {
  state.token = '';
  state.username = '';
  clearToken();
  localStorage.removeItem(USER_KEY);
}

export const isLogin = computed(() => !!state.token);

export default state;
