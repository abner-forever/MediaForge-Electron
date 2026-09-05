const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function getDataDir() {
  if (process.env.MEDIAFORGE_DATA_DIR) {
    return path.resolve(process.env.MEDIAFORGE_DATA_DIR);
  }

  if (process.env.MEDIAFORGE_PACKAGED === '1') {
    if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'MediaForge', 'data');
    }
    if (process.platform === 'darwin') {
      return path.join(process.env.HOME, 'Library', 'Application Support', 'com.mediaforge.app', 'data');
    }
    return path.join(process.env.HOME || '', '.local', 'share', 'MediaForge', 'data');
  }

  return path.join(PROJECT_ROOT, 'data');
}

const DATA_DIR = getDataDir();
const DOWNLOAD_DIR = path.resolve(process.env.MATERIALS_PATH || path.join(DATA_DIR, 'images'));
const TEXT_DIR = path.join(DOWNLOAD_DIR, 'text');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const STATIC_DIR = process.env.MEDIAFORGE_STATIC_DIR
  ? path.resolve(process.env.MEDIAFORGE_STATIC_DIR)
  : path.join(process.env.MEDIAFORGE_PACKAGED === '1' ? process.resourcesPath : PROJECT_ROOT, 'desktop', 'static');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function uuid() {
  return crypto.randomUUID();
}

function maskKey(key) {
  if (!key || key.length <= 12) return key || '';
  return `${key.slice(0, 8)}${'*'.repeat(key.length - 12)}${key.slice(-4)}`;
}

function parseBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
}

function csvList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .replace(/，/g, ',')
    .replace(/;/g, ',')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function stripEmoji(value) {
  return String(value || '').replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,
    '',
  );
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function sanitizeSegment(value) {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'unnamed';
}

function toRel(filePath) {
  const absolute = path.resolve(filePath);
  const rel = path.relative(DOWNLOAD_DIR, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return absolute;
  return rel.split(path.sep).join('/');
}

function toAbs(rel) {
  if (!rel) return '';
  if (path.isAbsolute(rel)) return rel;
  return path.join(DOWNLOAD_DIR, rel);
}

function friendlyError(err) {
  const text = err instanceof Error ? err.message : String(err || '');
  const low = text.toLowerCase();
  if (low.includes('weibo_cookie') || low.includes('cookie 无效')) return '微博登录已失效，请到设置页重新扫码登录。';
  if (low.includes('base url') || low.includes('base_url')) return '当前 AI 服务需要配置 Base URL，请到设置页补全后重试。';
  if (low.includes('api key') || low.includes('unauthorized') || low.includes('401')) return '当前 AI 服务 API Key 不可用，请检查密钥配置。';
  if (low.includes('wechat') || low.includes('mp.weixin') || low.includes('login') || low.includes('扫码')) return '公众号账号未登录，请先在设置页完成扫码登录。';
  if (low.includes('playwright') || low.includes('locator') || low.includes('editor') || low.includes('iframe')) return '微信后台页面结构可能已更新或加载超时，请重试；若仍失败请保留日志排查。';
  return text || '操作失败，请稍后重试。';
}

function parsePublishTime(raw) {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, ...args) {
  console.log(`[MediaForge:${level}]`, ...args);
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  DOWNLOAD_DIR,
  TEXT_DIR,
  LOG_DIR,
  CACHE_DIR,
  STATIC_DIR,
  ensureDir,
  readJson,
  writeJson,
  hashText,
  uuid,
  maskKey,
  parseBool,
  csvList,
  stripEmoji,
  stripHtml,
  sanitizeSegment,
  toRel,
  toAbs,
  friendlyError,
  parsePublishTime,
  sleep,
  log,
};
