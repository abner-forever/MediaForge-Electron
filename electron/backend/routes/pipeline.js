const path = require('node:path');
const express = require('express');

const { appState } = require('../state');
const services = require('../services');
const util = require('../util');
const { sse } = require('./shared');

const router = express.Router();

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
