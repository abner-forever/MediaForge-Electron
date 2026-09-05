const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { appState } = require('../state');
const store = require('../store');
const { abort, sse } = require('./shared');

const router = express.Router();

router.get('/api/wechat/accounts', (req, res) => res.json({ accounts: store.listWechatAccounts() }));
router.post('/api/wechat/accounts', (req, res) => {
  if (!req.body?.name) return abort(res, 400, '账号名称不能为空');
  res.json({ success: true, account: store.addWechatAccount(req.body.name) });
});
router.delete('/api/wechat/accounts/:account_id', (req, res) => {
  if (!store.removeWechatAccount(req.params.account_id)) return abort(res, 404, '账号不存在');
  res.json({ success: true });
});
router.get('/api/wechat/accounts/:account_id/status', (req, res) => {
  const account = store.getWechatAccount(req.params.account_id);
  if (!account) return abort(res, 404, '账号不存在');
  res.json({ logged_in: store.validateWechatLogin(req.params.account_id), name: account.name });
});

router.get('/api/wechat/accounts/:account_id/login', async (req, res) => {
  const account = store.getWechatAccount(req.params.account_id);
  if (!account) return abort(res, 404, '账号不存在');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const { chromium } = require('playwright');
  try {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    sse(res, 'progress', { message: '请在浏览器窗口中扫码登录微信公众号' });
    try {
      await page.waitForFunction(() => window.location.href.includes('/cgi-bin/'), { timeout: 300000 });
    } catch {
      sse(res, 'error', { message: '登录超时，请重试' });
      await browser.close();
      return res.end();
    }
    const cookies = await context.cookies();
    const { statePath } = store.wechatAccountPaths(req.params.account_id);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ cookies, origins: [] }, null, 2));
    store.updateWechatAccount(req.params.account_id, { last_used: new Date().toISOString() });
    sse(res, 'done', { message: '登录完成' });
    await browser.close();
  } catch (err) {
    sse(res, 'error', { message: err.message });
  }
  res.end();
});

router.get('/api/wechat/accounts/:account_id/sync-effects', (req, res) => res.json({ success: true, items: [] }));
router.post('/api/wechat/accounts/:account_id/logout', (req, res) => {
  const { statePath } = store.wechatAccountPaths(req.params.account_id);
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  res.json({ success: true });
});
router.post('/api/wechat/accounts/:account_id/default', (req, res) => {
  if (!store.setDefaultWechatAccount(req.params.account_id)) return abort(res, 404, '账号不存在');
  res.json({ success: true });
});

function collectPublishHistory() {
  const items = [];
  for (const item of appState.getQueue()) {
    if (['published', 'saved_to_wechat', 'failed'].includes(item.status || '')) {
      items.push({ id: item.id, title: item.title, type: item.type || 'image', status: item.status, publish_time: item.time || '', images_count: (item.images || []).length, account_id: item.account_id || '' });
    }
  }
  for (const article of appState.getArticles()) {
    if (['published', 'saved_to_wechat', 'failed'].includes(article.status || '')) {
      items.push({ id: article.id, title: article.title, type: 'article', status: article.status, publish_time: article.updated_at || article.created_at || '', images_count: (article.images || []).length, account_id: article.account_id || '' });
    }
  }
  return items.sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time)));
}

router.get('/api/wechat/accounts/history', (req, res) => {
  const items = collectPublishHistory();
  res.json({ items, total: items.length });
});

router.get('/api/wechat/accounts/:account_id/history', (req, res) => {
  const items = collectPublishHistory().filter((item) => item.account_id === req.params.account_id);
  res.json({ items, total: items.length, account_id: req.params.account_id });
});

module.exports = router;
