const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const axios = require('axios');
const sharp = require('sharp');

const { appState, PUBLISH_COST } = require('../state');
const services = require('../services');
const util = require('../util');
const { jsonError, sse, walkFiles } = require('./shared');

const router = express.Router();

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

module.exports = router;
