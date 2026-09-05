const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { appState } = require('../state');
const services = require('../services');
const util = require('../util');
const { walkFiles } = require('./shared');

const router = express.Router();

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

module.exports = router;
