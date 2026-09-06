const axios = require('axios');
const express = require('express');

const store = require('../store');
const services = require('../services');
const util = require('../util');
const { sse } = require('./shared');

const router = express.Router();

function getSettingsResponse() {
  const cfg = store.readSettings();
  const apiKeys = store.readApiKeys();
  const weibo = store.readWeiboAuth();
  const toutiao = store.readToutiaoAuth();
  const provider = (cfg.AI_PROVIDER || 'mimo').toLowerCase();
  const currentKey = services.getProviderKey(cfg);
  const allKeys = {};
  for (const prov of ['mimo', 'deepseek', 'glm', 'openai', 'minimax']) {
    const key = services.getProviderKey(cfg, prov);
    if (key) allKeys[prov] = util.maskKey(key);
  }
  const weiboCookie = weibo.cookie || cfg.WEIBO_COOKIE || '';
  const toutiaoCookie = toutiao.cookie || cfg.TOUTIAO_COOKIE || '';
  return {
    platform: cfg.PLATFORM || 'weibo',
    ai_provider: provider,
    ai_model: cfg.AI_MODEL || 'mimo-v2.5-pro',
    ai_base_url: cfg.AI_BASE_URL || '',
    ai_api_key_set: Boolean(currentKey),
    ai_api_key_masked: util.maskKey(currentKey),
    ai_api_keys: allKeys,
    tavily_api_key_set: Boolean(cfg.TAVILY_API_KEY || apiKeys.tavily),
    tavily_api_key_masked: util.maskKey(cfg.TAVILY_API_KEY || apiKeys.tavily),
    weibo_uid: weibo.uid || cfg.WEIBO_UID || '',
    weibo_cookie_set: Boolean(weiboCookie),
    weibo_cookie: weiboCookie,
    weibo_screen_name: weibo.screen_name || '',
    weibo_avatar: weibo.avatar || '',
    weibo_fetch_mode: cfg.WEIBO_FETCH_MODE || 'celebrities',
    weibo_celebrities: cfg.WEIBO_CELEBRITIES || '',
    weibo_search_tags: cfg.WEIBO_SEARCH_TAGS || '美图,日常,时装周,美妆,穿搭',
    weibo_scene_extra_tags: cfg.WEIBO_SCENE_EXTRA_TAGS || '',
    weibo_super_topics: cfg.WEIBO_SUPER_TOPICS || '',
    toutiao_cookie_set: Boolean(toutiaoCookie),
    toutiao_cookie: toutiaoCookie,
    toutiao_uid: toutiao.uid || '',
    toutiao_user_id: cfg.TOUTIAO_USER_ID || '',
    toutiao_screen_name: toutiao.screen_name || '',
    toutiao_avatar: toutiao.avatar || '',
    toutiao_fetch_mode: cfg.TOUTIAO_FETCH_MODE || 'feed',
    toutiao_search_tags: cfg.TOUTIAO_SEARCH_TAGS || '时尚,明星,穿搭',
    post_limit: Number(cfg.POST_LIMIT || 3),
    weibo_pages: Number(cfg.WEIBO_PAGES || 2),
    publish_interval: Number(cfg.PUBLISH_INTERVAL_SECONDS || 10),
    request_timeout: Number(cfg.REQUEST_TIMEOUT || 20),
    ai_timeout: Number(cfg.AI_TIMEOUT || 120),
    retry_times: Number(cfg.RETRY_TIMES || 3),
    require_confirm: util.parseBool(cfg.REQUIRE_CONFIRM, true),
    watermark_filter: util.parseBool(cfg.WATERMARK_FILTER, true),
    watermark_strict_mode: util.parseBool(cfg.WATERMARK_STRICT_MODE, true),
    min_clean_images: Number(cfg.MIN_CLEAN_IMAGES || 3),
    watermark_corner_ratio: Number(cfg.WATERMARK_CORNER_RATIO || 1.38),
    watermark_bottom_ratio: Number(cfg.WATERMARK_BOTTOM_RATIO || 1.48),
    allow_watermark_fallback: util.parseBool(cfg.ALLOW_WATERMARK_FALLBACK, false),
    materials_path: cfg.MATERIALS_PATH || '',
    download_dir: util.DOWNLOAD_DIR,
    theme: cfg.APP_THEME || '',
    accent: cfg.APP_ACCENT || '',
    ai_recommended_celebs: cfg.AI_RECOMMENDED_CELEBS || '',
    sidebar_open: cfg.SIDEBAR_OPEN || 'true',
    sidebar_width: cfg.SIDEBAR_WIDTH || '240',
    wechat_accounts: store.listWechatAccounts(),
    smtp_host: cfg.SMTP_HOST || '',
    smtp_port: Number(cfg.SMTP_PORT || 465),
    smtp_secure: util.parseBool(cfg.SMTP_SECURE, true),
    smtp_user: cfg.SMTP_USER || '',
    smtp_pass_set: Boolean(cfg.SMTP_PASS),
    smtp_from: cfg.SMTP_FROM || '',
  };
}

router.get('/api/settings', (req, res) => {
  res.json(getSettingsResponse());
});

router.post('/api/settings', (req, res) => {
  const body = req.body || {};
  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'boolean') updates[key] = value ? 'true' : 'false';
    else if (value != null && value !== '') updates[key] = String(value);
  }

  const apiKeyNames = ['MIMO_API_KEY', 'DEEPSEEK_API_KEY', 'GLM_API_KEY', 'OPENAI_API_KEY', 'QWEN_API_KEY', 'MINIMAX_API_KEY'];
  const apiKeys = {};
  for (const key of apiKeyNames) {
    if (key in updates) {
      apiKeys[key.replace('_API_KEY', '').toLowerCase()] = updates[key];
      delete updates[key];
    }
  }
  if (Object.keys(apiKeys).length) store.writeApiKeys(apiKeys);

  const weiboKeys = {};
  for (const key of ['WEIBO_COOKIE', 'WEIBO_UID', 'WEIBO_SCREEN_NAME', 'WEIBO_AVATAR']) {
    if (key in updates) {
      const normalized = key.toLowerCase();
      if (normalized !== 'cookie' || updates[key]) weiboKeys[normalized] = updates[key];
      delete updates[key];
    }
  }
  if (Object.keys(weiboKeys).length) store.writeWeiboAuth(weiboKeys);

  const toutiaoKeys = {};
  for (const key of ['TOUTIAO_COOKIE', 'TOUTIAO_UID', 'TOUTIAO_SCREEN_NAME', 'TOUTIAO_AVATAR']) {
    if (key in updates) {
      const normalized = key.replace('TOUTIAO_', '').toLowerCase();
      if (normalized !== 'cookie' || updates[key]) toutiaoKeys[normalized] = updates[key];
      delete updates[key];
    }
  }
  if (Object.keys(toutiaoKeys).length) store.writeToutiaoAuth(toutiaoKeys);

  if (Object.keys(updates).length) store.writeSettings(updates);
  res.json({ success: true, message: '配置已保存' });
});

router.get('/api/settings/weibo-login-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    sse(res, 'progress', { message: '正在启动浏览器...' });
    const result = await services.loginWithBrowser('weibo', (event) => sse(res, event.type, event));
    if (!result.success || !result.cookie) {
      sse(res, 'error', { message: result.message || '微博登录失败' });
    } else {
      store.writeWeiboAuth({
        cookie: result.cookie,
        uid: result.uid || '',
        screen_name: result.screen_name || '',
        avatar: result.avatar || '',
      });
      sse(res, 'done', {
        cookie: result.cookie,
        uid: result.uid || '',
        screen_name: result.screen_name || '',
        avatar: result.avatar || '',
      });
    }
  } catch (error) {
    sse(res, 'error', { message: error.message || '微博登录失败' });
  }
  res.end();
});

router.post('/api/settings/weibo-verify', async (req, res, next) => {
  try {
    const stored = store.readWeiboAuth();
    const cfg = store.readSettings();
    const cookie = req.body?.cookie || stored.cookie || cfg.WEIBO_COOKIE || '';
    const result = await services.verifyWeiboCookie(cookie);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api/settings/weibo-clear', (req, res) => {
  store.clearWeiboAuth();
  res.json({ success: true });
});

router.get('/api/settings/toutiao-login-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    sse(res, 'progress', { message: '正在启动浏览器...' });
    const result = await services.loginWithBrowser('toutiao', (event) => sse(res, event.type, event));
    if (!result.success || !result.cookie) {
      sse(res, 'error', { message: result.message || '今日头条登录失败' });
    } else {
      store.writeToutiaoAuth({
        cookie: result.cookie,
        uid: result.uid || '',
        screen_name: result.screen_name || '',
        avatar: result.avatar || '',
      });
      sse(res, 'done', {
        cookie: result.cookie,
        uid: result.uid || '',
        screen_name: result.screen_name || '',
        avatar: result.avatar || '',
      });
    }
  } catch (error) {
    sse(res, 'error', { message: error.message || '今日头条登录失败' });
  }
  res.end();
});

router.post('/api/settings/toutiao-verify', async (req, res, next) => {
  try {
    const stored = store.readToutiaoAuth();
    const cfg = store.readSettings();
    const cookie = req.body?.cookie || stored.cookie || cfg.TOUTIAO_COOKIE || '';
    const result = await services.verifyToutiaoCookie(cookie);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api/settings/toutiao-clear', (req, res) => {
  store.clearToutiaoAuth();
  res.json({ success: true });
});

router.get('/api/settings/theme', (req, res) => {
  const cfg = store.readSettings();
  res.json({ theme: cfg.APP_THEME || '', accent: cfg.APP_ACCENT || '' });
});

router.post('/api/theme/window-native', (req, res) => {
  const { nativeTheme } = require('electron');
  const theme = req.body?.theme || 'auto';
  nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system';
  res.json({ success: true });
});

router.get('/api/settings/api-key', (req, res) => {
  const cfg = store.readSettings();
  const provider = req.query.provider || cfg.AI_PROVIDER || 'mimo';
  res.json({ key: services.getProviderKey(cfg, String(provider).toLowerCase()) });
});

router.post('/api/settings/ai-test', async (req, res, next) => {
  try {
    const cfg = store.readSettings();
    const body = req.body || {};
    const provider = String(body.provider || cfg.AI_PROVIDER || 'mimo').toLowerCase();
    const model = body.model || cfg.AI_MODEL || 'mimo-v2.5-pro';
    const baseUrl = (body.base_url || cfg.AI_BASE_URL || '').replace(/\/$/, '');
    const apiKey = body.api_key || services.getProviderKey(cfg, provider);
    if (!baseUrl || !apiKey) return res.json({ success: false, message: '请先配置 Base URL 和 API Key' });
    const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/chat/completions`;
    const response = await axios.post(url, { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: Number(cfg.AI_TIMEOUT || 30000),
    });
    if (response.status === 200) res.json({ success: true, message: '连接成功' });
    else res.json({ success: false, message: `连接失败（${response.status}）` });
  } catch (err) {
    res.json({ success: false, message: err.response?.data?.error?.message || err.message || '连接失败' });
  }
});

router.post('/api/settings/ai-balance', async (req, res) => {
  try {
    const cfg = store.readSettings();
    const body = req.body || {};
    const provider = String(body.provider || cfg.AI_PROVIDER || 'mimo').toLowerCase();
    const baseUrl = (body.base_url || cfg.AI_BASE_URL || '').replace(/\/$/, '');
    const apiKey = body.api_key || services.getProviderKey(cfg, provider);
    if (!baseUrl || !apiKey) return res.json({ success: false, balance: null, message: '请先配置 Base URL 和 API Key' });
    const headers = { Authorization: `Bearer ${apiKey}` };
    if (provider === 'deepseek') {
      const url = `${baseUrl.replace(/\/v1$/, '')}/user/balance`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      return res.json({ success: true, balance: response.data, message: response.data.is_available ? '可用' : '余额不足' });
    }
    if (provider === 'openai') {
      const response = await axios.get(`${baseUrl}/dashboard/billing/credit_grants`, { headers, timeout: 10000 });
      return res.json({ success: true, balance: response.data });
    }
    const guides = { mimo: 'https://mimo.mi.com/', glm: 'https://open.bigmodel.cn/usercenter/apikeys', qwen: 'https://bailian.console.aliyun.com/', minimax: 'https://platform.minimaxi.com/' };
    const url = guides[provider] || '';
    res.json({ success: false, balance: null, message: url ? `请前往 ${url} 查看余额` : '当前供应商暂不支持余额查询' });
  } catch (err) {
    res.json({ success: false, balance: null, message: `查询失败: ${err.message}` });
  }
});

router.get('/api/pick-folder', async (req, res) => {
  try {
    const { dialog, BrowserWindow } = require('electron');
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openDirectory'] });
    res.json({ path: result.canceled || !result.filePaths[0] ? '' : result.filePaths[0] });
  } catch {
    res.json({ path: '' });
  }
});

router.get('/api/platforms', (req, res) => {
  const platforms = {
    weibo: { id: 'weibo', name: '微博', auth_fields: ['cookie', 'uid'], fetch_modes: { celebrities: '明星列表', own: '本人时间线', mixed: '混合模式', super_topic: '超话抓取', keyword: '关键词搜索' }, default_fetch_mode: 'celebrities', search_params_description: '从微博搜寻明星美图，AI 智能评分筛选' },
    toutiao: { id: 'toutiao', name: '今日头条', auth_fields: ['cookie', 'user_id'], fetch_modes: { feed: '推荐流', user: '用户主页', keyword: '关键词搜索' }, default_fetch_mode: 'keyword', search_params_description: '通过今日头条搜索图文内容' },
  };
  const cfg = store.readSettings();
  res.json({ platforms, default: cfg.PLATFORM || 'weibo' });
});

module.exports = router;
