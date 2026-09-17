/**
 * CloudBase 文档型数据库访问封装（单例，复用云函数容器）
 * 端侧安全规则为 { read: false, write: false }，所有读写只能在云函数内完成
 */

const cloudbase = require('@cloudbase/node-sdk');

const COLLECTIONS = {
  USERS: 'users',
  POSTS: 'posts',
  EXCHANGES: 'exchanges',
  CONFIGS: 'configs', // 管理员登录失败计数等配置型数据
};

let app = null;
const cache = Object.create(null);

function getApp() {
  if (app) return app;
  app = cloudbase.init({
    env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV,
  });
  return app;
}

function db(name) {
  if (!cache[name]) cache[name] = getApp().database().collection(name);
  return cache[name];
}

function cmd() {
  return getApp().database().command;
}

/** 文档型数据库正则查询（CloudBase 要求用 db.RegExp 而非原生 RegExp） */
function regExp(o) {
  return getApp().database().RegExp(o);
}

/** 当前服务器时间戳（毫秒），统一由此出，避免多处 new Date() 口径不一 */
function now() {
  return Date.now();
}

module.exports = { getApp, db, cmd, regExp, now, COLLECTIONS };
