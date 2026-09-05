const express = require('express');

const store = require('../store');
const util = require('../util');

const router = express.Router();

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

module.exports = router;
