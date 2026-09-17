/**
 * 用户领域服务：建号、查询、资料维护
 * 前端不直连数据库，所有读写在此完成
 */

const { db, now, COLLECTIONS } = require('../lib/db');
const { AppError, C } = require('../lib/resp');

const AVATAR_COLORS = ['#2B62E0', '#7A3FE0', '#FF7A45', '#36B37E', '#00A3BF', '#6554C0'];

function pickColor(openid) {
  let sum = 0;
  for (let i = 0; i < openid.length; i++) sum += openid.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function publicFields(u) {
  if (!u) return null;
  return {
    openid: u._openid,
    nickname: u.nickname || '',
    avatarColor: u.avatarColor || AVATAR_COLORS[0],
    studentId: u.studentId || '',
    realName: u.realName || '',
    grade: u.grade || '',
    major: u.major || '',
    tags: u.tags || [],
    contact: u.contact || '',
    status: u.status || 'active',
    goodCount: u.goodCount || 0,
    totalCount: u.totalCount || 0,
    profileCompleted: !!(u.studentId && u.realName),
    createTime: u.createTime || 0,
  };
}

async function findByOpenid(openid) {
  const res = await db(COLLECTIONS.USERS).where({ _openid: openid }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

/** 首次登录自动建号；重复登录不产生重复用户 */
async function ensureUser(openid) {
  const exist = await findByOpenid(openid);
  if (exist) return exist;
  const doc = {
    _openid: openid,
    role: 'user',
    nickname: '',
    avatarColor: pickColor(openid),
    studentId: '',
    realName: '',
    grade: '',
    major: '',
    tags: [],
    contact: '',
    status: 'active',
    goodCount: 0,
    totalCount: 0,
    createTime: now(),
    updateTime: now(),
  };
  await db(COLLECTIONS.USERS).add(doc);
  return doc;
}

async function assertActive(openid) {
  const u = await findByOpenid(openid);
  if (!u) throw new AppError(C.UNAUTHORIZED, '用户不存在，请重新进入小程序');
  if (u.status === 'banned') throw new AppError(C.FORBIDDEN, '账号已被封禁，无法使用该功能');
  return u;
}

function validStudentId(id) {
  return /^\d{8,15}$/.test(String(id || '').trim());
}

async function saveProfile(openid, payload) {
  const u = await assertActive(openid);
  const studentId = String(payload.studentId || '').trim();
  const realName = String(payload.realName || '').trim();
  const grade = String(payload.grade || '').trim();
  const major = String(payload.major || '').trim();
  const contact = String(payload.contact || '').trim();
  let tags = payload.tags;

  if (studentId && !validStudentId(studentId)) {
    throw new AppError(C.BAD_REQUEST, '学号格式不正确，应为 8-15 位数字');
  }
  if (tags && !Array.isArray(tags)) throw new AppError(C.BAD_REQUEST, 'tags 必须是数组');
  if (Array.isArray(tags)) {
    tags = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  }
  if (contact && contact.length > 40) throw new AppError(C.BAD_REQUEST, '联系方式过长');

  const update = {
    studentId,
    realName,
    grade: grade.slice(0, 20),
    major: major.slice(0, 40),
    contact,
    updateTime: now(),
  };
  if (Array.isArray(tags)) update.tags = tags;

  await db(COLLECTIONS.USERS).where({ _openid: openid }).update(update);
  return publicFields(Object.assign({}, u, update));
}

module.exports = {
  publicFields,
  findByOpenid,
  ensureUser,
  assertActive,
  saveProfile,
  validStudentId,
  pickColor,
};
