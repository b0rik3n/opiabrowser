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
const VIEW_W = config.viewportWidth;
const VIEW_H = config.viewportHeight;
let browser;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (min, max) => Math.floor(min + Math.random() * Math.max(1, max - min + 1));

function speedProfile(speed = 3) {
  // 1 slower .. 5 faster
  const table = {
    1: { min: 220, max: 480, frame: 340, settle: 180, mouseSteps: 12, keyDelay: [70, 130] },
    2: { min: 150, max: 360, frame: 290, settle: 140, mouseSteps: 10, keyDelay: [55, 110] },
    3: { min: 110, max: 280, frame: 240, settle: 110, mouseSteps: 8, keyDelay: [35, 95] },
    4: { min: 70, max: 170, frame: 200, settle: 70, mouseSteps: 5, keyDelay: [20, 55] },
    5: { min: 0, max: 0, frame: 140, settle: 30, mouseSteps: 2, keyDelay: [0, 10] }
  };
  return table[speed] || table[3];
}

async function maybeHumanDelay(client) {
  if (!client.mode.human) return;
  const p = speedProfile(client.mode.speed);
  await sleep(jitter(p.min, p.max));
}

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
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light'
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

function markDirty(client) {
  client.dirty = true;
  if (!client.frameLoop) {
    const frameMs = client.mode.human ? speedProfile(client.mode.speed).frame : config.frameIntervalMs;
    client.frameLoop = setInterval(() => flushFrame(client).catch(() => {}), frameMs);
  }
}

async function flushFrame(client, force = false) {
  if (!client.activeTabId) return;
  const tab = client.tabs.get(client.activeTabId);
  if (!tab) return;
  if (!force && !client.dirty) return;
  client.dirty = false;

  const png = await tab.session.page.screenshot({ type: 'png' });
  client.ws.send(JSON.stringify({
    type: 'frame',
    data: png.toString('base64'),
    url: tab.session.page.url(),
    title: await tab.session.page.title()
  }));
}

function stopFrameLoop(client) {
  if (client.frameLoop) clearInterval(client.frameLoop);
  client.frameLoop = null;
}

function applyClientMode(client, { human, speed }) {
  client.mode.human = Boolean(human);
  client.mode.speed = Math.max(1, Math.min(5, Number(speed || 3)));
  stopFrameLoop(client);
  markDirty(client);
}

async function sendTabs(client) {
  const tabs = [];
  for (const [tabId, tab] of client.tabs.entries()) {
    tabs.push({
      tabId,
      title: (await tab.session.page.title()) || 'New Tab',
      url: tab.session.page.url()
    });
  }
  client.ws.send(JSON.stringify({ type: 'tabs', tabs, activeTabId: client.activeTabId }));
}

async function createTab(client, url = 'https://example.com') {
  const session = await newSession();
  const tabId = uuidv4();
  client.tabs.set(tabId, { tabId, session });
  client.activeTabId = tabId;
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  await sendTabs(client);
  markDirty(client);
}

async function closeTab(client, tabId) {
  const tab = client.tabs.get(tabId);
  if (!tab) return;
  await tab.session.context.close().catch(() => {});
  sessions.delete(tab.session.id);
  client.tabs.delete(tabId);

  if (client.activeTabId === tabId) {
    client.activeTabId = client.tabs.keys().next().value || null;
  }
  if (!client.activeTabId && client.tabs.size === 0) {
    await createTab(client, 'https://example.com');
  } else {
    await sendTabs(client);
    markDirty(client);
  }
}

async function withActiveTab(client, fn) {
  const tab = client.tabs.get(client.activeTabId);
  if (!tab) throw new Error('no_active_tab');
  await maybeHumanDelay(client);
  await fn(tab.session.page, tab.session);
  await sendTabs(client);
  // Let scripted UIs settle before frame capture.
  const settle = client.mode.human ? speedProfile(client.mode.speed).settle : 35;
  await sleep(settle);
  markDirty(client);
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
    if (now - s.createdAt > config.sessionTtlMs) {
      await s.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}
setInterval(cleanupExpired, 30_000).unref();

async function handleControl(client, msg) {
  if (msg.type === 'newTab') return createTab(client, msg.url || 'https://example.com');
  if (msg.type === 'switchTab') {
    if (client.tabs.has(msg.tabId)) {
      client.activeTabId = msg.tabId;
      await sendTabs(client);
      return markDirty(client);
    }
    return;
  }
  if (msg.type === 'closeTab') return closeTab(client, msg.tabId);
  if (msg.type === 'setMode') {
    applyClientMode(client, msg);
    client.ws.send(JSON.stringify({ type: 'status', message: `mode=${client.mode.human ? 'human' : 'fast'} speed=${client.mode.speed}` }));
    return;
  }

  if (msg.type === 'navigate') {
    const check = await validateUrl(msg.url, config);
    if (!check.ok) throw new Error(`url_blocked:${check.reason}`);
  }

  await withActiveTab(client, async (page) => {
    if (msg.type === 'navigate') {
      await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    } else if (msg.type === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
    } else if (msg.type === 'forward') {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
    } else if (msg.type === 'refresh') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    } else if (msg.type === 'click') {
      const p = scalePoint(msg.x, msg.y, msg.vw, msg.vh);
      // Primary path
      const profile = speedProfile(client.mode.speed);
      await page.mouse.move(p.x, p.y, { steps: client.mode.human ? profile.mouseSteps : 1 });
      await maybeHumanDelay(client);
      await page.mouse.down();
      await maybeHumanDelay(client);
      await page.mouse.up();

      // Compatibility path for apps listening to pointer events.
      const clickOutcome = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return { ok: false, reason: 'no_element' };

        const common = {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1
        };

        if (typeof el.focus === 'function') {
          try { el.focus({ preventScroll: true }); } catch { el.focus(); }
        }

        try { el.dispatchEvent(new PointerEvent('pointerdown', common)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mousedown', common)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 })); } catch {}
        try { el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 })); } catch {}
        try { el.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 })); } catch {}

        // Robust fallback for link/button UIs.
        const clickable = el.closest?.('a,button,[role="button"],[onclick]') || el;
        if (clickable && typeof clickable.click === 'function') {
          try { clickable.click(); } catch {}
        }

        const anchor = clickable?.closest?.('a[href]');
        if (anchor) {
          const href = anchor.getAttribute('href') || '';
          const target = (anchor.getAttribute('target') || '').toLowerCase();
          if (href && target === '_blank') {
            return { ok: true, popupHref: anchor.href };
          }
        }

        return { ok: true };
      }, { x: p.x, y: p.y }).catch(() => ({ ok: false }));

      // If site tries to open a new tab, force same-tab nav for streamed UX reliability.
      if (clickOutcome?.popupHref) {
        const check = await validateUrl(clickOutcome.popupHref, config);
        if (check.ok) {
          await page.goto(clickOutcome.popupHref, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => {});
        }
      }
    } else if (msg.type === 'scroll') {
      await page.mouse.wheel(Number(msg.dx || 0), Number(msg.dy || 0));
    } else if (msg.type === 'type') {
      await page.evaluate(() => {
        const ae = document.activeElement;
        if (ae && typeof ae.focus === 'function') ae.focus();
      }).catch(() => {});
      const [kdMin, kdMax] = speedProfile(client.mode.speed).keyDelay;
      await page.keyboard.type(String(msg.text || ''), {
        delay: client.mode.human ? jitter(kdMin, kdMax) : 0
      });
    } else if (msg.type === 'key') {
      const k = String(msg.key || '');
      const map = {
        Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
        ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight'
      };
      if (map[k]) await page.keyboard.press(map[k]);
    }
  });
}

async function start() {
  browser = await chromium.launch({
    headless: config.headless,
    args: ['--disable-background-networking', '--disable-breakpad', '--disable-sync', '--metrics-recording-only', '--no-first-run', '--disable-default-apps']
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/control' });

  wss.on('connection', async (ws, req) => {
    const client = {
      ws,
      tabs: new Map(),
      activeTabId: null,
      dirty: false,
      frameLoop: null,
      mode: { human: config.interactionMode === 'human', speed: 3 }
    };
    try {
      if (config.apiKey) {
        const u = new URL(req.url, `http://${req.headers.host}`);
        if (u.searchParams.get('token') !== config.apiKey) {
          ws.close(1008, 'unauthorized');
          return;
        }
      }

      await createTab(client, 'https://example.com');
      ws.send(JSON.stringify({ type: 'status', message: 'ready' }));

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          await handleControl(client, msg);
          ws.send(JSON.stringify({ type: 'status', message: 'updated' }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      });

      ws.on('close', async () => {
        stopFrameLoop(client);
        for (const tab of client.tabs.values()) {
          await tab.session.context.close().catch(() => {});
          sessions.delete(tab.session.id);
        }
        client.tabs.clear();
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
      ws.close();
      stopFrameLoop(client);
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
