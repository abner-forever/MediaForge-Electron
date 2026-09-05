const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const routes = require('./routes');
const util = require('./util');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.post('/api/logs/toast', (req, res) => {
    console.log(`[MediaForge:toast/${req.body?.type || 'info'}]`, req.body?.message || '');
    res.json({ success: true });
  });

  app.use(routes);

  const staticDir = util.STATIC_DIR;
  if (fs.existsSync(staticDir)) {
    app.use('/static', express.static(staticDir, { maxAge: '1h' }));
    app.use('/assets', express.static(path.join(staticDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use('/js', express.static(path.join(staticDir, 'js'), { maxAge: '1y', immutable: true }));
    app.use('/vendor', express.static(path.join(staticDir, 'vendor'), { maxAge: '1y', immutable: true }));
  }

  app.get('/', (req, res) => {
    const index = path.join(staticDir, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.status(404).send('Frontend build not found. Run pnpm --dir desktop/web run build.');
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    res.status(status).json({ detail: util.friendlyError(err) });
  });

  app.get('*', (req, res) => {
    const index = path.join(staticDir, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.status(404).send('Frontend build not found.');
  });

  return app;
}

function startServer(port) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`[MediaForge] Node backend listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { createApp, startServer };
