import express from 'express';
import helmet from 'helmet';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { validateUrl } from './security/urlPolicy.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(helmet());

const sessions = new Map();
let browser;

function auth(req, res, next) {
  if (!config.apiKey) return next();
  const hdr = req.header('authorization') || '';
  if (hdr !== `Bearer ${config.apiKey}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.use(auth);

function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > config.sessionTtlMs) return null;
  return s;
}

function touch(id) {
  const s = sessions.get(id);
  if (s) s.lastUsedAt = Date.now();
}

async function cleanupExpired() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > config.sessionTtlMs) {
      await s.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

setInterval(cleanupExpired, 30_000).unref();

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'opiabrowser' }));

app.post('/session', async (_req, res) => {
  try {
    if (sessions.size >= config.maxSessions) {
      return res.status(429).json({ error: 'session_limit_reached' });
    }

    const context = await browser.newContext({
      acceptDownloads: false,
      javaScriptEnabled: true,
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
    sessions.set(id, { id, context, page, createdAt: Date.now(), lastUsedAt: Date.now() });
    return res.status(201).json({ sessionId: id, ttlMs: config.sessionTtlMs });
  } catch (error) {
    return res.status(500).json({ error: 'session_create_failed', detail: error?.message });
  }
});

app.post('/session/:id/navigate', async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });

  const { url } = req.body || {};
  const check = await validateUrl(url, config);
  if (!check.ok) return res.status(400).json({ error: 'url_blocked', reason: check.reason });

  try {
    const response = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    touch(s.id);
    return res.json({ ok: true, status: response?.status() ?? null, finalUrl: s.page.url() });
  } catch (error) {
    return res.status(500).json({ error: 'navigate_failed', detail: error?.message });
  }
});

app.post('/session/:id/screenshot', async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });

  try {
    const fullPage = Boolean(req.body?.fullPage);
    const png = await s.page.screenshot({ fullPage, type: 'png' });
    touch(s.id);
    res.setHeader('content-type', 'image/png');
    return res.send(png);
  } catch (error) {
    return res.status(500).json({ error: 'screenshot_failed', detail: error?.message });
  }
});

app.post('/session/:id/click', async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });
  if (!req.body?.selector) return res.status(400).json({ error: 'selector_required' });

  try {
    await s.page.click(req.body.selector, { timeout: config.navigationTimeoutMs });
    touch(s.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'click_failed', detail: error?.message });
  }
});

app.post('/session/:id/type', async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });
  if (!req.body?.selector || typeof req.body?.text !== 'string') {
    return res.status(400).json({ error: 'selector_and_text_required' });
  }

  try {
    await s.page.fill(req.body.selector, req.body.text, { timeout: config.navigationTimeoutMs });
    touch(s.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'type_failed', detail: error?.message });
  }
});

app.delete('/session/:id', async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session_not_found' });

  await s.context.close().catch(() => {});
  sessions.delete(req.params.id);
  return res.json({ ok: true });
});

async function start() {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--disable-default-apps'
    ]
  });

  app.listen(config.port, config.host, () => {
    console.log(`opiabrowser listening on http://${config.host}:${config.port}`);
  });
}

start().catch(err => {
  console.error('fatal_start_error', err);
  process.exit(1);
});
