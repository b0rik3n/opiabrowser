import express from 'express';
import helmet from 'helmet';
import { chromium } from 'playwright';
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

const VIEW_W = config.viewportWidth || 1366;
const VIEW_H = config.viewportHeight || 768;
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
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'opiabrowser', mode: 'rbi-simple' }));

function scalePoint(x, y, vw, vh) {
  const sx = VIEW_W / Math.max(vw || VIEW_W, 1);
  const sy = VIEW_H / Math.max(vh || VIEW_H, 1);
  return { x: Math.max(0, Math.round(x * sx)), y: Math.max(0, Math.round(y * sy)) };
}

async function createIsolatedSession() {
  // Ephemeral sandboxed context. Destroy on disconnect.
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

  // Network policy guardrails
  await page.route('**/*', async route => {
    const reqUrl = route.request().url();
    const result = await validateUrl(reqUrl, config);
    if (!result.ok) return route.abort('blockedbyclient');
    return route.continue();
  });

  return { context, page };
}

async function start() {
  browser = await chromium.launch({
    headless: config.headless !== false,
    args: [
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--disable-default-apps'
    ]
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/browser' });

  wss.on('connection', async (ws, req) => {
    const state = { ws, context: null, page: null, frameLoop: null, dirty: false };

    try {
      if (config.apiKey) {
        const u = new URL(req.url, `http://${req.headers.host}`);
        if (u.searchParams.get('token') !== config.apiKey) {
          ws.close(1008, 'unauthorized');
          return;
        }
      }

      const session = await createIsolatedSession();
      state.context = session.context;
      state.page = session.page;

      const flushFrame = async (force = false) => {
        if (!state.page) return;
        if (!force && !state.dirty) return;
        state.dirty = false;
        const png = await state.page.screenshot({ type: 'png' });
        ws.send(JSON.stringify({ type: 'frame', data: png.toString('base64'), url: state.page.url() }));
      };

      const markDirty = () => {
        state.dirty = true;
        if (!state.frameLoop) state.frameLoop = setInterval(() => flushFrame().catch(() => {}), config.frameIntervalMs || 220);
      };

      const withPage = async (fn) => {
        if (!state.page) throw new Error('no_page');
        await fn(state.page);
        markDirty();
      };

      await state.page.goto(config.homeUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      await flushFrame(true);
      ws.send(JSON.stringify({ type: 'status', message: 'isolated session ready' }));

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.type === 'navigate') {
            const check = await validateUrl(msg.url, config);
            if (!check.ok) throw new Error(`url_blocked:${check.reason}`);
          }

          await withPage(async (page) => {
            if (msg.type === 'navigate') {
              return page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
            }
            if (msg.type === 'back') return page.goBack({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
            if (msg.type === 'forward') return page.goForward({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
            if (msg.type === 'refresh') return page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
            if (msg.type === 'scroll') return page.mouse.wheel(Number(msg.dx || 0), Number(msg.dy || 0));
            if (msg.type === 'type') return page.keyboard.type(String(msg.text || ''));
            if (msg.type === 'key') {
              const k = String(msg.key || '');
              const map = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
              if (map[k]) return page.keyboard.press(map[k]);
              return;
            }
            if (msg.type === 'click') {
              const p = scalePoint(msg.x, msg.y, msg.vw, msg.vh);
              await page.mouse.move(p.x, p.y, { steps: 6 });
              await page.mouse.down();
              await page.mouse.up();
            }
          });

          ws.send(JSON.stringify({ type: 'status', message: 'ok' }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      });

      ws.on('close', async () => {
        if (state.frameLoop) clearInterval(state.frameLoop);
        if (state.context) await state.context.close().catch(() => {});
      });

    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
      ws.close();
      if (state.frameLoop) clearInterval(state.frameLoop);
      if (state.context) await state.context.close().catch(() => {});
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`opiabrowser (rbi-simple) listening on http://${config.host}:${config.port}`);
  });
}

start().catch((err) => {
  console.error('fatal_start_error', err);
  process.exit(1);
});
