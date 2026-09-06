const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, ensureDir, readJson, writeJson, uuid } = require('./util');

const STATE_DIR = path.join(DATA_DIR, 'state');
const SETTINGS_PATH = path.join(STATE_DIR, 'settings.json');
const API_KEYS_PATH = path.join(STATE_DIR, 'api_keys.json');
const WEIBO_AUTH_PATH = path.join(STATE_DIR, 'weibo_auth.json');
const TOUTIAO_AUTH_PATH = path.join(STATE_DIR, 'toutiao_auth.json');
const WECHAT_INDEX_PATH = path.join(STATE_DIR, 'wechat_accounts.json');
const WECHAT_DATA_DIR = path.join(STATE_DIR, 'wechat_accounts');
const AUTH_TOKEN_PATH = path.join(STATE_DIR, 'auth_token.json');
const USERS_PATH = path.join(STATE_DIR, 'users.json');

function readSettings() {
  const data = readJson(SETTINGS_PATH, {});
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === '') continue;
    result[key] = String(value);
  }
  return result;
}

function writeSettings(updates) {
  const data = readSettings();
  for (const [key, value] of Object.entries(updates || {})) {
    if (value != null && value !== '') data[key] = String(value);
    else delete data[key];
  }
  writeJson(SETTINGS_PATH, data);
}

function readApiKeys() {
  const data = readJson(API_KEYS_PATH, {});
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v));
}

function writeApiKeys(updates) {
  const data = readApiKeys();
  for (const [key, value] of Object.entries(updates || {})) {
    if (value) data[key] = value;
    else delete data[key];
  }
  writeJson(API_KEYS_PATH, data);
}

function readWeiboAuth() {
  return readJson(WEIBO_AUTH_PATH, {});
}

function writeWeiboAuth(payload = {}) {
  const data = readWeiboAuth();
  for (const key of ['cookie', 'uid', 'screen_name', 'avatar']) {
    if (payload[key]) data[key] = payload[key];
  }
  writeJson(WEIBO_AUTH_PATH, data);
}

function clearWeiboAuth() {
  writeJson(WEIBO_AUTH_PATH, {});
}

function readToutiaoAuth() {
  return readJson(TOUTIAO_AUTH_PATH, {});
}

function writeToutiaoAuth(payload = {}) {
  const data = readToutiaoAuth();
  for (const key of ['cookie', 'uid', 'screen_name', 'avatar']) {
    if (payload[key]) data[key] = payload[key];
  }
  writeJson(TOUTIAO_AUTH_PATH, data);
}

function clearToutiaoAuth() {
  writeJson(TOUTIAO_AUTH_PATH, {});
}

function readWechatAccounts() {
  return readJson(WECHAT_INDEX_PATH, []);
}

function writeWechatAccounts(accounts) {
  writeJson(WECHAT_INDEX_PATH, accounts);
}

function wechatAccountPaths(accountId) {
  return {
    profileDir: path.join(WECHAT_DATA_DIR, accountId, 'chromium_profile'),
    statePath: path.join(WECHAT_DATA_DIR, accountId, 'state.json'),
  };
}

function validateWechatLogin(accountId) {
  const { statePath } = wechatAccountPaths(accountId);
  const data = readJson(statePath, { cookies: [] });
  const now = Math.floor(Date.now() / 1000);
  return (data.cookies || []).some((cookie) => {
    const domain = cookie.domain || '';
    const expires = Number(cookie.expires || 0);
    return domain.includes('weixin.qq.com') && (expires === -1 || expires > now);
  });
}

function listWechatAccounts() {
  const accounts = readWechatAccounts();
  let defaultId = accounts.find((a) => a.is_default)?.account_id || '';
  if (!defaultId && accounts[0]) defaultId = accounts[0].account_id;
  return accounts.map((account) => ({
    account_id: account.account_id,
    name: account.name,
    created_at: account.created_at,
    last_used: account.last_used,
    logged_in: validateWechatLogin(account.account_id),
    is_default: account.account_id === defaultId,
  }));
}

function getWechatAccount(accountId) {
  return readWechatAccounts().find((a) => a.account_id === accountId) || null;
}

function addWechatAccount(name) {
  const accountId = uuid();
  const now = new Date().toISOString();
  const account = {
    account_id: accountId,
    name: name.trim(),
    created_at: now,
    last_used: '',
  };
  const accounts = readWechatAccounts();
  if (!accounts.length) account.is_default = true;
  accounts.push(account);
  writeWechatAccounts(accounts);
  ensureDir(path.join(WECHAT_DATA_DIR, accountId));
  return {
    account_id: accountId,
    name: account.name,
    created_at: now,
    last_used: '',
    logged_in: false,
  };
}

function removeWechatAccount(accountId) {
  const accounts = readWechatAccounts();
  const next = accounts.filter((a) => a.account_id !== accountId);
  if (next.length === accounts.length) return false;
  writeWechatAccounts(next);
  const dir = path.join(WECHAT_DATA_DIR, accountId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function updateWechatAccount(accountId, updates) {
  const accounts = readWechatAccounts();
  const account = accounts.find((a) => a.account_id === accountId);
  if (!account) return false;
  Object.assign(account, updates);
  writeWechatAccounts(accounts);
  return true;
}

function setDefaultWechatAccount(accountId) {
  const accounts = readWechatAccounts();
  const found = accounts.some((a) => a.account_id === accountId);
  if (!found) return false;
  for (const account of accounts) {
    if (account.account_id === accountId) account.is_default = true;
    else delete account.is_default;
  }
  writeWechatAccounts(accounts);
  return true;
}

function readUsers() {
  return readJson(USERS_PATH, {});
}

function writeUsers(users) {
  writeJson(USERS_PATH, users);
}

function loadAuthToken() {
  return readJson(AUTH_TOKEN_PATH, null);
}

function saveAuthToken(token) {
  writeJson(AUTH_TOKEN_PATH, token || null);
}

function clearAuthToken() {
  writeJson(AUTH_TOKEN_PATH, null);
}

module.exports = {
  STATE_DIR,
  SETTINGS_PATH,
  API_KEYS_PATH,
  WECHAT_INDEX_PATH,
  WECHAT_DATA_DIR,
  readSettings,
  writeSettings,
  readApiKeys,
  writeApiKeys,
  readWeiboAuth,
  writeWeiboAuth,
  clearWeiboAuth,
  readToutiaoAuth,
  writeToutiaoAuth,
  clearToutiaoAuth,
  readWechatAccounts,
  writeWechatAccounts,
  wechatAccountPaths,
  validateWechatLogin,
  listWechatAccounts,
  getWechatAccount,
  addWechatAccount,
  removeWechatAccount,
  updateWechatAccount,
  setDefaultWechatAccount,
  readUsers,
  writeUsers,
  loadAuthToken,
  saveAuthToken,
  clearAuthToken,
};
