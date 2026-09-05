const path = require('node:path');
const { DATA_DIR, DOWNLOAD_DIR, ensureDir, readJson, writeJson, uuid, parseBool } = require('./util');

const STATE_DIR = path.join(DATA_DIR, 'state');
const QUEUE_PATH = path.join(DATA_DIR, 'queue.json');
const POSTS_PATH = path.join(DATA_DIR, 'posts.json');
const OPERATIONS_PATH = path.join(STATE_DIR, 'operations.json');
const ARTICLES_PATH = path.join(STATE_DIR, 'articles.json');
const MATERIALS_META_PATH = path.join(STATE_DIR, 'materials_meta.json');
const PUBLISH_EFFECTS_PATH = path.join(STATE_DIR, 'publish_effects.json');
const CREDITS_PATH = path.join(STATE_DIR, 'credits.json');
const VIDEO_META_PATH = path.join(STATE_DIR, 'video_tasks.json');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');

const INITIAL_CREDITS = 100;
const PUBLISH_COST = 10;
const CHECKIN_REWARDS = [5, 10, 15, 20, 25, 30, 50];

function today() {
  return new Date().toISOString().slice(0, 10);
}

class AppState {
  constructor() {
    this.selectedImages = [];
    this.discoveryResults = [];
    this.imageScores = {};
    this.publishActive = false;
    this.activeTasks = new Set();
    this.publishLogs = [];
    this.publishLogsMap = {};
    this.publishQueue = readJson(QUEUE_PATH, []).map((item) => ({ id: item.id || uuid(), ...item }));
    this.operations = readJson(OPERATIONS_PATH, []).map((op) => ({ id: op.id || uuid(), ...op }));
    this.articles = readJson(ARTICLES_PATH, []);
    this.materialsMeta = readJson(MATERIALS_META_PATH, {});
    this.publishEffects = readJson(PUBLISH_EFFECTS_PATH, {});
    this.credits = readJson(CREDITS_PATH, {});
    if (!this.credits.balance) this.credits = this._newCredits();
    ensureDir(DOWNLOAD_DIR);
  }

  _newCredits() {
    return {
      balance: INITIAL_CREDITS,
      transactions: [{
        id: uuid(),
        type: 'earn',
        source: 'gift',
        amount: INITIAL_CREDITS,
        balance_after: INITIAL_CREDITS,
        description: '新用户赠送积分',
        created_at: new Date().toISOString(),
      }],
      daily_checkin: { last_date: '', streak: 0 },
      checkin_history: {},
    };
  }

  _saveQueue() { writeJson(QUEUE_PATH, this.publishQueue); }
  _saveOperations() { writeJson(OPERATIONS_PATH, this.operations.slice(-200)); }
  _saveArticles() { writeJson(ARTICLES_PATH, this.articles); }
  _saveMaterialsMeta() { writeJson(MATERIALS_META_PATH, this.materialsMeta); }
  _saveEffects() { writeJson(PUBLISH_EFFECTS_PATH, this.publishEffects); }
  _saveCredits() { writeJson(CREDITS_PATH, this.credits); }

  addSelectedImage(imagePath) {
    if (imagePath && !this.selectedImages.includes(imagePath)) this.selectedImages.push(imagePath);
  }

  removeSelectedImage(imagePath) {
    this.selectedImages = this.selectedImages.filter((item) => item !== imagePath);
  }

  clearSelectedImages() {
    this.selectedImages = [];
  }

  getSelectedImages() {
    return [...this.selectedImages];
  }

  getQueue() {
    return this.publishQueue;
  }

  addToQueue(item) {
    const queueItem = {
      ...item,
      id: uuid(),
      time: new Date().toISOString(),
    };
    this.publishQueue.push(queueItem);
    this._saveQueue();
    return queueItem;
  }

  getQueueItemById(itemId) {
    return this.publishQueue.find((item) => item.id === itemId) || null;
  }

  updateQueueItemById(itemId, updates) {
    const item = this.getQueueItemById(itemId);
    if (!item) return false;
    Object.assign(item, updates);
    this._saveQueue();
    return true;
  }

  removeQueueItemById(itemId) {
    const index = this.publishQueue.findIndex((item) => item.id === itemId);
    if (index < 0) return false;
    this.publishQueue.splice(index, 1);
    this._saveQueue();
    return true;
  }

  getArticles(status) {
    const articles = status ? this.articles.filter((a) => a.status === status) : this.articles;
    return [...articles].reverse();
  }

  getArticle(articleId) {
    return this.articles.find((a) => a.id === articleId) || null;
  }

  addArticle(data) {
    const now = new Date().toISOString();
    const article = {
      id: uuid(),
      title: data.title || '',
      content: data.content || '',
      summary: data.summary || '',
      cover: data.cover || '',
      images: data.images || [],
      tags: data.tags || [],
      celebrity: data.celebrity || '',
      source: data.source || '',
      ai_generated: Boolean(data.ai_generated),
      status: data.status || 'draft',
      created_at: now,
      updated_at: now,
    };
    this.articles.push(article);
    this._saveArticles();
    return article;
  }

  updateArticle(articleId, updates) {
    const article = this.getArticle(articleId);
    if (!article) return null;
    const allowed = new Set(['title', 'content', 'summary', 'cover', 'images', 'tags', 'celebrity', 'source', 'ai_generated', 'status', 'account_id', 'error']);
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.has(key)) article[key] = value;
    }
    article.updated_at = new Date().toISOString();
    this._saveArticles();
    return article;
  }

  deleteArticle(articleId) {
    const index = this.articles.findIndex((a) => a.id === articleId);
    if (index < 0) return false;
    this.articles.splice(index, 1);
    this._saveArticles();
    return true;
  }

  setDiscoveryResults(posts) { this.discoveryResults = posts; }
  getDiscoveryResults() { return this.discoveryResults; }
  setImageScores(scores) { Object.assign(this.imageScores, scores); }
  getImageScores() { return { ...this.imageScores }; }

  addOperation(action, detail = '') {
    this.operations.push({ id: uuid(), time: new Date().toISOString(), action, detail });
    this._saveOperations();
  }

  getOperations(page = 1, pageSize = 10) {
    const reversed = [...this.operations].reverse();
    const start = (page - 1) * pageSize;
    return { items: reversed.slice(start, start + pageSize), total: reversed.length, page, page_size: pageSize };
  }

  deleteOperationsById(ids) {
    const idSet = new Set(ids || []);
    const before = this.operations.length;
    this.operations = this.operations.filter((op) => !idSet.has(op.id));
    this._saveOperations();
    return before - this.operations.length;
  }

  clearOperations() { this.operations = []; this._saveOperations(); }

  clearPublishLogs(sessionId = '') {
    if (sessionId) this.publishLogsMap[sessionId] = [];
    else this.publishLogs = [];
    this.publishActive = true;
  }

  addPublishLog(msg, sessionId = '') {
    if (sessionId) {
      if (!this.publishLogsMap[sessionId]) this.publishLogsMap[sessionId] = [];
      this.publishLogsMap[sessionId].push(msg);
    } else {
      this.publishLogs.push(msg);
    }
  }

  getPublishLogs(sessionId = '') {
    return sessionId ? [...(this.publishLogsMap[sessionId] || [])] : [...this.publishLogs];
  }

  finishPublish() { this.publishActive = false; }

  getMaterialsMeta(relPath) {
    if (relPath) return this.materialsMeta[relPath] || null;
    return { ...this.materialsMeta };
  }

  updateMaterialsMeta(relPath, updates) {
    if (!this.materialsMeta[relPath]) {
      this.materialsMeta[relPath] = {
        path: relPath,
        tags: [],
        source_platform: '',
        source_url: '',
        used_count: 0,
        used_in_articles: [],
        is_cover: false,
        celebrity: '',
        scene: '',
        scored: false,
        score: 0,
        score_reason: '',
      };
    }
    Object.assign(this.materialsMeta[relPath], updates);
    this._saveMaterialsMeta();
  }

  getFolderSortOrder(folderPath) {
    return this.materialsMeta[`_sort:${folderPath}`] || [];
  }

  setFolderSortOrder(folderPath, order) {
    this.materialsMeta[`_sort:${folderPath}`] = order;
    this._saveMaterialsMeta();
  }

  getAllMaterialsTags() {
    const tags = new Set();
    const celebrities = new Set();
    const scenes = new Set();
    for (const [key, data] of Object.entries(this.materialsMeta)) {
      if (key.startsWith('_sort:')) continue;
      for (const tag of data.tags || []) tags.add(tag);
      if (data.celebrity) celebrities.add(data.celebrity);
      if (data.scene) scenes.add(data.scene);
    }
    return { tags: [...tags].sort(), celebrities: [...celebrities].sort(), scenes: [...scenes].sort() };
  }

  getPublishEffects(itemId) {
    if (itemId) return this.publishEffects[itemId] || null;
    return { ...this.publishEffects };
  }

  updatePublishEffect(itemId, data) {
    const now = new Date().toISOString();
    const existing = this.publishEffects[itemId] || { item_id: itemId };
    this.publishEffects[itemId] = { ...existing, ...data, item_id: itemId, updated_at: now };
    if (!this.publishEffects[itemId].publish_time) {
      const queueItem = this.getQueueItemById(itemId);
      this.publishEffects[itemId].publish_time = queueItem?.time || now;
    }
    this._saveEffects();
  }

  clearPublishEffects() {
    this.publishEffects = {};
    this._saveEffects();
  }

  getCreditsBalance() { return Number(this.credits.balance || 0); }
  getCheckinStatus() {
    const checkin = this.credits.daily_checkin || {};
    const lastDate = checkin.last_date || '';
    const streak = checkin.streak || 0;
    const canCheckin = lastDate !== today();
    const dayIndex = Math.min(streak, CHECKIN_REWARDS.length - 1);
    return { can_checkin: canCheckin, streak, today_earned: canCheckin ? CHECKIN_REWARDS[dayIndex] : 0 };
  }

  getCheckinHistory(year, month) {
    const history = this.credits.checkin_history || {};
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const records = {};
    let totalEarned = 0;
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (history[key]) {
        records[key] = history[key];
        totalEarned += Number(history[key].earned || 0);
      }
    }
    return {
      year,
      month,
      records,
      total_days: last.getDate(),
      checked_days: Object.keys(records).length,
      total_earned: totalEarned,
      current_streak: this.credits.daily_checkin?.streak || 0,
      max_streak_in_month: 0,
    };
  }

  checkin() {
    const checkin = this.credits.daily_checkin || {};
    const todayKey = today();
    if (checkin.last_date === todayKey) return { success: false, message: '今日已签到' };
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = checkin.last_date === yesterday ? (checkin.streak || 0) + 1 : 1;
    const earned = CHECKIN_REWARDS[Math.min(streak - 1, CHECKIN_REWARDS.length - 1)];
    this.credits.balance = (this.credits.balance || 0) + earned;
    this.credits.daily_checkin = { last_date: todayKey, streak };
    this.credits.checkin_history = this.credits.checkin_history || {};
    this.credits.checkin_history[todayKey] = { earned, streak };
    this.credits.transactions = this.credits.transactions || [];
    this.credits.transactions.push({ id: uuid(), type: 'earn', source: 'checkin', amount: earned, balance_after: this.credits.balance, description: `连续签到第${streak}天`, created_at: new Date().toISOString() });
    this.credits.transactions = this.credits.transactions.slice(-500);
    this._saveCredits();
    return { success: true, earned, streak, balance: this.credits.balance };
  }

  getCreditsHistory(page = 1, pageSize = 20) {
    const transactions = [...(this.credits.transactions || [])].reverse();
    const start = (page - 1) * pageSize;
    return { transactions: transactions.slice(start, start + pageSize), total: transactions.length, page, page_size: pageSize };
  }

  getDailyTasks() {
    const checkinDone = this.credits.daily_checkin?.last_date === today();
    const dailyVideo = this.credits.daily_video || {};
    const videoCount = dailyVideo.date === today() ? dailyVideo.count || 0 : 0;
    const videoEarned = dailyVideo.date === today() ? dailyVideo.earned || 0 : 0;
    const checkinToday = this.credits.checkin_history?.[today()]?.earned || 0;
    return {
      tasks: [
        { id: 'watch_video', type: 'video', label: '观看视频', description: '观看短视频赚取积分，每日上限10次', current: videoCount, target: 10, completed: videoCount >= 10, reward: '3/次', icon: 'play_circle' },
        { id: 'daily_checkin', type: 'checkin', label: '每日签到', description: '每日签到领取积分奖励，连续签到奖励递增', current: checkinDone ? 1 : 0, target: 1, completed: checkinDone, reward: '5~50', icon: 'calendar_check' },
      ],
      today_earned: videoEarned + checkinToday,
    };
  }

  spendCredits(amount, source, description) {
    if ((this.credits.balance || 0) < amount) return false;
    this.credits.balance -= amount;
    this.credits.transactions = this.credits.transactions || [];
    this.credits.transactions.push({ id: uuid(), type: 'spend', source, amount: -amount, balance_after: this.credits.balance, description, created_at: new Date().toISOString() });
    this.credits.transactions = this.credits.transactions.slice(-500);
    this._saveCredits();
    return true;
  }

  getVideoList() {
    return readJson(VIDEO_META_PATH, { videos: [] }).videos || [];
  }
}

const appState = new AppState();

module.exports = { appState, PUBLISH_COST, VIDEOS_DIR, VIDEO_META_PATH };
