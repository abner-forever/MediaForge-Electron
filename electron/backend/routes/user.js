const express = require('express');

const store = require('../store');
const util = require('../util');
const { authMiddleware, createToken, jsonError, passwordHash } = require('./shared');

const router = express.Router();

router.post('/api/user/send-code', (req, res) => res.json({ success: true, message: '验证码已发送（本地模式请使用任意6位验证码）' }));

router.post('/api/user/register', (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.email || !body.password || !body.nickname) return next(jsonError(400, '参数不完整'));
    if (String(body.password).length < 6) return next(jsonError(400, '密码至少6位'));
    const users = store.readUsers();
    if (users[body.email]) return next(jsonError(400, '邮箱已注册'));
    const userId = util.uuid();
    const now = new Date().toISOString();
    const user = { user_id: userId, email: body.email, password_hash: passwordHash(body.password), nickname: body.nickname, avatar: '', is_verified: false, created_at: now, last_login: now, settings: {} };
    users[body.email] = user;
    store.writeUsers(users);
    const token = createToken(user);
    store.saveAuthToken(token);
    res.json({ success: true, message: '注册成功', data: { token, user: { user_id: userId, email: body.email, nickname: body.nickname, avatar: '', is_verified: false, created_at: now, last_login: now } } });
  } catch (err) {
    next(err);
  }
});

router.post('/api/user/login', (req, res, next) => {
  try {
    const body = req.body || {};
    const users = store.readUsers();
    const user = users[body.email];
    if (!user || user.password_hash !== passwordHash(body.password)) return next(jsonError(401, '邮箱或密码错误'));
    user.last_login = new Date().toISOString();
    store.writeUsers(users);
    const token = createToken(user);
    store.saveAuthToken(token);
    res.json({ success: true, message: '登录成功', data: { token, user: { user_id: user.user_id, email: user.email, nickname: user.nickname, avatar: user.avatar || '', is_verified: user.is_verified || false, created_at: user.created_at, last_login: user.last_login } } });
  } catch (err) {
    next(err);
  }
});

router.post('/api/user/login-with-code', (req, res, next) => {
  try {
    const users = store.readUsers();
    const user = users[req.body?.email];
    if (!user) return next(jsonError(400, '邮箱未注册'));
    const token = createToken(user);
    store.saveAuthToken(token);
    res.json({ success: true, message: '登录成功', data: { token, user: { user_id: user.user_id, email: user.email, nickname: user.nickname, avatar: user.avatar || '', is_verified: user.is_verified || false, created_at: user.created_at, last_login: user.last_login } } });
  } catch (err) {
    next(err);
  }
});

router.post('/api/user/reset-password', (req, res, next) => {
  const users = store.readUsers();
  const user = users[req.body?.email];
  if (!user) return next(jsonError(400, '邮箱未注册'));
  if (String(req.body?.new_password).length < 6) return next(jsonError(400, '新密码至少6位'));
  user.password_hash = passwordHash(req.body.new_password);
  store.writeUsers(users);
  res.json({ success: true, message: '密码重置成功' });
});

router.post('/api/user/change-password', authMiddleware, (req, res, next) => {
  const users = store.readUsers();
  const user = Object.values(users).find((item) => item.user_id === req.user.user_id);
  if (!user || user.password_hash !== passwordHash(req.body?.old_password)) return next(jsonError(400, '旧密码错误'));
  if (String(req.body?.new_password).length < 6) return next(jsonError(400, '新密码至少6位'));
  user.password_hash = passwordHash(req.body.new_password);
  store.writeUsers(users);
  res.json({ success: true, message: '密码修改成功' });
});

router.get('/api/user/profile', authMiddleware, (req, res) => {
  const user = Object.values(store.readUsers()).find((item) => item.user_id === req.user.user_id);
  res.json({ success: true, data: user || { user_id: req.user.user_id, email: req.user.email, nickname: req.user.nickname, avatar: req.user.avatar || '' } });
});

router.put('/api/user/profile', authMiddleware, (req, res) => {
  const users = store.readUsers();
  const user = Object.values(users).find((item) => item.user_id === req.user.user_id);
  if (user) {
    if (req.body?.nickname) user.nickname = req.body.nickname;
    if (req.body?.avatar) user.avatar = req.body.avatar;
    store.writeUsers(users);
  }
  res.json({ success: true, message: '更新成功' });
});

router.get('/api/user/settings', authMiddleware, (req, res) => {
  const user = Object.values(store.readUsers()).find((item) => item.user_id === req.user.user_id);
  res.json({ success: true, data: user?.settings || {} });
});

router.put('/api/user/settings', authMiddleware, (req, res) => {
  const users = store.readUsers();
  const user = Object.values(users).find((item) => item.user_id === req.user.user_id);
  if (user) {
    user.settings = req.body?.settings || {};
    store.writeUsers(users);
  }
  res.json({ success: true, message: '更新成功' });
});

router.get('/api/user/devices', authMiddleware, (req, res) => res.json({ success: true, data: [] }));
router.post('/api/user/bind-device', authMiddleware, (req, res) => res.json({ success: true, message: '绑定成功' }));
router.post('/api/user/unbind-device', authMiddleware, (req, res) => res.json({ success: true, message: '解绑成功' }));

router.get('/api/user/check-auth', authMiddleware, (req, res) => res.json({ success: true, authenticated: true, user_id: req.user.user_id, email: req.user.email, nickname: req.user.nickname }));
router.get('/api/user/saved-token', (req, res) => {
  const token = store.loadAuthToken();
  res.json(token ? { success: true, token } : { success: false, token: null });
});
router.post('/api/user/logout', (req, res) => {
  store.clearAuthToken();
  res.json({ success: true });
});
router.get('/api/user/current', authMiddleware, (req, res) => {
  const user = Object.values(store.readUsers()).find((item) => item.user_id === req.user.user_id);
  res.json({ success: true, data: user ? { user_id: user.user_id, email: user.email, nickname: user.nickname, avatar: user.avatar || '', is_verified: user.is_verified || false, created_at: user.created_at, last_login: user.last_login } : { user_id: req.user.user_id, email: req.user.email, nickname: req.user.nickname } });
});

module.exports = router;
