const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { appState, VIDEOS_DIR } = require('../state');
const { abort } = require('./shared');

const router = express.Router();

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

module.exports = router;
