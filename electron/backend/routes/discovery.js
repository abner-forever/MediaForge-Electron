const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { appState } = require('../state');
const store = require('../store');
const services = require('../services');
const util = require('../util');
const { jsonError, sse } = require('./shared');

const router = express.Router();

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

module.exports = router;
