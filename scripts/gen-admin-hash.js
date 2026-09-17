/**
 * 生成管理员口令哈希（写入云函数环境变量 ADMIN_PASS_HASH）
 *
 * 用法（cmd）：
 *   node scripts/gen-admin-hash.js 你的密码
 *
 * 说明：使用 Node 内置 crypto 的 PBKDF2-SHA256，不引入 bcrypt 等原生依赖，
 *      既避免云函数安装编译失败，也减小代码包体积。
 * 输出格式：pbkdf2$<迭代次数>$<salt-hex>$<hash-hex>
 */

const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.log('用法：node scripts/gen-admin-hash.js <管理员密码>');
  process.exit(1);
}
if (String(password).length < 6) {
  console.warn('警告：密码长度建议不少于 6 位');
}

const ITER = 100000;
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(String(password), salt, ITER, 32, 'sha256').toString('hex');

const encoded = `pbkdf2$${ITER}$${salt}$${hash}`;
console.log('\nADMIN_PASS_HASH=' + encoded);
console.log('\n把上面这行整段填到 CloudBase 控制台 → 云函数 skillswap-api → 环境变量');
console.log('（注意：不要带引号，不要有多余空格）\n');

// 自校验：确认 verify 逻辑能还原
const [scheme, iter, s, h] = encoded.split('$');
const check = crypto.pbkdf2Sync(String(password), s, Number(iter), 32, 'sha256').toString('hex');
console.log('自校验：' + (check === h && scheme === 'pbkdf2' ? '通过 ✓' : '失败 ✗'));
