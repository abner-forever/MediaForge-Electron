const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { appState } = require('../state');
const services = require('../services');
const util = require('../util');
const { abort } = require('./shared');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const MATERIAL_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.md', '.txt', '.pdf']);

function countFolderItems(dirPath) {
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__covers__') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) count += countFolderItems(fullPath);
    else if (MATERIAL_EXTS.has(path.extname(entry.name).toLowerCase())) count += 1;
  }
  return count;
}

function buildMaterialTree(dirPath, relativePath = '') {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== '__covers__')
    .sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  const folders = [];
  for (const entry of entries) {
    const childPath = path.join(dirPath, entry.name);
    const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const directFiles = fs.readdirSync(childPath, { withFileTypes: true })
        .filter((item) => item.isFile() && !item.name.startsWith('.') && item.name !== '__covers__' && MATERIAL_EXTS.has(path.extname(item.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((item) => ({
          name: item.name,
          path: childRel ? `${childRel}/${item.name}` : item.name,
          type: 'file',
          item_count: 1,
          children: [],
          files: [],
        }));
      folders.push({
        name: entry.name,
        path: childRel,
        type: 'folder',
        item_count: countFolderItems(childPath),
        children: buildMaterialTree(childPath, childRel),
        files: directFiles,
      });
    }
  }
  return folders;
}

function listMaterialsGroups() {
  const root = util.DOWNLOAD_DIR;
  if (!fs.existsSync(root)) return { groups: [], total_images: 0 };
  const groups = [];
  let totalImages = 0;
  for (const celebName of fs.readdirSync(root)) {
    const celebDir = path.join(root, celebName);
    if (!fs.statSync(celebDir).isDirectory() || celebName.startsWith('.') || celebName === '__covers__') continue;
    const celeb = { celebrity: celebName, scenes: [], total: 0 };
    for (const sceneName of fs.readdirSync(celebDir)) {
      const sceneDir = path.join(celebDir, sceneName);
      if (!fs.statSync(sceneDir).isDirectory()) continue;
      const scene = { scene: sceneName, posts: [], total: 0 };
      for (const postName of fs.readdirSync(sceneDir)) {
        const postDir = path.join(sceneDir, postName);
        if (!fs.statSync(postDir).isDirectory()) continue;
        const images = fs.readdirSync(postDir).filter((file) => ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(file).toLowerCase())).map((file) => path.join(postDir, file));
        if (images.length) {
          scene.posts.push({ post_id: postName, images });
          scene.total += images.length;
          totalImages += images.length;
        }
      }
      if (scene.posts.length) {
        celeb.scenes.push(scene);
        celeb.total += scene.total;
      }
    }
    if (celeb.scenes.length) groups.push(celeb);
  }
  return { groups, total_images: totalImages };
}

router.get('/api/materials', (req, res) => {
  res.json(listMaterialsGroups());
});

router.delete('/api/materials', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  let deleted = 0;
  for (const rel of req.body?.paths || []) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(path.resolve(root))) continue;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.unlinkSync(target);
      deleted += 1;
    }
  }
  res.json({ success: true, deleted });
});

router.get('/api/materials/tree', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  res.json({ tree: fs.existsSync(root) ? buildMaterialTree(root) : [] });
});

router.get('/api/materials/browse', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const target = req.query.path ? path.resolve(root, String(req.query.path)) : root;
  if (!target.startsWith(path.resolve(root))) return abort(res, 403, '路径越界');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return abort(res, 404, `文件夹不存在: ${req.query.path}`);
  const folders = [];
  const files = [];
  for (const name of fs.readdirSync(target)) {
    const full = path.join(target, name);
    if (name.startsWith('.') || name === '__covers__') continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) folders.push({ name, path: path.relative(root, full).split(path.sep).join('/'), type: 'folder', item_count: countFolderItems(full) });
    else files.push({ name, path: path.relative(root, full).split(path.sep).join('/'), type: 'file', size: stat.size, suffix: path.extname(name).toLowerCase() });
  }
  res.json({ folders, files, breadcrumb: [{ name: '全部素材', path: '' }] });
});

router.put('/api/materials/sort-order', (req, res) => {
  appState.setFolderSortOrder(req.body?.path || '', req.body?.order || []);
  res.json({ success: true });
});

router.get('/api/materials/sort-order', (req, res) => {
  res.json({ path: req.query.path || '', order: appState.getFolderSortOrder(req.query.path || '') });
});

router.post('/api/materials/folder', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const parent = req.body?.parent_path ? path.resolve(root, req.body.parent_path) : root;
  const target = path.join(parent, req.body?.name || '新建文件夹');
  fs.mkdirSync(target, { recursive: true });
  res.json({ success: true, path: path.relative(root, target).split(path.sep).join('/') });
});

router.put('/api/materials/folder', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const target = path.resolve(root, req.body?.path || '');
  const next = path.join(path.dirname(target), req.body?.new_name || '');
  fs.renameSync(target, next);
  res.json({ success: true, path: path.relative(root, next).split(path.sep).join('/') });
});

router.put('/api/materials/file', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const target = path.resolve(root, req.body?.path || '');
  const next = path.join(path.dirname(target), req.body?.new_name || '');
  fs.renameSync(target, next);
  res.json({ success: true, path: path.relative(root, next).split(path.sep).join('/') });
});

router.delete('/api/materials/folder', (req, res) => {
  const target = path.resolve(util.DOWNLOAD_DIR, String(req.query.path || ''));
  if (!fs.existsSync(target)) return abort(res, 404, `文件夹不存在: ${req.query.path}`);
  fs.rmSync(target, { recursive: true, force: true });
  res.json({ success: true });
});

router.post('/api/materials/move', (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const dest = req.body?.destination ? path.resolve(root, req.body.destination) : root;
  let moved = 0;
  for (const rel of req.body?.items || []) {
    const source = path.resolve(root, rel);
    if (!fs.existsSync(source)) continue;
    const next = path.join(dest, path.basename(source));
    fs.renameSync(source, next);
    moved += 1;
  }
  res.json({ success: true, moved });
});

router.get('/api/materials/file/*', (req, res) => {
  const rel = req.params[0];
  const target = path.resolve(util.DOWNLOAD_DIR, rel);
  if (!target.startsWith(path.resolve(util.DOWNLOAD_DIR)) || !fs.existsSync(target)) return abort(res, 404, '文件不存在');
  const mime = { '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  fs.createReadStream(target).pipe(res);
});

router.post('/api/materials/upload', upload.single('file'), (req, res) => {
  const root = util.DOWNLOAD_DIR;
  const parent = req.body?.parent_path ? path.resolve(root, req.body.parent_path) : root;
  const file = req.file;
  if (!file) return abort(res, 400, '缺少文件');
  const name = path.basename(file.originalname);
  const target = path.join(parent, name);
  fs.writeFileSync(target, file.buffer);
  res.json({ success: true, path: path.relative(root, target).split(path.sep).join('/'), name, size: file.size, suffix: path.extname(name).toLowerCase() });
});

router.post('/api/materials/score', (req, res) => {
  const paths = (req.body?.image_paths || []).map((p) => util.toAbs(p));
  const scores = {};
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue;
    const info = services.scoreImage(fs.readFileSync(filePath), Boolean(req.body?.use_vision));
    scores[util.toRel(filePath)] = info;
    appState.updateMaterialsMeta(util.toRel(filePath), { scored: true, score: info.score, score_reason: info.reason });
  }
  const values = Object.values(scores);
  res.json({ success: true, scores, vision_count: values.filter((v) => v.method === 'vision').length, heuristic_count: values.filter((v) => v.method === 'heuristic').length });
});

router.get('/api/materials/meta', (req, res) => {
  res.json({ meta: appState.getMaterialsMeta(req.query.path || null) });
});

router.put('/api/materials/meta', (req, res) => {
  const body = req.body || {};
  if (!body.path) return abort(res, 400, '缺少 path');
  const updates = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'path'));
  appState.updateMaterialsMeta(body.path, updates);
  res.json({ success: true, meta: appState.getMaterialsMeta(body.path) });
});

router.get('/api/materials/tags', (req, res) => {
  res.json(appState.getAllMaterialsTags());
});

module.exports = router;
