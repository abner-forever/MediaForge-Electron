const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const sharp = require('sharp');

const { appState, PUBLISH_COST, VIDEOS_DIR } = require('./state');
const store = require('./store');
const services = require('./services');
const util = require('./util');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const JWT_SECRET_PATH = path.join(store.STATE_DIR, '.jwt_secret');

function getJwtSecret() {
  let secret = store.readJson(JWT_SECRET_PATH, null);
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
      weiboKeys[key.toLowerCase()] = updates[key];
      delete updates[key];
    }
  }
  if (Object.keys(weiboKeys).length) store.writeWeiboAuth(weiboKeys);

  const toutiaoKeys = {};
  for (const key of ['TOUTIAO_COOKIE', 'TOUTIAO_UID', 'TOUTIAO_SCREEN_NAME', 'TOUTIAO_AVATAR']) {
    if (key in updates) {
      toutiaoKeys[key.replace('TOUTIAO_', '').toLowerCase()] = updates[key];
      delete updates[key];
    }
  }
  if (Object.keys(toutiaoKeys).length) store.writeToutiaoAuth(toutiaoKeys);

  if (Object.keys(updates).length) store.writeSettings(updates);
  res.json({ success: true, message: '配置已保存' });
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

router.get('/api/pick-folder', async (req, res, next) => {
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

// Discovery
router.get('/api/discovery', (req, res) => {
  res.json({ posts: appState.getDiscoveryResults() });
});

router.post('/api/discovery/search', async (req, res, next) => {
  try {
    const body = req.body || {};
    const posts = await services.fetchPosts(body.platform || 'weibo', body.mode || 'celebrities', {
      maxPages: body.max_pages || 2,
      postLimit: body.post_limit || 5,
      celebrities: body.celebrities || [],
      searchTags: body.search_tags || [],
      superTopics: body.super_topics || [],
    });
    const limited = posts.slice(0, body.post_limit || 5);
    appState.setDiscoveryResults(limited);
    const totalImages = limited.reduce((sum, post) => sum + (post.images || []).length, 0);
    appState.addOperation('搜索', `平台=${body.platform} 模式=${body.mode}，发现 ${limited.length} 篇帖子共 ${totalImages} 张图`);
    res.json({ success: true, posts: limited, total_posts: limited.length, total_images: totalImages });
  } catch (err) {
    next(jsonError(500, `搜索失败: ${err.message}`));
  }
});

router.get('/api/discovery/search-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const q = req.query;
  try {
    sse(res, 'progress', { message: '正在搜索…' });
    const posts = await services.fetchPosts(q.platform || 'weibo', q.mode || 'celebrities', {
      maxPages: 1,
      specificPage: Number(q.page || 1),
      postLimit: Number(q.post_limit || 5),
      celebrities: util.csvList(q.celebrities),
      searchTags: util.csvList(q.search_tags),
      superTopics: util.csvList(q.super_topics),
    });
    appState.setDiscoveryResults(posts);
    sse(res, 'done', { total_posts: posts.length, total_images: posts.reduce((sum, p) => sum + (p.images || []).length, 0) });
  } catch (err) {
    sse(res, 'error', { message: err.message });
  }
  res.end();
});

router.post('/api/discovery/download', async (req, res, next) => {
  try {
    const posts = appState.getDiscoveryResults();
    if (!posts.length) return next(jsonError(400, '没有搜索结果，请先搜索'));
    const body = req.body || {};
    const indices = body.post_indices && body.post_indices.length ? body.post_indices : posts.map((_, i) => i);
    const results = [];
    let downloaded = 0;
    for (const index of indices) {
      if (index < 0 || index >= posts.length) continue;
      const post = posts[index];
      const celebrity = util.sanitizeSegment(post.celebrity || '未命名');
      const scene = util.sanitizeSegment(post.scene || '日常');
      const slug = util.sanitizeSegment((post.text || post.id || '').slice(0, 12) || 'post');
      const localImages = [];
      for (let i = 0; i < (post.images || []).length; i += 1) {
        const url = post.images[i];
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const dest = path.join(util.DOWNLOAD_DIR, celebrity, scene, `${slug.slice(0, 8)}_${i + 1}_${util.hashText(url).slice(0, 8)}${ext}`);
        try {
          await services.downloadImage(url, dest);
          localImages.push(util.toRel(dest));
          downloaded += 1;
        } catch {
          // Continue downloading other images.
        }
      }
      post.local_images = localImages;
      post.dropped_count = Math.max(0, (post.images || []).length - localImages.length);
      results.push({ celebrity: post.celebrity, scene: post.scene, downloaded: localImages.length, dropped: post.dropped_count });
    }
    appState.setDiscoveryResults(posts);
    res.json({ success: true, posts, results, total_downloaded: downloaded });
  } catch (err) {
    next(err);
  }
});

router.delete('/api/discovery/post/:index', (req, res, next) => {
  const posts = appState.getDiscoveryResults();
  const index = Number(req.params.index);
  if (index < 0 || index >= posts.length) return next(jsonError(404, '帖子不存在'));
  const removed = posts.splice(index, 1)[0];
  appState.setDiscoveryResults(posts);
  res.json({ success: true, removed: removed.celebrity || '', remaining: posts.length });
});

router.post('/api/discovery/score', (req, res, next) => {
  try {
    const body = req.body || {};
    let paths = (body.image_paths || []).map((p) => util.toAbs(p));
    if (!paths.length) {
      const posts = appState.getDiscoveryResults();
      paths = posts.flatMap((post) => (post.local_images || []).map((p) => util.toAbs(p)));
    }
    const scores = {};
    for (const filePath of paths) {
      if (!fs.existsSync(filePath)) continue;
      const info = services.scoreImage(fs.readFileSync(filePath), Boolean(body.use_vision));
      scores[util.toRel(filePath)] = info;
    }
    appState.setImageScores(scores);
    const values = Object.values(scores);
    res.json({ success: true, scores, vision_count: values.filter((v) => v.method === 'vision').length, heuristic_count: values.filter((v) => v.method === 'heuristic').length });
  } catch (err) {
    next(err);
  }
});

router.get('/api/discovery/trending-celebrities', async (req, res) => {
  try {
    const celebrities = await services.recommendCelebrities();
    if (celebrities.length) store.writeSettings({ AI_RECOMMENDED_CELEBS: celebrities.join(',') });
    res.json({ celebrities });
  } catch {
    res.json({ celebrities: ['迪丽热巴', '杨幂', '赵丽颖', '刘亦菲', '杨紫', '白鹿', '虞书欣', '赵露思', '关晓彤', '周也'] });
  }
});

router.get('/api/discovery/download-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const posts = appState.getDiscoveryResults();
  const indices = req.query.indices ? String(req.query.indices).split(',').map(Number).filter(Number.isInteger) : posts.map((_, i) => i);
  const total = indices.reduce((sum, index) => sum + (posts[index]?.images?.length || 0), 0);
  sse(res, 'start', { total });
  let current = 0;
  let downloaded = 0;
  let dropped = 0;
  for (const index of indices) {
    const post = posts[index];
    if (!post) continue;
    const celebrity = util.sanitizeSegment(post.celebrity || '未命名');
    const scene = util.sanitizeSegment(post.scene || '日常');
    const slug = util.sanitizeSegment((post.text || post.id || '').slice(0, 12) || 'post');
    const local = [];
    for (let i = 0; i < (post.images || []).length; i += 1) {
      current += 1;
      const url = post.images[i];
      const dest = path.join(util.DOWNLOAD_DIR, celebrity, scene, `${slug.slice(0, 8)}_${i + 1}_${util.hashText(url).slice(0, 8)}${path.extname(new URL(url).pathname) || '.jpg'}`);
      try {
        await services.downloadImage(url, dest);
        downloaded += 1;
        local.push(util.toRel(dest));
      } catch {
        dropped += 1;
      }
      sse(res, 'progress', { current, total, celebrity: post.celebrity, scene: post.scene, downloaded, dropped });
    }
    post.local_images = local;
    post.dropped_count = Math.max(0, (post.images || []).length - local.length);
  }
  appState.setDiscoveryResults(posts);
  sse(res, 'done', { downloaded, dropped });
  res.end();
});

router.post('/api/discovery/check-watermark', async (req, res, next) => {
  try {
    const watermarked = [];
    for (const rel of req.body || []) {
      const filePath = util.toAbs(rel);
      if (!fs.existsSync(filePath)) continue;
      const metrics = await services.watermarkMetrics(filePath);
      if (metrics.cornerRatio >= 1.2 || metrics.bottomRatio >= 1.15) watermarked.push(rel);
    }
    res.json({ watermarked });
  } catch (err) {
    next(err);
  }
});

router.get('/api/selection', (req, res) => {
  res.json({ selected: appState.getSelectedImages(), scores: appState.getImageScores() });
});

router.post('/api/selection/add', (req, res) => {
  appState.addSelectedImage(req.body?.path || '');
  res.json({ selected: appState.getSelectedImages() });
});

router.post('/api/selection/remove', (req, res) => {
  appState.removeSelectedImage(req.body?.path || '');
  res.json({ selected: appState.getSelectedImages() });
});

router.post('/api/selection/clear', (req, res) => {
  appState.clearSelectedImages();
  res.json({ selected: [] });
});

// Publish queue
router.get('/api/queue', (req, res) => {
  res.json({ queue: appState.getQueue() });
});

router.post('/api/queue', (req, res) => {
  const body = req.body || {};
  const images = body.images || [];
  const item = appState.addToQueue({
    title: body.title || '',
    desc: body.desc || '',
    images,
    cover: body.cover || images[0] || '',
  });
  res.json({ success: true, queue: appState.getQueue() });
});

router.put('/api/queue/:item_id', (req, res, next) => {
  const item = appState.getQueueItemById(req.params.item_id);
  if (!item) return next(jsonError(404, '队列项不存在'));
  const body = req.body || {};
  const updates = {};
  for (const key of ['title', 'desc', 'images', 'cover', 'account_id', 'status']) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (updates.title) updates.title = util.stripEmoji(updates.title);
  appState.updateQueueItemById(req.params.item_id, updates);
  res.json({ success: true, queue: appState.getQueue() });
});

router.delete('/api/queue/:item_id', (req, res, next) => {
  const item = appState.getQueueItemById(req.params.item_id);
  if (!item) return next(jsonError(404, '队列项不存在'));
  appState.removeQueueItemById(req.params.item_id);
  res.json({ success: true, queue: appState.getQueue() });
});

router.delete('/api/queue/:item_id/image', (req, res, next) => {
  const item = appState.getQueueItemById(req.params.item_id);
  if (!item) return next(jsonError(404, '队列项不存在'));
  const imagePath = req.query.image_path;
  if (!imagePath || !item.images.includes(imagePath)) return next(jsonError(404, '图片不存在'));
  const images = item.images.filter((img) => img !== imagePath);
  const updates = { images };
  if (item.cover === imagePath) updates.cover = images[0] || '';
  appState.updateQueueItemById(req.params.item_id, updates);
  res.json({ success: true, queue: appState.getQueue() });
});

router.post('/api/queue/:item_id/remove-watermark', async (req, res, next) => {
  const item = appState.getQueueItemById(req.params.item_id);
  if (!item) return next(jsonError(404, '队列项不存在'));
  const filePath = util.toAbs(req.query.image_path || '');
  if (!fs.existsSync(filePath)) return next(jsonError(404, '图片文件不存在'));
  const result = await services.removeWatermark(filePath);
  res.json({ ...result, queue: appState.getQueue() });
});

router.post('/api/queue/:item_id/remove-watermarks', async (req, res, next) => {
  const item = appState.getQueueItemById(req.params.item_id);
  if (!item) return next(jsonError(404, '队列项不存在'));
  const images = item.images || [];
  const results = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const image of images) {
    const filePath = util.toAbs(image);
    if (!fs.existsSync(filePath)) {
      results.push({ image, success: false, message: '文件不存在' });
      failed += 1;
      continue;
    }
    const result = await services.removeWatermark(filePath);
    results.push({ image, ...result });
    if (result.success && result.action === 'processed') processed += 1;
    else if (result.success) skipped += 1;
    else failed += 1;
  }
  res.json({ success: true, processed, skipped, failed, total: images.length, results, queue: appState.getQueue() });
});

router.post('/api/queue/:item_id/generate', async (req, res, next) => {
  try {
    const item = appState.getQueueItemById(req.params.item_id);
    if (!item) return next(jsonError(404, '队列项不存在'));
    const celebrity = item.celebrity || '';
    const originalTitle = item.title || '';
    const originalDesc = item.desc || '';
    const inputText = (originalDesc || originalTitle || '').trim();
    if (!inputText) {
      const newDesc = celebrity ? `${celebrity} | 今日美图分享` : '今日美图分享';
      appState.updateQueueItemById(req.params.item_id, { title: newDesc.slice(0, 20), desc: newDesc });
      return res.json({ success: true, title: newDesc.slice(0, 20), desc: newDesc, message: '' });
    }
    if (!services.settings().aiApiKey) return res.json({ success: false, title: originalTitle, desc: originalDesc, message: '暂未配置APIKey' });
    const text = await services.polishQueueCaption(inputText);
    const aiDesc = util.stripEmoji(text).trim().slice(0, 200);
    const title = aiDesc.includes(' | ') ? aiDesc : `${celebrity ? `${celebrity} | ` : ''}${aiDesc}`;
    appState.updateQueueItemById(req.params.item_id, { title: title.slice(0, 60), desc: aiDesc });
    res.json({ success: true, title: title.slice(0, 60), desc: aiDesc, message: '' });
  } catch (err) {
    next(err);
  }
});

router.post('/api/queue/:item_id/publish', (req, res, next) => {
  const item = appState.getQueueItemById(req.params.item_id);
  if (!item) return next(jsonError(404, '队列项不存在'));
  const body = req.body || {};
  if (!body.dry_run && !body.save_draft && appState.getCreditsBalance() < PUBLISH_COST) {
    return next(jsonError(402, `积分不足，当前余额 ${appState.getCreditsBalance()} 积分，发布需要 ${PUBLISH_COST} 积分。请先签到或获取积分。`));
  }
  appState.clearPublishLogs(req.params.item_id);
  appState.updateQueueItemById(req.params.item_id, { publish_logs: [], status: 'publishing' });
  appState.addPublishLog('发布任务已启动', req.params.item_id);
  // For a Node-only shell, the WeChat publisher is invoked asynchronously.
  services.wechatPublish({ title: item.title, content: item.desc, images: item.images, cover: item.cover, dryRun: body.dry_run, saveDraft: body.save_draft, accountId: body.account_id }).then((result) => {
    appState.finishPublish();
    if (result.success) {
      const status = body.save_draft ? 'saved_to_wechat' : 'published';
      appState.updateQueueItemById(req.params.item_id, { status, error: '' });
      if (!body.save_draft && !body.dry_run) appState.spendCredits(PUBLISH_COST, 'publish', `发布文章「${item.title}」`);
    } else {
      appState.updateQueueItemById(req.params.item_id, { status: 'failed', error: result.message || '发布失败' });
    }
  }).catch((err) => {
    appState.finishPublish();
    appState.updateQueueItemById(req.params.item_id, { status: 'failed', error: err.message });
  });
  res.json({ success: true, started: true, message: '发布任务已启动' });
});

router.get('/api/publish-logs', (req, res) => {
  const after = Number(req.query.after || 0);
  const logs = appState.getPublishLogs(req.query.session_id || '');
  res.json({ logs: logs.slice(after), total: logs.length, active: appState.publishActive });
});

router.post('/api/queue/enqueue-selected', (req, res, next) => {
  const body = req.body || {};
  const selected = body.images && body.images.length ? body.images : appState.getSelectedImages();
  if (!selected.length) return next(jsonError(400, '没有选中的图片'));
  let sampleText = '';
  let celebrity = '';
  for (const post of appState.getDiscoveryResults()) {
    if ((post.local_images || []).some((img) => selected.includes(img))) {
      sampleText = post.text || '';
      celebrity = post.celebrity || post.screen_name || '';
      break;
    }
  }
  const truncated = sampleText.slice(0, 20);
  const title = celebrity && truncated ? `${celebrity} | ${truncated}` : celebrity || truncated || '美图分享';
  const cover = services.selectCover(selected);
  const ordered = selected[0] === cover ? selected : [cover, ...selected.filter((img) => img !== cover)];
  appState.addToQueue({ title, desc: '', images: ordered, cover, celebrity });
  appState.clearSelectedImages();
  res.json({ success: true, title, desc: '' });
});

// Materials
function listMaterialsGroups() {
  const root = util.DOWNLOAD_DIR;
  if (!fs.existsSync(root)) return { groups: [], total_images: 0 };
  const groups = [];
  let totalImages = 0;
  for (const celebName of fs.readdirSync(root)) {
    const celebDir = path.join(root, celebName);
    if (!fs.statSync(celebDir).isDirectory() || celebName.startsWith('.') || celebName === '__covers__') continue;
    const celeb = { celebrity: celebName, scenes: [], total: 0 };
    for (const sceneName of fs.readdirSync(celebDir)) {
      const sceneDir = path.join(celebDir, sceneName);
      if (!fs.statSync(sceneDir).isDirectory()) continue;
      const scene = { scene: sceneName, posts: [], total: 0 };
      for (const postName of fs.readdirSync(sceneDir)) {
        const postDir = path.join(sceneDir, postName);
        if (!fs.statSync(postDir).isDirectory()) continue;
        const images = fs.readdirSync(postDir).filter((file) => ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(file).toLowerCase())).map((file) => path.join(postDir, file));
        if (images.length) {
          scene.posts.push({ post_id: postName, images });
          scene.total += images.length;
          totalImages += images.length;
        }
      }
      if (scene.posts.length) {
        celeb.scenes.push(scene);
        celeb.total += scene.total;
      }
    }
    if (celeb.scenes.length) groups.push(celeb);
  }
  return { groups, total_images: totalImages };
}

router.get('/api/materials', (req, res) => {
  res.json(listMaterialsGroups());
});

router.delete('/api/materials', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  let deleted = 0;
  for (const rel of req.body?.paths || []) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(path.resolve(root))) continue;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.unlinkSync(target);
      deleted += 1;
    }
  }
  res.json({ success: true, deleted });
});

router.get('/api/materials/tree', (req, res) => {
  res.json({ tree: [] });
});

router.get('/api/materials/browse', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const target = req.query.path ? path.resolve(root, String(req.query.path)) : root;
  if (!target.startsWith(path.resolve(root))) return abort(res, 403, '路径越界');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return abort(res, 404, `文件夹不存在: ${req.query.path}`);
  const folders = [];
  const files = [];
  for (const name of fs.readdirSync(target)) {
    const full = path.join(target, name);
    if (name.startsWith('.') || name === '__covers__') continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) folders.push({ name, path: path.relative(root, full).split(path.sep).join('/'), type: 'folder', item_count: 0 });
    else files.push({ name, path: path.relative(root, full).split(path.sep).join('/'), type: 'file', size: stat.size, suffix: path.extname(name).toLowerCase() });
  }
  res.json({ folders, files, breadcrumb: [{ name: '全部素材', path: '' }] });
});

router.put('/api/materials/sort-order', (req, res) => {
  appState.setFolderSortOrder(req.body?.path || '', req.body?.order || []);
  res.json({ success: true });
});

router.get('/api/materials/sort-order', (req, res) => {
  res.json({ path: req.query.path || '', order: appState.getFolderSortOrder(req.query.path || '') });
});

router.post('/api/materials/folder', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const parent = req.body?.parent_path ? path.resolve(root, req.body.parent_path) : root;
  const target = path.join(parent, req.body?.name || '新建文件夹');
  fs.mkdirSync(target, { recursive: true });
  res.json({ success: true, path: path.relative(root, target).split(path.sep).join('/') });
});

router.put('/api/materials/folder', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const target = path.resolve(root, req.body?.path || '');
  const next = path.join(path.dirname(target), req.body?.new_name || '');
  fs.renameSync(target, next);
  res.json({ success: true, path: path.relative(root, next).split(path.sep).join('/') });
});

router.put('/api/materials/file', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const target = path.resolve(root, req.body?.path || '');
  const next = path.join(path.dirname(target), req.body?.new_name || '');
  fs.renameSync(target, next);
  res.json({ success: true, path: path.relative(root, next).split(path.sep).join('/') });
});

router.delete('/api/materials/folder', (req, res) => {
  const target = path.resolve(util.DOWNLOAD_DIR, String(req.query.path || ''));
  if (!fs.existsSync(target)) return abort(res, 404, `文件夹不存在: ${req.query.path}`);
  fs.rmSync(target, { recursive: true, force: true });
  res.json({ success: true });
});

router.post('/api/materials/move', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const dest = req.body?.destination ? path.resolve(root, req.body.destination) : root;
  let moved = 0;
  for (const rel of req.body?.items || []) {
    const source = path.resolve(root, rel);
    if (!fs.existsSync(source)) continue;
    const next = path.join(dest, path.basename(source));
    fs.renameSync(source, next);
    moved += 1;
  }
  res.json({ success: true, moved });
});

router.get('/api/materials/file/*', (req, res) => {
  const rel = req.params[0];
  const target = path.resolve(util.DOWNLOAD_DIR, rel);
  if (!target.startsWith(path.resolve(util.DOWNLOAD_DIR)) || !fs.existsSync(target)) return abort(res, 404, '文件不存在');
  const mime = { '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  fs.createReadStream(target).pipe(res);
});

router.post('/api/materials/upload', upload.single('file'), (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const parent = req.body?.parent_path ? path.resolve(root, req.body.parent_path) : root;
  const file = req.file;
  if (!file) return abort(res, 400, '缺少文件');
  const name = path.basename(file.originalname);
  const target = path.join(parent, name);
  fs.writeFileSync(target, file.buffer);
  res.json({ success: true, path: path.relative(root, target).split(path.sep).join('/'), name, size: file.size, suffix: path.extname(name).toLowerCase() });
});

router.post('/api/materials/score', (req, res) => {
  const paths = (req.body?.image_paths || []).map((p) => util.toAbs(p));
  const scores = {};
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue;
    const info = services.scoreImage(fs.readFileSync(filePath), Boolean(req.body?.use_vision));
    scores[util.toRel(filePath)] = info;
    appState.updateMaterialsMeta(util.toRel(filePath), { scored: true, score: info.score, score_reason: info.reason });
  }
  const values = Object.values(scores);
  res.json({ success: true, scores, vision_count: values.filter((v) => v.method === 'vision').length, heuristic_count: values.filter((v) => v.method === 'heuristic').length });
});

router.get('/api/materials/meta', (req, res) => {
  res.json({ meta: appState.getMaterialsMeta(req.query.path || null) });
});

router.put('/api/materials/meta', (req, res) => {
  const body = req.body || {};
  if (!body.path) return abort(res, 400, '缺少 path');
  const updates = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'path'));
  appState.updateMaterialsMeta(body.path, updates);
  res.json({ success: true, meta: appState.getMaterialsMeta(body.path) });
});

router.get('/api/materials/tags', (req, res) => {
  res.json(appState.getAllMaterialsTags());
});

// Articles
router.get('/api/articles', (req, res) => {
  res.json({ articles: appState.getArticles(req.query.status || null) });
});

router.post('/api/articles', (req, res) => {
  const article = appState.addArticle(req.body || {});
  appState.addOperation('创建文章', `「${article.title || '无标题'}」`);
  res.json({ success: true, article });
});

router.get('/api/articles/inspiration', async (req, res) => {
  const keyword = req.query.keyword || '';
  if (!keyword) return res.json({ topics: [] });
  try {
    const posts = await services.fetchPosts('weibo', 'keyword', { maxPages: 1, searchTags: [keyword] });
    res.json({ topics: posts.slice(0, 20).map((post) => ({ text: (post.text || '').slice(0, 100), source: 'weibo', celebrity: post.celebrity, screen_name: post.screen_name })) });
  } catch {
    res.json({ topics: [] });
  }
});

router.get('/api/articles/cover-search', async (req, res) => {
  const keyword = String(req.query.keyword || '').toLowerCase();
  const images = [];
  const seen = new Set();
  if (fs.existsSync(util.DOWNLOAD_DIR)) {
    for (const file of walkFiles(util.DOWNLOAD_DIR)) {
      if (images.length >= 50) break;
      if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(file).toLowerCase())) continue;
      const rel = path.relative(util.DOWNLOAD_DIR, file).split(path.sep).join('/');
      if (keyword && !rel.toLowerCase().includes(keyword)) continue;
      images.push({ path: rel, name: path.basename(file), source: 'local', celebrity: rel.split('/')[0] || '' });
      seen.add(rel);
    }
  }
  res.json({ images });
});

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

router.post('/api/articles/cover-download', async (req, res, next) => {
  try {
    const url = req.body?.url;
    if (!url) return next(jsonError(400, '缺少图片 URL'));
    const coversDir = path.join(util.DOWNLOAD_DIR, '__covers__');
    fs.mkdirSync(coversDir, { recursive: true });
    const dest = path.join(coversDir, `${util.uuid()}.jpg`);
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    let buffer = Buffer.from(response.data);
    try {
      buffer = await sharp(buffer).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch {
      // Keep original bytes.
    }
    fs.writeFileSync(dest, buffer);
    res.json({ success: true, path: util.toRel(dest) });
  } catch (err) {
    next(jsonError(502, `下载封面图片失败: ${err.message}`));
  }
});

router.get('/api/articles/:article_id', (req, res, next) => {
  const article = appState.getArticle(req.params.article_id);
  if (!article) return next(jsonError(404, '文章不存在'));
  res.json({ article });
});

router.put('/api/articles/:article_id', (req, res, next) => {
  const article = appState.updateArticle(req.params.article_id, req.body || {});
  if (!article) return next(jsonError(404, '文章不存在'));
  res.json({ success: true, article });
});

router.delete('/api/articles/:article_id', (req, res, next) => {
  if (!appState.deleteArticle(req.params.article_id)) return next(jsonError(404, '文章不存在'));
  res.json({ success: true });
});

router.post('/api/articles/:article_id/save-to-materials', (req, res, next) => {
  const article = appState.getArticle(req.params.article_id);
  if (!article) return next(jsonError(404, '文章不存在'));
  const title = article.title || '无标题';
  const slug = title.replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 60) || `article_${req.params.article_id.slice(0, 8)}`;
  const articlesDir = path.join(util.TEXT_DIR, 'articles');
  fs.mkdirSync(articlesDir, { recursive: true });
  const filePath = path.join(articlesDir, `${slug}.md`);
  const lines = ['---', `title: ${title}`, `created_at: ${new Date().toISOString()}`, `source: article_${req.params.article_id.slice(0, 8)}`, '---', '', `# ${title}`, '', article.content || ''];
  fs.writeFileSync(filePath, lines.join('\n'));
  appState.addOperation('保存到素材', `文章「${title}」`);
  res.json({ success: true, path: `text/articles/${slug}.md`, cover_path: '' });
});

router.post('/api/articles/:article_id/generate', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    const body = req.body || {};
    const topic = body.topic || article.source || article.title || '';
    if (!topic) return next(jsonError(400, '缺少话题或标题'));
    const content = await services.generateArticle(topic, body.title || article.title, body);
    appState.updateArticle(req.params.article_id, { content, ai_generated: true });
    res.json({ success: true, content });
  } catch (err) {
    next(jsonError(502, err.message));
  }
});

router.post('/api/articles/:article_id/polish', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    if (!article.content) return next(jsonError(400, '正文为空，无法校对'));
    const content = await services.polishArticle(article.content);
    appState.updateArticle(req.params.article_id, { content });
    res.json({ success: true, content });
  } catch (err) {
    next(jsonError(502, err.message));
  }
});

router.post('/api/articles/:article_id/de-ai', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    if (!article.content) return next(jsonError(400, '正文为空'));
    const content = await services.deAiArticle(article.content);
    appState.updateArticle(req.params.article_id, { content });
    res.json({ success: true, content });
  } catch (err) {
    next(jsonError(502, err.message));
  }
});

router.post('/api/articles/:article_id/generate-title', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    if (!article.content) return next(jsonError(400, '正文为空'));
    const title = await services.generateTitle(article.content);
    if (title) appState.updateArticle(req.params.article_id, { title });
    res.json({ success: Boolean(title), title });
  } catch (err) {
    next(jsonError(502, err.message));
  }
});

router.post('/api/articles/:article_id/title-candidates', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    if (!article.content) return next(jsonError(400, '正文为空'));
    const candidates = await services.generateTitleCandidates(article.content);
    res.json({ success: Boolean(candidates.length), candidates });
  } catch (err) {
    next(jsonError(502, err.message));
  }
});

router.post('/api/articles/:article_id/optimize-layout', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    if (!article.content) return next(jsonError(400, '正文为空'));
    const content = await services.aiChat([{ role: 'user', content: `请优化以下文章的排版结构，增加合适的段落和小标题，保持内容不变：\n${article.content}` }]);
    appState.updateArticle(req.params.article_id, { content });
    res.json({ success: true, content });
  } catch (err) {
    next(jsonError(502, err.message));
  }
});

router.post('/api/articles/:article_id/chat', async (req, res, next) => {
  try {
    const article = appState.getArticle(req.params.article_id);
    if (!article) return next(jsonError(404, '文章不存在'));
    const instruction = String(req.body?.instruction || '').trim();
    if (!instruction) return next(jsonError(400, '请输入指令'));
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const stream = await services.aiChatStream([{ role: 'user', content: `文章：\n${article.content || ''}\n\n用户指令：${instruction}` }]);
    let content = '';
    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content || '';
      content += token;
      sse(res, 'content', { token });
    }
    if (req.body?.write_mode !== false) {
      appState.updateArticle(req.params.article_id, { content, ai_generated: true });
    }
    sse(res, 'done', { content });
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post('/api/articles/:article_id/queue', (req, res, next) => {
  const article = appState.getArticle(req.params.article_id);
  if (!article) return next(jsonError(404, '文章不存在'));
  const contentHtml = services.buildHtml(article.content, article.images);
  appState.addToQueue({ title: article.title, desc: contentHtml, images: article.images, cover: article.cover, celebrity: article.celebrity, type: 'article', article_id: article.id, tags: article.tags, content: article.content });
  appState.updateArticle(req.params.article_id, { status: 'queued' });
  res.json({ success: true, queue: appState.getQueue() });
});

router.post('/api/articles/:article_id/publish', (req, res, next) => {
  const article = appState.getArticle(req.params.article_id);
  if (!article) return next(jsonError(404, '文章不存在'));
  const body = req.body || {};
  if (!body.dry_run && !body.save_draft && appState.getCreditsBalance() < PUBLISH_COST) return next(jsonError(402, '积分不足'));
  appState.clearPublishLogs();
  appState.addPublishLog('发布任务已启动');
  services.wechatPublish({ title: article.title, content: services.buildHtml(article.content, article.images), images: article.images, cover: article.cover, dryRun: body.dry_run, saveDraft: body.save_draft, accountId: body.account_id }).then((result) => {
    appState.finishPublish();
    appState.updateArticle(req.params.article_id, { status: result.success ? (body.save_draft ? 'saved_to_wechat' : 'published') : 'failed' });
  }).catch(() => {
    appState.finishPublish();
    appState.updateArticle(req.params.article_id, { status: 'failed' });
  });
  res.json({ success: true, started: true, message: '发布任务已启动' });
});

router.get('/api/compliance/duplicate', (req, res) => {
  const title = String(req.query.title || '').trim().toLowerCase();
  if (!title) return res.json({ duplicates: [] });
  const duplicates = [];
  for (const item of appState.getQueue()) {
    const existing = String(item.title || '').toLowerCase();
    if (existing && (existing === title || (title.length > 4 && (existing.startsWith(title) || title.startsWith(existing))))) duplicates.push({ title: item.title, status: item.status || 'queued', type: 'queue' });
  }
  res.json({ duplicates: duplicates.slice(0, 5) });
});

// Effects
function effectsSummary() {
  const effects = appState.getPublishEffects();
  const values = Object.values(effects);
  if (!values.length) return { total_posts: 0, total_reads: 0, total_likes: 0, avg_reads: 0, avg_likes: 0, best_publish_hour: 0, best_day_of_week: 0, top_celebrities: [] };
  const totalReads = values.reduce((sum, item) => sum + Number(item.reads || 0), 0);
  const totalLikes = values.reduce((sum, item) => sum + Number(item.likes || 0), 0);
  return { total_posts: values.length, total_reads: totalReads, total_likes: totalLikes, avg_reads: Math.round(totalReads / values.length), avg_likes: Math.round(totalLikes / values.length), best_publish_hour: 0, best_day_of_week: 0, top_celebrities: [] };
}

router.get('/api/effects/summary', (req, res) => res.json(effectsSummary()));

function effectValues() {
  return Object.entries(appState.getPublishEffects()).map(([itemId, item]) => ({ ...item, item_id: itemId }));
}

function groupEffects(key) {
  const groups = {};
  for (const item of effectValues()) {
    const value = item[key] || '未知';
    if (!groups[value]) groups[value] = { key: value, reads: 0, likes: 0, posts: 0 };
    groups[value].reads += Number(item.reads || 0);
    groups[value].likes += Number(item.likes || 0);
    groups[value].posts += 1;
  }
  return Object.values(groups).sort((a, b) => b.reads - a.reads);
}

router.get('/api/effects/trend', (req, res) => {
  const effects = effectValues();
  const buckets = {};
  for (const item of effects) {
    const date = util.parsePublishTime(item.publish_time);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    if (!buckets[key]) buckets[key] = { date: key, reads: 0, likes: 0, posts: 0, comments: 0, shares: 0, favorites: 0 };
    buckets[key].reads += Number(item.reads || 0);
    buckets[key].likes += Number(item.likes || 0);
    buckets[key].posts += 1;
    buckets[key].comments += Number(item.comment_num || item.comments || 0);
    buckets[key].shares += Number(item.shares || 0);
    buckets[key].favorites += Number(item.favorites || 0);
  }
  res.json({ trend: Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date)) });
});

router.get('/api/effects/compare', (req, res) => {
  res.json({ by_source_platform: groupEffects('source_platform'), by_content_type: groupEffects('content_type'), by_celebrity: groupEffects('celebrity') });
});

router.get('/api/effects/celebrity-rank', (req, res) => {
  const celebrities = groupEffects('celebrity').map((item) => ({ name: item.key, avg_reads: Math.round(item.reads / item.posts), count: item.posts })).slice(0, 10);
  res.json({ celebrities });
});

router.get('/api/effects/funnel', (req, res) => {
  const effects = effectValues().filter((item) => !req.query.item_id || item.item_id === req.query.item_id);
  res.json({
    total_reads: effects.reduce((sum, item) => sum + Number(item.reads || 0), 0),
    total_likes: effects.reduce((sum, item) => sum + Number(item.likes || 0), 0),
    total_shares: effects.reduce((sum, item) => sum + Number(item.shares || 0), 0),
    total_favorites: effects.reduce((sum, item) => sum + Number(item.favorites || 0), 0),
    total_comments: effects.reduce((sum, item) => sum + Number(item.comment_num || item.comments || 0), 0),
  });
});

router.get('/api/effects/article-options', (req, res) => {
  const seen = new Map();
  for (const item of effectValues()) {
    if (!item.title) continue;
    const existing = seen.get(item.title);
    if (!existing || String(item.publish_time) > String(existing.publish_time)) seen.set(item.title, { item_id: item.item_id, title: item.title, publish_time: item.publish_time || '' });
  }
  res.json({ articles: [...seen.values()].sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time))) });
});

router.get('/api/effects/top-articles', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  const articles = effectValues().filter((item) => Number(item.reads || 0) > 0).sort((a, b) => Number(b.reads || 0) - Number(a.reads || 0)).slice(0, limit).map((item) => ({
    item_id: item.item_id,
    title: item.title || '',
    reads: Number(item.reads || 0),
    likes: Number(item.likes || 0),
    shares: Number(item.shares || 0),
    favorites: Number(item.favorites || 0),
    comments: Number(item.comment_num || item.comments || 0),
    celebrity: item.celebrity || '',
    source_platform: item.source_platform || '',
    publish_time: item.publish_time || '',
    image_count: Number(item.image_count || 0),
  }));
  res.json({ articles });
});

router.get('/api/effects/image-analysis', (req, res) => {
  const groups = {};
  for (const item of effectValues()) {
    const count = Number(item.image_count || 0);
    const reads = Number(item.reads || 0);
    if (!reads) continue;
    if (!groups[count]) groups[count] = [];
    groups[count].push(reads);
  }
  res.json({ items: Object.entries(groups).map(([imageCount, values]) => ({ image_count: Number(imageCount), avg_reads: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length), count: values.length })).sort((a, b) => a.image_count - b.image_count) });
});

router.get('/api/effects/ai-analysis', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const summary = effectsSummary();
    const stream = await services.aiChatStream([{ role: 'user', content: `请分析以下公众号运营数据并给出建议：\n${JSON.stringify(summary)}` }]);
    for await (const chunk of stream) {
      sse(res, 'token', { token: chunk.choices?.[0]?.delta?.content || '' });
    }
    sse(res, 'done');
  } catch (err) {
    sse(res, 'error', { message: err.message });
  }
  res.end();
});

router.get('/api/effects/export', (req, res) => {
  const effects = appState.getPublishEffects();
  const headers = ['文章ID', '标题', '账号ID', '发布时间', '阅读量', '点赞数', '转发数', '收藏数', '评论数', '内容类型', '来源平台', '艺人', '图片数', '更新时间'];
  const fields = ['item_id', 'title', 'account_id', 'publish_time', 'reads', 'likes', 'shares', 'favorites', 'comments', 'content_type', 'source_platform', 'celebrity', 'image_count', 'updated_at'];
  const rows = [headers.join(',')];
  for (const item of Object.values(effects)) rows.push(fields.map((f) => `"${String(item[f] ?? '').replace(/"/g, '""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8-sig');
  res.setHeader('Content-Disposition', 'attachment; filename=effects_export.csv');
  res.send(rows.join('\n'));
});

router.get('/api/effects/mp-articles', (req, res) => {
  let articles = effectValues();
  const search = String(req.query.search || '').toLowerCase();
  const celebrity = String(req.query.celebrity || '');
  if (search) articles = articles.filter((item) => String(item.title || '').toLowerCase().includes(search));
  if (celebrity) articles = articles.filter((item) => item.celebrity === celebrity);
  const sortKey = req.query.sort_key || 'publish_time';
  const sortDir = req.query.sort_dir || 'desc';
  articles.sort((a, b) => {
    const av = a[sortKey] || 0;
    const bv = b[sortKey] || 0;
    const result = typeof av === 'string' ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
    return sortDir === 'asc' ? result : -result;
  });
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.max(1, Math.min(100, Number(req.query.page_size || 10)));
  const total = articles.length;
  const paged = articles.slice((page - 1) * pageSize, page * pageSize);
  const celebrities = [...new Set(effectValues().map((item) => item.celebrity).filter(Boolean))].sort();
  res.json({ articles: paged, total, page, page_size: pageSize, celebrities });
});

router.delete('/api/effects/mp-articles', (req, res) => {
  appState.clearPublishEffects();
  res.json({ success: true, deleted: 0 });
});

router.get('/api/effects', (req, res) => res.json({ effects: appState.getPublishEffects() }));

router.get('/api/effects/:item_id', (req, res) => {
  res.json({ effect: appState.getPublishEffects(req.params.item_id) || {} });
});

router.post('/api/effects/:item_id', (req, res) => {
  appState.updatePublishEffect(req.params.item_id, req.body || {});
  res.json({ success: true, effect: appState.getPublishEffects(req.params.item_id) });
});

// Dashboard
router.get('/api/dashboard/health', (req, res) => {
  const s = services.settings();
  res.json({
    platform: s.cfg.PLATFORM || 'weibo',
    platform_name: s.cfg.PLATFORM === 'toutiao' ? '今日头条' : '微博',
    platform_auth: Boolean(s.cfg.PLATFORM === 'toutiao' ? s.toutiaoCookie : s.weiboCookie),
    weibo_cookie: Boolean(s.weiboCookie),
    weibo_uid_or_celebrities: Boolean(s.weiboUid || s.cfg.WEIBO_CELEBRITIES),
    ai_api_key: Boolean(s.aiApiKey),
    ai_base_url: Boolean(s.aiBaseUrl),
  });
});

router.get('/api/dashboard/stats', (req, res) => {
  let localImages = 0;
  if (fs.existsSync(util.DOWNLOAD_DIR)) {
    for (const file of walkFiles(util.DOWNLOAD_DIR)) {
      if (['.jpg', '.png'].includes(path.extname(file).toLowerCase())) localImages += 1;
    }
  }
  res.json({ local_images: localImages, queue_size: appState.getQueue().length, selected_count: appState.getSelectedImages().length, discovery_count: appState.getDiscoveryResults().length });
});

router.get('/api/dashboard/runs', (req, res) => res.json([]));
router.delete('/api/dashboard/runs/:run_id', (req, res) => res.json({ success: true }));

router.get('/api/dashboard/operations', (req, res) => {
  res.json(appState.getOperations(Number(req.query.page || 1), Number(req.query.page_size || 10)));
});

router.post('/api/dashboard/operations/delete', (req, res) => {
  const body = req.body || {};
  if (body.clear) {
    appState.clearOperations();
    res.json({ success: true, deleted: -1 });
  } else {
    res.json({ success: true, deleted: appState.deleteOperationsById(body.ids || []) });
  }
});

router.put('/api/status/active-tasks', (req, res) => {
  const tasks = req.body?.tasks || [];
  appState.activeTasks = new Set(tasks);
  res.json({ ok: true });
});

router.get('/api/status/active-tasks', (req, res) => {
  res.json({ publish_active: appState.publishActive, active_tasks: [...appState.activeTasks] });
});

// Logs
router.get('/api/logs/list', (req, res) => {
  const files = [];
  if (fs.existsSync(util.LOG_DIR)) {
    for (const name of fs.readdirSync(util.LOG_DIR)) {
      const full = path.join(util.LOG_DIR, name);
      if (!fs.statSync(full).isFile()) continue;
      files.push({ name, size: fs.statSync(full).size, mtime: new Date(fs.statSync(full).mtime).toISOString() });
    }
  }
  res.json({ files });
});

router.get('/api/logs/content', (req, res) => {
  const file = String(req.query.file || '');
  const safe = path.resolve(util.LOG_DIR, file);
  if (!safe.startsWith(path.resolve(util.LOG_DIR)) || !fs.existsSync(safe)) return abort(res, 404, '日志文件不存在');
  const lines = fs.readFileSync(safe, 'utf8').split('\n');
  const maxLines = Number(req.query.max_lines || 500);
  res.json({ name: file, lines: maxLines > 0 ? lines.slice(-maxLines) : lines, total: lines.length });
});

router.post('/api/logs/clipboard', (req, res) => {
  try {
    const { clipboard } = require('electron');
    clipboard.writeText(req.body?.text || '');
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

router.post('/api/logs/save-to-downloads', (req, res) => {
  const file = String(req.body?.file || '');
  const safe = path.resolve(util.LOG_DIR, file);
  if (!safe.startsWith(path.resolve(util.LOG_DIR)) || !fs.existsSync(safe)) return abort(res, 404, '日志文件不存在');
  const downloads = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const dest = path.join(downloads, path.basename(safe));
  fs.copyFileSync(safe, dest);
  res.json({ success: true, path: dest });
});

router.delete('/api/logs/delete', (req, res) => {
  const safe = path.resolve(util.LOG_DIR, String(req.query.file || ''));
  if (fs.existsSync(safe)) fs.unlinkSync(safe);
  res.json({ success: true });
});

router.delete('/api/logs/clear', (req, res) => {
  let deleted = 0;
  if (fs.existsSync(util.LOG_DIR)) {
    for (const name of fs.readdirSync(util.LOG_DIR)) {
      const full = path.join(util.LOG_DIR, name);
      if (fs.statSync(full).isFile()) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    }
  }
  res.json({ success: true, deleted });
});

// Credits
router.get('/api/credits', (req, res) => res.json({ balance: appState.getCreditsBalance(), checkin_status: appState.getCheckinStatus() }));
router.get('/api/credits/history', (req, res) => res.json(appState.getCreditsHistory(Number(req.query.page || 1), Number(req.query.page_size || 20))));
router.get('/api/credits/checkin-history', (req, res) => {
  const now = new Date();
  res.json(appState.getCheckinHistory(Number(req.query.year || now.getFullYear()), Number(req.query.month || now.getMonth() + 1)));
});
router.post('/api/credits/checkin', (req, res) => {
  const result = appState.checkin();
  if (!result.success) return abort(res, 400, result.message);
  appState.addOperation('每日签到', `获得 ${result.earned} 积分（连续第${result.streak}天）`);
  res.json(result);
});
router.post('/api/credits/watch-video', (req, res) => res.json({ success: true, earned: 0, daily_count: 0, daily_limit: 10, balance: appState.getCreditsBalance(), message: '视频任务暂未启用' }));
router.get('/api/credits/tasks', (req, res) => res.json(appState.getDailyTasks()));
router.get('/api/videos/list', (req, res) => res.json({ videos: appState.getVideoList() }));
router.get('/api/videos/play/:video_id', (req, res) => {
  const file = path.join(VIDEOS_DIR, `${req.params.video_id}.mp4`);
  if (!fs.existsSync(file)) return abort(res, 404, '视频文件不存在');
  fs.createReadStream(file).pipe(res);
});

// Cloud sync
router.get('/api/sync/status', (req, res) => {
  const cfg = store.readSettings();
  res.json({
    enabled: util.parseBool(cfg.CLOUD_SYNC_ENABLED, false),
    configured: Boolean(cfg.CLOUD_SYNC_SERVER && cfg.CLOUD_SYNC_SECRET),
    server_url: cfg.CLOUD_SYNC_SERVER || '',
    device_id: cfg.CLOUD_SYNC_DEVICE_ID || null,
    last_sync: cfg.CLOUD_SYNC_LAST_SYNC || null,
    auto_sync: util.parseBool(cfg.CLOUD_SYNC_AUTO_SYNC, true),
    sync_interval: Number(cfg.CLOUD_SYNC_INTERVAL || 300),
    is_syncing: false,
  });
});

router.post('/api/sync/configure', (req, res) => {
  store.writeSettings({ CLOUD_SYNC_SERVER: req.body?.server_url || '', CLOUD_SYNC_SECRET: req.body?.secret || '', CLOUD_SYNC_ENABLED: 'true', CLOUD_SYNC_DEVICE_ID: store.readSettings().CLOUD_SYNC_DEVICE_ID || util.uuid() });
  res.json({ success: true, message: '配置成功', status: { enabled: true, configured: true, server_url: req.body?.server_url || '', device_id: store.readSettings().CLOUD_SYNC_DEVICE_ID, last_sync: null, auto_sync: true, sync_interval: 300, is_syncing: false } });
});

router.post('/api/sync/disable', (req, res) => {
  store.writeSettings({ CLOUD_SYNC_ENABLED: 'false', CLOUD_SYNC_SERVER: '', CLOUD_SYNC_SECRET: '' });
  res.json({ success: true, message: '云同步已禁用' });
});

router.post('/api/sync/test', (req, res) => res.json({ success: true, message: '连接正常' }));
router.post('/api/sync/manual', (req, res) => res.json({ success: true, message: '同步成功', last_sync: null }));
router.post('/api/sync/load', (req, res) => res.json({ success: false, message: '云端暂无数据' }));
router.get('/api/sync/device-info', (req, res) => res.json({ device_id: store.readSettings().CLOUD_SYNC_DEVICE_ID || '' }));

// User auth (local-first compatibility with the existing frontend)
function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt || 'mediaforge', 32).toString('hex');
}

function createToken(user) {
  return jwt.sign({ user_id: user.user_id, email: user.email, nickname: user.nickname, avatar: user.avatar || '', is_verified: user.is_verified || false }, getJwtSecret(), { expiresIn: '30d' });
}

function currentUserFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret());
    return payload;
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

// WeChat accounts
router.get('/api/wechat/accounts', (req, res) => res.json({ accounts: store.listWechatAccounts() }));
router.post('/api/wechat/accounts', (req, res) => {
  if (!req.body?.name) return abort(res, 400, '账号名称不能为空');
  res.json({ success: true, account: store.addWechatAccount(req.body.name) });
});
router.delete('/api/wechat/accounts/:account_id', (req, res) => {
  if (!store.removeWechatAccount(req.params.account_id)) return abort(res, 404, '账号不存在');
  res.json({ success: true });
});
router.get('/api/wechat/accounts/:account_id/status', (req, res) => {
  const account = store.getWechatAccount(req.params.account_id);
  if (!account) return abort(res, 404, '账号不存在');
  res.json({ logged_in: store.validateWechatLogin(req.params.account_id), name: account.name });
});

router.get('/api/wechat/accounts/:account_id/login', async (req, res) => {
  const account = store.getWechatAccount(req.params.account_id);
  if (!account) return abort(res, 404, '账号不存在');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const { chromium } = require('playwright');
  try {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    sse(res, 'progress', { message: '请在浏览器窗口中扫码登录微信公众号' });
    try {
      await page.waitForFunction(() => window.location.href.includes('/cgi-bin/'), { timeout: 300000 });
    } catch {
      sse(res, 'error', { message: '登录超时，请重试' });
      await browser.close();
      return res.end();
    }
    const cookies = await context.cookies();
    const { statePath } = store.wechatAccountPaths(req.params.account_id);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ cookies, origins: [] }, null, 2));
    store.updateWechatAccount(req.params.account_id, { last_used: new Date().toISOString() });
    sse(res, 'done', { message: '登录完成' });
    await browser.close();
  } catch (err) {
    sse(res, 'error', { message: err.message });
  }
  res.end();
});

router.get('/api/wechat/accounts/:account_id/sync-effects', (req, res) => res.json({ success: true, items: [] }));
router.post('/api/wechat/accounts/:account_id/logout', (req, res) => {
  const { statePath } = store.wechatAccountPaths(req.params.account_id);
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  res.json({ success: true });
});
router.post('/api/wechat/accounts/:account_id/default', (req, res) => {
  if (!store.setDefaultWechatAccount(req.params.account_id)) return abort(res, 404, '账号不存在');
  res.json({ success: true });
});
function collectPublishHistory() {
  const items = [];
  for (const item of appState.getQueue()) {
    if (['published', 'saved_to_wechat', 'failed'].includes(item.status || '')) {
      items.push({ id: item.id, title: item.title, type: item.type || 'image', status: item.status, publish_time: item.time || '', images_count: (item.images || []).length, account_id: item.account_id || '' });
    }
  }
  for (const article of appState.getArticles()) {
    if (['published', 'saved_to_wechat', 'failed'].includes(article.status || '')) {
      items.push({ id: article.id, title: article.title, type: 'article', status: article.status, publish_time: article.updated_at || article.created_at || '', images_count: (article.images || []).length, account_id: article.account_id || '' });
    }
  }
  return items.sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time)));
}

router.get('/api/wechat/accounts/history', (req, res) => {
  const items = collectPublishHistory();
  res.json({ items, total: items.length });
});

router.get('/api/wechat/accounts/:account_id/history', (req, res) => {
  const items = collectPublishHistory().filter((item) => item.account_id === req.params.account_id);
  res.json({ items, total: items.length, account_id: req.params.account_id });
});

// Images
router.get('/images/thumbnail/*', async (req, res) => {
  const file = path.resolve(util.DOWNLOAD_DIR, req.params[0]);
  if (!fs.existsSync(file)) return abort(res, 404, '图片不存在');
  try {
    const data = await sharp(file).resize({ width: Number(req.query.size || 320), height: Number(req.query.size || 320), fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(data);
  } catch {
    fs.createReadStream(file).pipe(res);
  }
});

router.get('/images/*', (req, res) => {
  const file = path.resolve(util.DOWNLOAD_DIR, req.params[0]);
  if (!fs.existsSync(file)) return abort(res, 404, '图片不存在');
  fs.createReadStream(file).pipe(res);
});

router.get('/proxy', async (req, res) => {
  try {
    const response = await axios.get(String(req.query.url), { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    let data = Buffer.from(response.data);
    const size = Number(req.query.size || 0);
    if (size) data = await sharp(data).resize({ width: size, height: size, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.send(data);
  } catch (err) {
    res.status(502).json({ detail: `代理请求失败: ${err.message}` });
  }
});

// Pipeline (simplified event stream for UI compatibility)
router.post('/api/pipeline/run', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const body = req.body || {};
  const runId = util.uuid().slice(0, 8);
  sse(res, 'step_start', { step: 'health_check', name: '健康检查' });
  try {
    const posts = await services.fetchPosts(body.platform || 'weibo', body.mode || 'celebrities', { maxPages: body.max_pages || 2, postLimit: body.post_limit || 3, celebrities: body.celebrities || [], searchTags: body.search_tags || [], superTopics: body.super_topics || [] });
    appState.setDiscoveryResults(posts);
    sse(res, 'step_complete', { step: 'search', name: '内容发现', result: { total_posts: posts.length, total_images: posts.reduce((sum, p) => sum + (p.images || []).length, 0) } });

    sse(res, 'step_start', { step: 'download', name: '图片下载与评分' });
    const downloadedPosts = [];
    for (const post of posts) {
      const celebrity = util.sanitizeSegment(post.celebrity || '未命名');
      const scene = util.sanitizeSegment(post.scene || '日常');
      const slug = util.sanitizeSegment((post.text || post.id || '').slice(0, 12) || 'post');
      const localImages = [];
      for (let index = 0; index < (post.images || []).length; index += 1) {
        const url = post.images[index];
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const dest = path.join(util.DOWNLOAD_DIR, celebrity, scene, `${slug.slice(0, 8)}_${index + 1}_${util.hashText(url).slice(0, 8)}${ext}`);
        try {
          await services.downloadImage(url, dest);
          localImages.push(util.toRel(dest));
        } catch {
          // Continue downloading other images.
        }
        sse(res, 'progress', { step: 'download', current: index + 1, total: post.images.length, celebrity, scene });
      }
      downloadedPosts.push({ ...post, local_images: localImages });
    }
    appState.setDiscoveryResults(downloadedPosts);

    if (!body.dry_run) {
      const selected = downloadedPosts.flatMap((post) => post.local_images || []);
      if (selected.length) {
        appState.addToQueue({ title: selected.length ? '流水线采集结果' : '', desc: '', images: selected, cover: services.selectCover(selected), celebrity: downloadedPosts[0]?.celebrity || '' });
      }
    }
    sse(res, 'step_complete', { step: 'download', name: '图片下载与评分', result: { downloaded: downloadedPosts.reduce((sum, post) => sum + (post.local_images || []).length, 0) } });
    sse(res, 'completed', { step: 'done', message: '流水线完成', run_id: runId });
  } catch (err) {
    sse(res, 'step_error', { step: 'search', error: err.message });
  }
  res.end();
});

router.post('/api/pipeline/confirm/:run_id', (req, res) => res.json({ success: true }));
router.post('/api/pipeline/cancel/:run_id', (req, res) => res.json({ success: true }));
router.post('/api/pipeline/decide/:run_id', (req, res) => res.json({ success: true }));
router.get('/api/pipeline/runs/:run_id', (req, res) => res.json({ run_id: req.params.run_id, events: [] }));

module.exports = router;
