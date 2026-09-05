const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const util = require('../util');
const { abort } = require('./shared');

const router = express.Router();

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

module.exports = router;
