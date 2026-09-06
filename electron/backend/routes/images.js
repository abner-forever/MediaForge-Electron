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
    const targetUrl = String(req.query.url || '');
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https 图片地址');

    const referer = ['sinaimg.cn', 'sina.cn', 'weibo.com'].some((host) => parsed.hostname.endsWith(host))
      ? 'https://weibo.com/'
      : parsed.origin;
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
        Referer: referer,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    let data = Buffer.from(response.data);
    const size = Number(req.query.size || (req.query.thumbnail ? 320 : 0));
    if (size) {
      data = await sharp(data).resize({ width: size, height: size, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
    } else {
      res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    }
    res.send(data);
  } catch (err) {
    res.status(502).json({ detail: `代理请求失败: ${err.message || '未知错误'}` });
  }
});

module.exports = router;
