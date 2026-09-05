const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const store = require('../store');
const util = require('../util');

const JWT_SECRET_PATH = path.join(store.STATE_DIR, '.jwt_secret');

function getJwtSecret() {
  let secret = util.readJson(JWT_SECRET_PATH, null);
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    util.writeJson(JWT_SECRET_PATH, secret);
  }
  return secret;
}

function jsonError(status, detail) {
  const error = new Error(typeof detail === 'string' ? detail : '请求失败');
  error.status = status;
  return error;
}

function sse(res, event, data = {}) {
  res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

function sendError(res, err) {
  const status = err.status || 500;
  if (!res.headersSent) res.status(status).json({ detail: util.friendlyError(err) });
}

function abort(res, status, detail) {
  return res.status(status).json({ detail });
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__covers__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt || 'mediaforge', 32).toString('hex');
}

function createToken(user) {
  return jwt.sign({ user_id: user.user_id, email: user.email, nickname: user.nickname, avatar: user.avatar || '', is_verified: user.is_verified || false }, getJwtSecret(), { expiresIn: '30d' });
}

function currentUserFromToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const user = currentUserFromToken(token);
  if (!user) return next(jsonError(401, '认证无效或已过期'));
  req.user = user;
  next();
}

module.exports = {
  abort,
  authMiddleware,
  createToken,
  currentUserFromToken,
  getJwtSecret,
  jsonError,
  passwordHash,
  sendError,
  sse,
  walkFiles,
};
