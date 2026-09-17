/**
 * 关键词搜索工具（广场标签搜索 / 管理端帖子搜索共用）
 *
 * - norm()       归一化关键词：去空白、限长（防超长正则拖慢查询）
 * - escapeRegExp() 转义正则特殊字符，避免用户输入 . * ( ) 破坏查询
 * - like()       生成 CloudBase 模糊匹配条件（db.RegExp，忽略大小写）
 *
 * 注意：CloudBase 要求用 db.RegExp 而非原生 RegExp 对象。
 */

const { regExp } = require('./db');

/** 关键词最大长度：与前端输入上限保持一致 */
const MAX_LEN = 20;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 归一化：去首尾空白 + 截断 */
function norm(kw) {
  return String(kw == null ? '' : kw).trim().slice(0, MAX_LEN);
}

/** 模糊匹配条件（大小写不敏感的子串匹配） */
function like(kw) {
  return regExp({ regexp: escapeRegExp(norm(kw)), options: 'i' });
}

module.exports = { norm, like, escapeRegExp, MAX_LEN };
