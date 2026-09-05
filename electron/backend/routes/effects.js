const express = require('express');

const { appState } = require('../state');
const services = require('../services');
const util = require('../util');
const { sse } = require('./shared');

const router = express.Router();

function effectsSummary() {
  const effects = appState.getPublishEffects();
  const values = Object.values(effects);
  if (!values.length) return { total_posts: 0, total_reads: 0, total_likes: 0, avg_reads: 0, avg_likes: 0, best_publish_hour: 0, best_day_of_week: 0, top_celebrities: [] };
  const totalReads = values.reduce((sum, item) => sum + Number(item.reads || 0), 0);
  const totalLikes = values.reduce((sum, item) => sum + Number(item.likes || 0), 0);
  return { total_posts: values.length, total_reads: totalReads, total_likes: totalLikes, avg_reads: Math.round(totalReads / values.length), avg_likes: Math.round(totalLikes / values.length), best_publish_hour: 0, best_day_of_week: 0, top_celebrities: [] };
}

function effectValues() {
  return Object.entries(appState.getPublishEffects()).map(([itemId, item]) => ({ ...item, item_id: itemId }));
}

function groupEffects(key) {
  const groups = {};
  for (const item of effectValues()) {
    const value = item[key] || '未知';
    if (!groups[value]) groups[value] = { key: value, reads: 0, likes: 0, posts: 0 };
    groups[value].reads += Number(item.reads || 0);
    groups[value].likes += Number(item.likes || 0);
    groups[value].posts += 1;
  }
  return Object.values(groups).sort((a, b) => b.reads - a.reads);
}

router.get('/api/effects/summary', (req, res) => res.json(effectsSummary()));

router.get('/api/effects/trend', (req, res) => {
  const effects = effectValues();
  const buckets = {};
  for (const item of effects) {
    const date = util.parsePublishTime(item.publish_time);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    if (!buckets[key]) buckets[key] = { date: key, reads: 0, likes: 0, posts: 0, comments: 0, shares: 0, favorites: 0 };
    buckets[key].reads += Number(item.reads || 0);
    buckets[key].likes += Number(item.likes || 0);
    buckets[key].posts += 1;
    buckets[key].comments += Number(item.comment_num || item.comments || 0);
    buckets[key].shares += Number(item.shares || 0);
    buckets[key].favorites += Number(item.favorites || 0);
  }
  res.json({ trend: Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date)) });
});

router.get('/api/effects/compare', (req, res) => {
  res.json({ by_source_platform: groupEffects('source_platform'), by_content_type: groupEffects('content_type'), by_celebrity: groupEffects('celebrity') });
});

router.get('/api/effects/celebrity-rank', (req, res) => {
  const celebrities = groupEffects('celebrity').map((item) => ({ name: item.key, avg_reads: Math.round(item.reads / item.posts), count: item.posts })).slice(0, 10);
  res.json({ celebrities });
});

router.get('/api/effects/funnel', (req, res) => {
  const effects = effectValues().filter((item) => !req.query.item_id || item.item_id === req.query.item_id);
  res.json({
    total_reads: effects.reduce((sum, item) => sum + Number(item.reads || 0), 0),
    total_likes: effects.reduce((sum, item) => sum + Number(item.likes || 0), 0),
    total_shares: effects.reduce((sum, item) => sum + Number(item.shares || 0), 0),
    total_favorites: effects.reduce((sum, item) => sum + Number(item.favorites || 0), 0),
    total_comments: effects.reduce((sum, item) => sum + Number(item.comment_num || item.comments || 0), 0),
  });
});

router.get('/api/effects/article-options', (req, res) => {
  const seen = new Map();
  for (const item of effectValues()) {
    if (!item.title) continue;
    const existing = seen.get(item.title);
    if (!existing || String(item.publish_time) > String(existing.publish_time)) seen.set(item.title, { item_id: item.item_id, title: item.title, publish_time: item.publish_time || '' });
  }
  res.json({ articles: [...seen.values()].sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time))) });
});

router.get('/api/effects/top-articles', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  const articles = effectValues().filter((item) => Number(item.reads || 0) > 0).sort((a, b) => Number(b.reads || 0) - Number(a.reads || 0)).slice(0, limit).map((item) => ({
    item_id: item.item_id,
    title: item.title || '',
    reads: Number(item.reads || 0),
    likes: Number(item.likes || 0),
    shares: Number(item.shares || 0),
    favorites: Number(item.favorites || 0),
    comments: Number(item.comment_num || item.comments || 0),
    celebrity: item.celebrity || '',
    source_platform: item.source_platform || '',
    publish_time: item.publish_time || '',
    image_count: Number(item.image_count || 0),
  }));
  res.json({ articles });
});

router.get('/api/effects/image-analysis', (req, res) => {
  const groups = {};
  for (const item of effectValues()) {
    const count = Number(item.image_count || 0);
    const reads = Number(item.reads || 0);
    if (!reads) continue;
    if (!groups[count]) groups[count] = [];
    groups[count].push(reads);
  }
  res.json({ items: Object.entries(groups).map(([imageCount, values]) => ({ image_count: Number(imageCount), avg_reads: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length), count: values.length })).sort((a, b) => a.image_count - b.image_count) });
});

router.get('/api/effects/ai-analysis', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const summary = effectsSummary();
    const stream = await services.aiChatStream([{ role: 'user', content: `请分析以下公众号运营数据并给出建议：\n${JSON.stringify(summary)}` }]);
    for await (const chunk of stream) {
      sse(res, 'token', { token: chunk.choices?.[0]?.delta?.content || '' });
    }
    sse(res, 'done');
  } catch (err) {
    sse(res, 'error', { message: err.message });
  }
  res.end();
});

router.get('/api/effects/export', (req, res) => {
  const effects = appState.getPublishEffects();
  const headers = ['文章ID', '标题', '账号ID', '发布时间', '阅读量', '点赞数', '转发数', '收藏数', '评论数', '内容类型', '来源平台', '艺人', '图片数', '更新时间'];
  const fields = ['item_id', 'title', 'account_id', 'publish_time', 'reads', 'likes', 'shares', 'favorites', 'comments', 'content_type', 'source_platform', 'celebrity', 'image_count', 'updated_at'];
  const rows = [headers.join(',')];
  for (const item of Object.values(effects)) rows.push(fields.map((f) => `"${String(item[f] ?? '').replace(/"/g, '""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8-sig');
  res.setHeader('Content-Disposition', 'attachment; filename=effects_export.csv');
  res.send(rows.join('\n'));
});

router.get('/api/effects/mp-articles', (req, res) => {
  let articles = effectValues();
  const search = String(req.query.search || '').toLowerCase();
  const celebrity = String(req.query.celebrity || '');
  if (search) articles = articles.filter((item) => String(item.title || '').toLowerCase().includes(search));
  if (celebrity) articles = articles.filter((item) => item.celebrity === celebrity);
  const sortKey = req.query.sort_key || 'publish_time';
  const sortDir = req.query.sort_dir || 'desc';
  articles.sort((a, b) => {
    const av = a[sortKey] || 0;
    const bv = b[sortKey] || 0;
    const result = typeof av === 'string' ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
    return sortDir === 'asc' ? result : -result;
  });
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.max(1, Math.min(100, Number(req.query.page_size || 10)));
  const total = articles.length;
  const paged = articles.slice((page - 1) * pageSize, page * pageSize);
  const celebrities = [...new Set(effectValues().map((item) => item.celebrity).filter(Boolean))].sort();
  res.json({ articles: paged, total, page, page_size: pageSize, celebrities });
});

router.delete('/api/effects/mp-articles', (req, res) => {
  appState.clearPublishEffects();
  res.json({ success: true, deleted: 0 });
});

router.get('/api/effects', (req, res) => res.json({ effects: appState.getPublishEffects() }));

router.get('/api/effects/:item_id', (req, res) => {
  res.json({ effect: appState.getPublishEffects(req.params.item_id) || {} });
});

router.post('/api/effects/:item_id', (req, res) => {
  appState.updatePublishEffect(req.params.item_id, req.body || {});
  res.json({ success: true, effect: appState.getPublishEffects(req.params.item_id) });
});

module.exports = router;
