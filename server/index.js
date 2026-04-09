import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { store } from './store.js';
import { startWatchers } from './watchers.js';
import { startBroadcaster } from './broadcaster.js';
import { startPlanDetector } from './plan-detector.js';
import hookReceiver from './hook-receiver.js';

import { PORT, VITE_DEV_PORT } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', hookReceiver);

app.get('/api/snapshot', (_req, res) => {
  res.json(store.getSnapshot());
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/api/refresh', (_req, res) => {
  const result = store.forceRefresh();
  res.json({ status: 'ok', ...result });
});

// Serve built frontend in production
const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// Start everything
store.failureStore.load();
startWatchers();
startBroadcaster(server);
startPlanDetector(store);

// Prune stale live sessions every 5 minutes (manual refresh button handles immediate cleanup)
setInterval(() => store.pruneStale(), 5 * 60_000);

server.listen(PORT, () => {
  console.log(`\n  Claude Code Telemetry Server`);
  console.log(`  API:       http://localhost:${PORT}/api/snapshot`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`  Dashboard: http://localhost:${VITE_DEV_PORT} (dev) or http://localhost:${PORT} (prod)\n`);
});