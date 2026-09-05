const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const axios = require('axios');
const sharp = require('sharp');

const util = require('../util');
const { abort } = require('./shared');

const router = express.Router();

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

module.exports = router;
