/**
 * 管理员口令哈希校验（配合 scripts/gen-admin-hash.js 生成的串）
 * 格式：pbkdf2$<迭代次数>$<salt-hex>$<hash-hex>
 * 用 Node 内置 crypto，不引入 bcrypt 等原生依赖（云函数无需编译、包更小）
 */

const crypto = require('crypto');

function verify(password, encoded) {
  if (!password || !encoded) return false;
  const parts = String(encoded).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!iter || !salt || !expected) return false;

  const actual = crypto.pbkdf2Sync(String(password), salt, iter, 32, 'sha256').toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verify };
