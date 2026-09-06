const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const OpenAI = require('openai');
const sharp = require('sharp');

const store = require('./store');
const {
  DOWNLOAD_DIR,
  hashText,
  sanitizeSegment,
  sleep,
  stripHtml,
  csvList,
} = require('./util');

function settings() {
  const cfg = store.readSettings();
  const weibo = store.readWeiboAuth();
  const toutiao = store.readToutiaoAuth();
  return {
    cfg,
    weibo,
    toutiao,
    aiProvider: (cfg.AI_PROVIDER || 'mimo').toLowerCase(),
    aiModel: cfg.AI_MODEL || 'mimo-v2.5-pro',
    aiBaseUrl: cfg.AI_BASE_URL || '',
    aiApiKey: getProviderKey(cfg),
    weiboCookie: weibo.cookie || cfg.WEIBO_COOKIE || '',
    weiboUid: weibo.uid || cfg.WEIBO_UID || '',
    toutiaoCookie: toutiao.cookie || cfg.TOUTIAO_COOKIE || '',
    toutiaoUserId: toutiao.uid || cfg.TOUTIAO_USER_ID || '',
  };
}

function getProviderKey(cfg, provider) {
  const resolvedProvider = provider || (cfg.AI_PROVIDER || 'mimo').toLowerCase();
  if (cfg.AI_API_KEY) return cfg.AI_API_KEY;
  const keys = store.readApiKeys();
  if (keys[resolvedProvider]) return keys[resolvedProvider];
  const keyMap = {
    mimo: 'MIMO_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    glm: 'GLM_API_KEY',
    openai: 'OPENAI_API_KEY',
    qwen: 'QWEN_API_KEY',
    minimax: 'MINIMAX_API_KEY',
  };
  return cfg[keyMap[resolvedProvider]] || '';
}

function createOpenAIClient() {
  const s = settings();
  if (!s.aiApiKey || !s.aiBaseUrl) return null;
  return new OpenAI({ apiKey: s.aiApiKey, baseURL: s.aiBaseUrl, timeout: Number(s.cfg.AI_TIMEOUT || 120000) });
}

async function aiChat(messages, options = {}) {
  const s = settings();
  if (!s.aiApiKey || !s.aiBaseUrl) throw new Error('当前未配置大模型 API Key 或 Base URL');
  const client = createOpenAIClient();
  const response = await client.chat.completions.create({
    model: options.model || s.aiModel,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
    stream: options.stream || false,
  });
  return response.choices[0].message.content || '';
}

async function aiChatStream(messages, options = {}) {
  const s = settings();
  if (!s.aiApiKey || !s.aiBaseUrl) throw new Error('当前未配置大模型 API Key 或 Base URL');
  const client = createOpenAIClient();
  const stream = await client.chat.completions.create({
    model: options.model || s.aiModel,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
    stream: true,
  });
  return stream;
}

async function generateArticle(topic, title, options = {}) {
  const prompt = `请根据以下话题写一篇微信公众号图文文章。\n话题：${topic}\n标题：${title || '请自拟'}\n要求：自然、去 AI 味、适合微信公众号图文排版，正文不少于 ${options.wordCount || '800'} 字。${options.withSubtitles ? '请使用小标题。' : ''}`;
  return aiChat([{ role: 'user', content: prompt }], options);
}

async function polishArticle(content) {
  return aiChat([{ role: 'user', content: `请校对并润色以下文章，保持原意，使表达更自然：\n${content}` }]);
}

async function deAiArticle(content) {
  return aiChat([{ role: 'user', content: `请重写以下文章，去掉 AI 感，更口语化、更像真人创作，保持信息不变：\n${content}` }]);
}

async function generateTitle(content) {
  const text = await aiChat([{ role: 'user', content: `请为以下文章生成一个适合微信公众号的标题，只返回标题：\n${content}` }]);
  return text.trim().replace(/^["'“”]+|["'“”]+$/g, '');
}

async function generateTitleCandidates(content) {
  const text = await aiChat([{ role: 'user', content: `请为以下文章生成 5 个不同风格的标题，每行一个，不要编号：\n${content}` }]);
  return text.split('\n').map((x) => x.replace(/^\d+[.、]\s*/, '').trim()).filter(Boolean);
}

async function polishQueueCaption(input) {
  return aiChat([{ role: 'user', content: `请将下面公众号图文文案润色得更有吸引力，保持明星名字和结构，不要加 emoji：\n${input}` }]);
}

async function recommendCelebrities() {
  const text = await aiChat([{ role: 'user', content: '请列出当前国内最受关注、适合公众号娱乐图文内容的 10 位女明星，只返回名字，用逗号分隔。' }]);
  return csvList(text).slice(0, 10);
}

function extractWeiboImages(item) {
  const urls = [];
  const push = (url) => {
    if (typeof url === 'string' && url.startsWith('http') && !urls.includes(url)) urls.push(url);
  };
  const imageUrl = (value) => (typeof value === 'string' ? value : value?.url);
  for (const key of ['bmiddle_pic', 'original_pic', 'thumbnail_pic', 'gif_url']) push(item[key]);
  for (const pic of item.pics || []) {
    if (typeof pic === 'string') push(pic);
    else if (pic) {
      push(imageUrl(pic.large) || imageUrl(pic.largest) || pic.bmiddle_pic || pic.url);
    }
  }
  for (const info of Object.values(item.pic_infos || {})) {
    if (!info) continue;
    push(imageUrl(info.largest) || imageUrl(info.large) || imageUrl(info.original));
  }
  for (const media of item.mix_media_info?.items || []) {
    const data = media?.data || {};
    push(
      imageUrl(data.largest)
      || imageUrl(data.big_pic)
      || imageUrl(data.original)
      || data.url
      || imageUrl(data.pic_info?.largest)
      || imageUrl(data.pic_info?.original)
    );
  }
  if (item.retweeted_status) urls.push(...extractWeiboImages(item.retweeted_status));
  return urls;
}

function weiboPost(mblog, celebrity, sceneHint, source) {
  const images = extractWeiboImages(mblog);
  if (!images.length) return null;
  const rawText = mblog.text_raw || mblog.raw_text || mblog.text || '';
  const text = stripHtml(rawText).trim();
  return {
    id: String(mblog.id || mblog.mid || mblog.idstr || ''),
    text,
    images,
    celebrity,
    source,
    scene: sceneHint || inferScene(text),
    screen_name: mblog.user?.screen_name || '',
    created_at: mblog.created_at || '',
  };
}

function inferScene(text) {
  const keywords = ['巴黎时装周', '米兰时装周', '纽约时装周', '伦敦时装周', '上海时装周', '时装秀', '大秀', 'GQ', '红毯', '杀青', '定妆照', '私服', '街拍', '路透', '活动', '领奖', '写真'];
  const sorted = keywords.sort((a, b) => b.length - a.length);
  for (const keyword of sorted) if (text.includes(keyword)) return keyword;
  return '日常';
}

function weiboApiError(payload) {
  if (!payload || typeof payload !== 'object') return '微博接口返回异常';
  const ok = payload.ok;
  if (ok !== undefined && (ok === false || ok === 0 || String(ok) === '0' || (typeof ok === 'number' && ok < 0))) {
    return payload.msg || payload.message || payload.error || `微博接口返回错误（ok=${ok}）`;
  }
  if (typeof payload.url === 'string' && payload.url.includes('login.php')) {
    return '微博登录已失效，请重新扫码登录';
  }
  return '';
}

function extractWeiboSearchStatuses(payload) {
  const data = payload?.data;
  if (Array.isArray(payload?.statuses)) return payload.statuses;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.statuses)) return data.statuses;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.cards)) {
    const statuses = [];
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.mblog && typeof node.mblog === 'object') statuses.push(node.mblog);
      for (const group of node.card_group || []) collect(group);
    };
    for (const card of data.cards) collect(card);
    return statuses;
  }
  return [];
}

async function weiboSearch(params) {
  const s = settings();
  if (!s.weiboCookie) throw new Error('微博 Cookie 未配置，请先在设置页完成微博登录');
  const xsrf = cookieValue(s.weiboCookie, 'XSRF-TOKEN');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
    Cookie: s.weiboCookie,
    Referer: 'https://weibo.com/',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;

  const paramSets = [
    { q: params.keyword, page: params.page || 1, haspic: '1' },
    { q: params.keyword, page: params.page || 1 },
  ];
  let payload = null;
  let lastError = null;
  for (const query of paramSets) {
    try {
      const response = await axios.get('https://weibo.com/ajax/statuses/search', {
        params: query,
        headers,
        timeout: 20000,
      });
      payload = response.data;
      const apiError = weiboApiError(payload);
      if (!apiError) break;
      lastError = new Error(apiError);
    } catch (error) {
      lastError = error;
    }
  }
  if (!payload) throw lastError || new Error('微博搜索请求失败');
  const apiError = weiboApiError(payload);
  if (apiError) throw new Error(apiError);
  const statuses = extractWeiboSearchStatuses(payload);
  return statuses.map((item) => weiboPost(item, params.celebrity || '关键词搜索', params.scene, 'search_desktop')).filter(Boolean);
}

function extractToutiaoImages(item) {
  const urls = [];
  const push = (url) => {
    if (typeof url === 'string' && url.startsWith('http')) {
      const clean = url.split('?')[0];
      if (!urls.includes(clean)) urls.push(clean);
    }
  };
  const list = item.detail_image_list || item.image_list || item.all_image_list || [];
  for (const entry of list) {
    if (typeof entry === 'string') push(entry);
    else if (entry) push(entry.url || entry.img_url);
  }
  if (!urls.length) push(item.large_img_url || item.img_url || item.thumb_url || item.middle_img_url);
  return urls;
}

function toutiaoPost(item, celebrity, source, scene) {
  const images = extractToutiaoImages(item);
  if (!images.length) return null;
  let text = stripHtml(item.title || item.text || item.content || '').replace(/…+$/, '');
  if (!text) text = `#${scene} 图片`;
  return {
    id: String(item.id || item.group_id || item.item_id || ''),
    text,
    images,
    celebrity: celebrity || '头条用户',
    source,
    scene: scene || '推荐',
    screen_name: celebrity || '头条用户',
    created_at: item.datetime || item.publish_time || '',
  };
}

async function toutiaoSearch(params) {
  const s = settings();
  const response = await axios.get('https://www.toutiao.com/api/search/content/', {
    params: {
      keyword: params.keyword,
      offset: String(((params.page || 1) - 1) * 20),
      count: '20',
      format: 'json',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
      Cookie: s.toutiaoCookie,
      Referer: 'https://www.toutiao.com/',
      Accept: 'application/json, text/plain, */*',
    },
    timeout: 20000,
  });
  const items = response.data?.data || [];
  return items.map((item) => toutiaoPost(item, params.celebrity || '关键词搜索', 'toutiao_keyword', params.scene || params.keyword)).filter(Boolean);
}

async function fetchPosts(platform, mode, options = {}) {
  const s = settings();
  const maxPages = Math.max(1, Number(options.maxPages || 1));
  const specificPage = Number(options.specificPage || 0);
  const pages = specificPage > 0 ? [specificPage] : Array.from({ length: maxPages }, (_, i) => i + 1);
  const posts = [];

  if (platform === 'weibo') {
    const celebrities = options.celebrities?.length ? options.celebrities : csvList(s.cfg.WEIBO_CELEBRITIES);
    const tags = options.searchTags?.length ? options.searchTags : csvList(s.cfg.WEIBO_SEARCH_TAGS || '美图,日常,时装周,美妆,穿搭');
    const superTopics = options.superTopics?.length ? options.superTopics : csvList(s.cfg.WEIBO_SUPER_TOPICS);
    if (mode === 'own') {
      // Own timeline requires uid; fall back to keyword search when unavailable.
      for (const page of pages) {
        const found = await weiboSearch({ keyword: s.weiboUid ? '明星' : '美图', page, celebrity: '本人', scene: '日常' });
        posts.push(...found);
      }
    } else if (mode === 'keyword') {
      for (const tag of tags) {
        for (const page of pages) posts.push(...await weiboSearch({ keyword: tag, page, celebrity: '关键词搜索', scene: tag }));
      }
    } else if (mode === 'super_topic') {
      for (const topic of superTopics.length ? superTopics : ['明星']) {
        const keyword = topic.endsWith('超话') ? topic : `${topic}超话`;
        for (const page of pages) {
          posts.push(...await weiboSearch({ keyword, page, celebrity: topic, scene: topic }));
        }
      }
    } else {
      const names = celebrities.length ? celebrities : ['迪丽热巴'];
      for (const name of names) {
        for (const tag of tags.slice(0, 2)) {
          for (const page of pages) posts.push(...await weiboSearch({ keyword: `${name} ${tag}`, page, celebrity: name, scene: tag }));
        }
      }
    }
  } else if (platform === 'toutiao') {
    const tags = options.searchTags?.length ? options.searchTags : csvList(s.cfg.TOUTIAO_SEARCH_TAGS || '时尚,明星,穿搭');
    if (mode === 'user') {
      // Fallback to keyword search if no user id.
      for (const page of pages) posts.push(...await toutiaoSearch({ keyword: '明星', page, celebrity: '用户主页', scene: '用户主页' }));
    } else {
      for (const tag of tags) {
        for (const page of pages) posts.push(...await toutiaoSearch({ keyword: tag, page, celebrity: '', scene: tag }));
      }
    }
  }

  const seen = new Set();
  const result = [];
  for (const post of posts) {
    const key = post.id || JSON.stringify(post.images);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...post, celebrity: post.celebrity || '未命名艺人', scene: post.scene || '日常' });
  }
  return result;
}

async function downloadImage(url, destination, { filterWatermark = true } = {}) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let buffer = Buffer.from(response.data);
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    if (metadata.width > 1600) buffer = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    // Keep original bytes when the image cannot be decoded.
  }
  fs.writeFileSync(destination, buffer);
  return destination;
}

function scoreImage(buffer, useVision = true) {
  const metadata = sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const size = buffer.length;
  const score = Math.min(100, Math.round(35 + (width / 2000) * 30 + (height / 2000) * 20 + Math.min(size / 500000, 1) * 15));
  return { score, method: useVision ? 'heuristic' : 'heuristic', reason: '基于分辨率与文件大小的启发式评分' };
}

async function watermarkMetrics(filePath) {
  const image = sharp(filePath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return { cornerRatio: 0, bottomRatio: 0 };
  const sampleSize = Math.min(40, Math.floor(Math.min(metadata.width, metadata.height) * 0.12));
  const raw = await image.raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const channels = info.channels || 3;
  const brightness = (x, y) => {
    const offset = (y * info.width + x) * channels;
    return (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  };
  const regionBrightness = (x0, y0, w, h) => {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y0 + h; y += 2) {
      for (let x = x0; x < x0 + w; x += 2) {
        sum += brightness(x, y);
        count += 1;
      }
    }
    return count ? sum / count : 0;
  };
  const centerX = Math.floor(info.width / 2);
  const centerY = Math.floor(info.height / 2);
  const center = regionBrightness(centerX - sampleSize / 2, centerY - sampleSize / 2, sampleSize, sampleSize);
  const corners = [
    regionBrightness(0, 0, sampleSize, sampleSize),
    regionBrightness(info.width - sampleSize, 0, sampleSize, sampleSize),
    regionBrightness(0, info.height - sampleSize, sampleSize, sampleSize),
    regionBrightness(info.width - sampleSize, info.height - sampleSize, sampleSize, sampleSize),
  ];
  const bottom = regionBrightness(0, info.height - sampleSize, info.width, sampleSize);
  const maxCorner = Math.max(...corners);
  const cornerRatio = center > 0 ? maxCorner / center : 0;
  const bottomRatio = center > 0 ? bottom / center : 0;
  return { cornerRatio, bottomRatio };
}

async function removeWatermark(filePath) {
  try {
    const image = sharp(filePath);
    const output = `${filePath}.clean.jpg`;
    await image.jpeg({ quality: 88 }).toFile(output);
    fs.renameSync(output, filePath);
    return { success: true, action: 'processed', message: '已应用基础去水印处理', path: filePath };
  } catch (error) {
    return { success: false, action: 'error', message: error.message };
  }
}

function selectCover(images) {
  return images[0] || '';
}

function buildHtml(markdown, images = []) {
  const html = marked.parse(markdown || '');
  const imageHtml = (images || []).map((img) => `<p><img src="/api/materials/file/${encodeURIComponent(img)}" /></p>`).join('');
  return `${html}${imageHtml}`;
}

function humanSleep(base = 1, jitter = 0.8) {
  return sleep(base + Math.random() * jitter);
}

function normalizeSameSite(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['strict', 'lax', 'none'].includes(v)) return v.charAt(0).toUpperCase() + v.slice(1);
  return 'None';
}

async function injectCookiesFromState(context, statePath) {
  if (!statePath || !fs.existsSync(statePath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const cookies = data.cookies || [];
    if (cookies.length) {
      for (const cookie of cookies) {
        if (cookie.sameSite) cookie.sameSite = normalizeSameSite(cookie.sameSite);
      }
      await context.addCookies(cookies);
    }
  } catch (error) {
    console.error('[MediaForge] inject cookies failed:', error.message);
  }
}

async function looksLoggedIn(page) {
  if ((page.url() || '').includes('mp.weixin.qq.com/cgi-bin/')) return true;
  for (const selector of ["a:has-text('图文消息')", "a:has-text('内容与互动')", "a:has-text('发表')"]) {
    try {
      if (await page.locator(selector).first.isVisible({ timeout: 800 })) return true;
    } catch {
      // Continue trying other selectors.
    }
  }
  return false;
}

async function ensureWechatLogin(page, statePath, onLog) {
  if (!(page.url() || '').includes('mp.weixin.qq.com')) {
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
  }
  if (!(await looksLoggedIn(page))) {
    onLog('请在浏览器窗口中扫码登录公众号');
    await page.waitForFunction(() => window.location.href.includes('/cgi-bin/'), { timeout: 300000 });
  }
  onLog('公众号登录状态正常');
  if (statePath) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await page.context().storageState({ path: statePath });
  }
}

async function clickFirst(scope, selectors, waitMs = 5000) {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first;
    try {
      await locator.waitFor({ state: 'visible', timeout: waitMs });
      await locator.click();
      return true;
    } catch {
      // Continue.
    }
  }
  return false;
}

async function fillFirst(scope, selectors, value, waitMs = 5000) {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first;
    try {
      await locator.waitFor({ state: 'visible', timeout: waitMs });
      await locator.fill(value);
      return true;
    } catch {
      // Continue.
    }
  }
  return false;
}

function resolveEditorFrame(page) {
  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url() || '';
    if (url.includes('appmsg_edit') || url.includes('cgi-bin/appmsg')) return frame;
  }
  for (const frame of frames) {
    try {
      if (frame.locator('#js_content, [contenteditable]').first.count() > 0) return frame;
    } catch {
      // Continue.
    }
  }
  return page.mainFrame();
}

async function gotoNewArticleDirect(page) {
  const match = (page.url() || '').match(/[?&]token=(\d+)/);
  if (!match) return false;
  const direct = `https://mp.weixin.qq.com/cgi-bin/appmsg?token=${match[1]}&lang=zh_CN&t=media/appmsg_edit_v2&action=edit&isNew=1&type=10`;
  await page.goto(direct, { waitUntil: 'domcontentloaded' });
  return true;
}

async function fillWechatTitle(page, title) {
  const selectors = [
    "input[placeholder*='标题']",
    "textarea[placeholder*='标题']",
    "[placeholder*='标题']",
    '[data-placeholder*="标题"]',
    '#js_title',
    'input.js_title',
  ];
  const targets = [page, ...page.frames()];
  for (const scope of targets) {
    if (await fillFirst(scope, selectors, title, 2000)) return true;
  }
  return false;
}

async function fillWechatContent(page, frame, content) {
  const frames = [frame, ...page.frames().filter((item) => item !== frame)];
  for (const current of frames) {
    try {
      const success = await current.evaluate((html) => {
        const elements = document.querySelectorAll('[contenteditable="true"]');
        let editor = document.getElementById('js_content');
        if (!editor) {
          let best = null;
          let bestArea = 0;
          for (const el of elements) {
            const ph = (el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '').trim();
            if (ph.includes('标题')) continue;
            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (rect.width >= 50 && rect.height >= 30 && area > bestArea) {
              bestArea = area;
              best = el;
            }
          }
          editor = best || elements[0];
        }
        if (!editor) return false;
        editor.focus();
        editor.innerHTML = html;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, content);
      if (success) return true;
    } catch {
      // Continue.
    }
  }
  return false;
}

async function resizeImageIfNeeded(imagePath) {
  const stat = fs.statSync(imagePath);
  if (stat.size <= 8 * 1024 * 1024) return imagePath;
  try {
    const buffer = await sharp(imagePath).rotate().jpeg({ quality: 85 }).toBuffer();
    const tmp = `${imagePath}.wechat.jpg`;
    fs.writeFileSync(tmp, buffer);
    return tmp;
  } catch {
    return imagePath;
  }
}

async function wechatPublish(options) {
  if (options.dryRun) {
    return { success: true, dry_run: true };
  }
  const onLog = options.onLog || ((message) => console.log(`[MediaForge publish] ${message}`));
  const accountId = options.accountId || '';
  const account = accountId ? store.getWechatAccount(accountId) : null;
  if (account && !store.validateWechatLogin(account.account_id)) {
    return { success: false, message: '公众号账号未登录，请先在设置页完成扫码登录' };
  }

  const { chromium } = require('playwright');
  const accountPaths = accountId ? store.wechatAccountPaths(accountId) : null;
  const profileDir = accountPaths?.profileDir || path.join(store.STATE_DIR, 'wechat_chromium_profile');
  const statePath = accountPaths?.statePath || path.join(store.STATE_DIR, 'wechat.json');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: Boolean(options.headless),
    channel: 'chromium',
  });
  await injectCookiesFromState(context, statePath);
  const page = context.pages()[0] || await context.newPage();
  const uploadedTmp = [];
  let success = false;
  let message = '';

  try {
    await ensureWechatLogin(page, statePath, onLog);
    if (!(await gotoNewArticleDirect(page))) {
      throw new Error('无法进入公众号新建图文页');
    }
    await page.waitForLoadState('load');
    await humanSleep(1.5, 1);
    const editorFrame = resolveEditorFrame(page);

    onLog('正在填写标题...');
    if (!(await fillWechatTitle(page, options.title || ''))) {
      throw new Error('未找到标题输入框');
    }

    if (options.content && String(options.content).trim()) {
      onLog('正在填写正文内容...');
      await fillWechatContent(page, editorFrame, options.content);
    }

    const images = [...(options.images || [])];
    const cover = options.cover && fs.existsSync(options.cover) ? options.cover : '';
    if (cover && !images.includes(cover)) images.unshift(cover);

    onLog('正在上传图片...');
    for (const [index, imagePath] of images.entries()) {
      if (!fs.existsSync(imagePath)) continue;
      const uploadPath = await resizeImageIfNeeded(imagePath);
      if (uploadPath !== imagePath) uploadedTmp.push(uploadPath);
      await page.locator("input[type='file']").first.setInputFiles(uploadPath);
      onLog(`已上传图片 ${index + 1}/${images.length}`);
      await humanSleep(2, 1);
    }

    if (cover) {
      onLog('正在设置封面...');
      await clickFirst(page, ["text=选择封面", "text=点击选择封面", "button:has-text('选择封面')"], 5000);
      await clickFirst(page, ["text=从正文选择", "text=从正文选择图片"], 3000);
      await clickFirst(page, ["button:has-text('下一步')", "button:has-text('确定')", "button:has-text('完成')"], 3000);
    }

    if (options.saveDraft) {
      onLog('正在保存草稿...');
      const saved = await clickFirst(page, ["button:has-text('保存为草稿')", "a:has-text('保存为草稿')", "button:has-text('保存草稿')"], 5000);
      if (!saved) throw new Error('未找到保存草稿按钮');
      message = '已保存为草稿';
    } else {
      onLog('正在发布...');
      const published = await clickFirst(page, ["button:has-text('发表')", "button:has-text('发布')", "a:has-text('发表')"], 5000);
      if (!published) throw new Error('未找到发布按钮');
      message = '发布成功';
    }

    await context.storageState({ path: statePath });
    if (accountId) store.updateWechatAccount(accountId, { last_used: new Date().toISOString() });
    success = true;
  } catch (error) {
    message = error.message || '发布失败';
  } finally {
    for (const file of uploadedTmp) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore cleanup errors.
      }
    }
    await context.close();
  }

  return { success, message, title: options.title || '' };
}

async function loginWithBrowser(platform, onEvent) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: false, channel: 'chromium', args: ['--window-size=800,900'] });
  const context = await browser.newContext({
    viewport: { width: 760, height: 860 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const url = platform === 'weibo'
    ? 'https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog&disp=popup&url=https%3A%2F%2Fweibo.com%2Fnewlogin%3Ftabtype%3Dweibo%26gid%3D102803%26openLoginLayer%3D0%26url%3Dhttps%3A%2F%2Fweibo.com%2F&from=weibopro'
    : 'https://www.toutiao.com/';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (platform === 'toutiao') {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {
      // Continue even if the page never reaches network idle.
    }
    const loginSelectors = [
      'text=登录',
      '.login-button',
      '[data-click="login"]',
      "button:has-text('登录')",
    ];
    for (const selector of loginSelectors) {
      try {
        const locator = page.locator(selector).first;
        if (await locator.isVisible({ timeout: 2500 })) {
          await locator.click({ timeout: 5000 });
          break;
        }
      } catch {
        // Try the next selector.
      }
    }
  }
  onEvent({ type: 'progress', message: '请在弹出的浏览器窗口中登录' });
  try {
    if (platform === 'weibo') {
      await page.waitForFunction(() => {
        const host = window.location.hostname;
        return host.includes('weibo.com') && !host.includes('passport');
      }, { timeout: 300000 });
    } else {
      await page.waitForFunction(() => document.cookie.includes('sessionid') || document.cookie.includes('tt_sessionid'), { timeout: 300000 });
    }
  } catch {
    await browser.close();
    return { success: false, message: '登录超时，请重试' };
  }
  if (platform === 'weibo') {
    try {
      await page.goto('https://weibo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      // The login page may already be on weibo.com; keep the cookies we have.
    }
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    // Continue with the cookies that are already available.
  }
  await sleep(2000);
  let cookies = await context.cookies(['https://weibo.com/']);
  if (!cookies.length) cookies = await context.cookies();
  if (!cookies.length) {
    await browser.close();
    return { success: false, message: '登录成功但未获取到 Cookie，请重试' };
  }
  const cookieParts = cookies.map((cookie) => `${cookie.name}=${cookie.value}`);
  const cookie = cookieParts.join('; ');
  if (!cookie) {
    await browser.close();
    return { success: false, message: '登录成功但 Cookie 内容为空，请重试' };
  }
  let identity = {};
  if (platform === 'weibo') {
    const uidCookie = cookies.find((item) => item.name === 'uid')?.value || '';
    identity = await extractWeiboIdentity(page, uidCookie);
    if (!identity.uid || !identity.screen_name) {
      const verified = await verifyWeiboCookie(cookie, uidCookie);
      if (verified.valid) identity = verified;
    }
    if (!identity.uid && uidCookie) identity = { ...identity, uid: uidCookie };
    if (!identity.uid && !identity.screen_name && !uidCookie) {
      await browser.close();
      return { success: false, message: '未获取到微博账号信息，请重试' };
    }
  } else {
    identity = await extractToutiaoIdentity(page);
  }
  await browser.close();
  return { success: true, cookie, ...identity };
}

function pickWeiboUser(payload) {
  const user = payload?.data?.user || payload?.data || payload?.user;
  if (!user || typeof user !== 'object') return {};

  const uid = user.idstr || user.id || user.uid;
  const screenName = user.screen_name || user.name || '';
  const avatar = user.avatar_hd || user.avatar_large || user.profile_image_url || user.avatar_url || user.avatar || '';

  return {
    uid: uid ? String(uid) : '',
    screen_name: screenName,
    avatar,
  };
}

async function extractWeiboIdentity(page, uidHint = '') {
  try {
    const endpoint = uidHint ? `/ajax/profile/info?uid=${encodeURIComponent(uidHint)}` : '/ajax/profile/info';
    const payload = await page.evaluate(async (profileEndpoint) => {
      const response = await fetch(profileEndpoint, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) return null;
      return response.json();
    }, endpoint);
    return pickWeiboUser(payload);
  } catch {
    return {};
  }
}

function cookieValue(cookie, name) {
  for (const part of String(cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

async function fetchWeiboProfile(cookie, uid) {
  if (!uid) return {};
  const response = await axios.get(`https://weibo.com/ajax/profile/info?uid=${encodeURIComponent(uid)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
      Cookie: cookie,
      Referer: 'https://weibo.com/',
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
    timeout: 20000,
  });
  return pickWeiboUser(response.data);
}

async function fetchWeiboUidFromFeed(cookie) {
  try {
    const response = await axios.get('https://weibo.com/ajax/feed/allGroups', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
        Cookie: cookie,
        Referer: 'https://weibo.com/',
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 20000,
    });
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const match = text.match(/"uid"\s*:\s*"(\d+)"/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function extractToutiaoIdentity(page) {
  try {
    const payload = await page.evaluate(async () => {
      const response = await fetch('/pgc/ma/profile/', {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!response.ok) return null;
      return response.json();
    });
    if (payload?.message === 'success') {
      const user = payload.data?.user || {};
      return {
        uid: String(user.user_id || user.id || ''),
        screen_name: user.name || user.screen_name || '',
        avatar: user.avatar_url || user.avatar || '',
      };
    }
  } catch {
    // Continue to fallback.
  }

  try {
    const payload = await page.evaluate(async () => {
      const response = await fetch('/mp/agw/creator_center/user_info?app_id=1231', {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://mp.toutiao.com/profile_v4/index',
        },
      });
      if (!response.ok) return null;
      return response.json();
    });
    if (payload?.message === 'success') {
      return {
        uid: String(payload.user_id || payload.media_id || ''),
        screen_name: payload.name || '',
        avatar: payload.avatar_url || '',
      };
    }
  } catch {
    // Identity extraction is best-effort.
  }

  return {};
}

async function verifyWeiboCookie(cookie, uidHint = '') {
  if (!cookie) return { valid: false, message: '未提供微博 Cookie' };

  let uid = uidHint || cookieValue(cookie, 'uid');
  try {
    let identity = await fetchWeiboProfile(cookie, uid);
    if (!identity.uid) {
      uid = await fetchWeiboUidFromFeed(cookie);
      identity = await fetchWeiboProfile(cookie, uid);
    }
    if (identity.uid) return { valid: true, ...identity };
    return { valid: false, message: '未获取到微博账号信息，请确认 Cookie 是否有效' };
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 403 || error.response?.status === 400) {
      return { valid: false, message: 'Cookie 无效或已过期' };
    }
    return { valid: false, message: `验证失败：${error.message || '网络错误'}` };
  }
}

async function verifyToutiaoCookie(cookie) {
  if (!cookie) return { valid: false, message: '未提供今日头条 Cookie' };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
    Cookie: cookie,
    Referer: 'https://www.toutiao.com/',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
  };

  try {
    const response = await axios.get('https://www.toutiao.com/pgc/ma/profile/', { headers, timeout: 15000 });
    if (response.status === 200 && response.data?.message === 'success') {
      const user = response.data.data?.user || {};
      return {
        valid: true,
        uid: String(user.user_id || user.id || ''),
        screen_name: user.name || user.screen_name || '',
        avatar: user.avatar_url || user.avatar || '',
      };
    }
  } catch {
    // Try the creator center API below.
  }

  try {
    const response = await axios.get('https://mp.toutiao.com/mp/agw/creator_center/user_info?app_id=1231', {
      headers: { ...headers, Referer: 'https://mp.toutiao.com/profile_v4/index' },
      timeout: 15000,
    });
    if (response.status === 200 && response.data?.message === 'success') {
      return {
        valid: true,
        uid: String(response.data.user_id || response.data.media_id || ''),
        screen_name: response.data.name || '',
        avatar: response.data.avatar_url || '',
      };
    }
  } catch {
    // Fall back to basic reachability below.
  }

  try {
    const response = await axios.get('https://www.toutiao.com/', {
      headers: { ...headers, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    if (response.status === 200) {
      return { valid: true, uid: '', screen_name: '', avatar: '', message: 'Cookie 有效，但无法获取用户信息' };
    }
  } catch {
    // Ignore and return invalid below.
  }

  return { valid: false, message: 'Cookie 无效或已过期', uid: '', screen_name: '', avatar: '' };
}

module.exports = {
  settings,
  getProviderKey,
  aiChat,
  aiChatStream,
  generateArticle,
  polishArticle,
  deAiArticle,
  generateTitle,
  generateTitleCandidates,
  polishQueueCaption,
  recommendCelebrities,
  fetchPosts,
  downloadImage,
  scoreImage,
  watermarkMetrics,
  removeWatermark,
  selectCover,
  buildHtml,
  wechatPublish,
  loginWithBrowser,
  verifyWeiboCookie,
  verifyToutiaoCookie,
};
