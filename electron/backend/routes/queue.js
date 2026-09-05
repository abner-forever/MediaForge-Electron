const fs = require('node:fs');
const express = require('express');

const { appState, PUBLISH_COST } = require('../state');
const services = require('../services');
const util = require('../util');
const { jsonError } = require('./shared');

const router = express.Router();

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

module.exports = router;
