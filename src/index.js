import express from 'express';
import helmet from 'helmet';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { validateUrl } from './security/urlPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(helmet({ contentSecurityPolicy: false }));

const sessions = new Map();
const VIEW_W = 1280;
const VIEW_H = 720;
let browser;

function isPublicPath(p) {
  return p === '/' || p === '/app.js' || p === '/styles.css' || p === '/healthz';
}

function authHttp(req, res, next) {
  if (!config.apiKey || isPublicPath(req.path)) return next();
  const hdr = req.header('authorization') || '';
  if (hdr !== `Bearer ${config.apiKey}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.use(authHttp);
app.use(express.static(publicDir, { index: false }));

function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > config.sessionTtlMs) return null;
  return s;
}

function scalePoint(x, y, vw, vh) {
  const sx = VIEW_W / Math.max(vw || VIEW_W, 1);
  const sy = VIEW_H / Math.max(vh || VIEW_H, 1);
  return { x: Math.max(0, Math.round(x * sx)), y: Math.max(0, Math.round(y * sy)) };
}

async function newSession() {
  if (sessions.size >= config.maxSessions) throw new Error('session_limit_reached');
  const context = await browser.newContext({
    viewport: { width: VIEW_W, height: VIEW_H },
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    bypassCSP: false,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.route('**/*', async route => {
    const reqUrl = route.request().url();
    const result = await validateUrl(reqUrl, config);
    if (!result.ok) return route.abort('blockedbyclient');
    return route.continue();
  });
  const id = uuidv4();
  const s = { id, context, page, createdAt: Date.now(), clients: new Set() };
  sessions.set(id, s);
  return s;
}

async function frameFor(session) {
  const png = await session.page.screenshot({ type: 'png' });
  return png.toString('base64');
}

async function broadcastFrame(session, message = 'ok') {
  const data = await frameFor(session);
  const payload = JSON.stringify({ type: 'frame', data, url: session.page.url(), title: await session.page.title() });
  const status = JSON.stringify({ type: 'status', message });
  for (const ws of session.clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      ws.send(status);
    }
  }
}

app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'opiabrowser' }));

app.post('/session', async (_req, res) => {
  try {
    const s = await newSession();
    res.status(201).json({ sessionId: s.id, ttlMs: config.sessionTtlMs });
  } catch (e) {
    res.status(500).json({ error: e.message || 'session_create_failed' });
  }
});

app.post('/session/:id/navigate', async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });
  const check = await validateUrl(req.body?.url, config);
  if (!check.ok) return res.status(400).json({ error: 'url_blocked', reason: check.reason });
  try {
    const response = await s.page.goto(req.body.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    await broadcastFrame(s, 'navigated');
    res.json({ ok: true, status: response?.status() ?? null, finalUrl: s.page.url() });
  } catch (e) {
    res.status(500).json({ error: 'navigate_failed', detail: e.message });
  }
});

app.delete('/session/:id', async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });
  await s.context.close().catch(() => {});
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

async function cleanupExpired() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > config.sessionTtlMs || s.clients.size === 0) {
      await s.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}
setInterval(cleanupExpired, 30_000).unref();

async function handleControl(ws, msg, session) {
  if (msg.type === 'navigate') {
    const check = await validateUrl(msg.url, config);
    if (!check.ok) throw new Error(`url_blocked:${check.reason}`);
    await session.page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  } else if (msg.type === 'back') {
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
  } else if (msg.type === 'forward') {
    await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
  } else if (msg.type === 'refresh') {
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  } else if (msg.type === 'click') {
    const p = scalePoint(msg.x, msg.y, msg.vw, msg.vh);
    await session.page.mouse.click(p.x, p.y);
  } else if (msg.type === 'scroll') {
    await session.page.mouse.wheel(Number(msg.dx || 0), Number(msg.dy || 0));
  } else if (msg.type === 'type') {
    await session.page.keyboard.type(String(msg.text || ''));
  } else if (msg.type === 'key') {
    const k = String(msg.key || '');
    const map = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
    if (map[k]) await session.page.keyboard.press(map[k]);
  }
}

async function start() {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-networking', '--disable-breakpad', '--disable-sync', '--metrics-recording-only', '--no-first-run', '--disable-default-apps']
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/control' });

  wss.on('connection', async (ws, req) => {
    try {
      if (config.apiKey) {
        const u = new URL(req.url, `http://${req.headers.host}`);
        if (u.searchParams.get('token') !== config.apiKey) {
          ws.close(1008, 'unauthorized');
          return;
        }
      }

      const session = await newSession();
      session.clients.add(ws);
      ws.send(JSON.stringify({ type: 'session', sessionId: session.id }));
      await session.page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      await broadcastFrame(session, 'ready');

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          await handleControl(ws, msg, session);
          await broadcastFrame(session, 'updated');
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      });

      ws.on('close', async () => {
        session.clients.delete(ws);
        if (session.clients.size === 0) {
          await session.context.close().catch(() => {});
          sessions.delete(session.id);
        }
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
      ws.close();
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`opiabrowser listening on http://${config.host}:${config.port}`);
  });
}

start().catch((err) => {
  console.error('fatal_start_error', err);
  process.exit(1);
});
