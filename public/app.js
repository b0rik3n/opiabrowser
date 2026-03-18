const viewport = document.getElementById('viewport');
const statusEl = document.getElementById('status');
const titleEl = document.getElementById('title');
const urlInput = document.getElementById('urlInput');
const tabsEl = document.getElementById('tabs');
const securityEl = document.getElementById('security');

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const token = localStorage.getItem('opiabrowser_api_key') || '';
const wsUrl = `${wsProto}://${location.host}/ws/control${token ? `?token=${encodeURIComponent(token)}` : ''}`;
const ws = new WebSocket(wsUrl);

const tabs = new Map();
let activeTabId = null;

const humanModeEl = document.getElementById('humanMode');
const speedEl = document.getElementById('speed');
const speedLabelEl = document.getElementById('speedLabel');
const speedMap = { 1: 'very slow', 2: 'slow', 3: 'normal', 4: 'fast', 5: 'very fast' };
humanModeEl.checked = (localStorage.getItem('opiabrowser_human_mode') || '1') === '1';
speedEl.value = localStorage.getItem('opiabrowser_speed') || '3';
speedLabelEl.textContent = speedMap[Number(speedEl.value)] || 'normal';

function sendMode() {
  const speed = Number(speedEl.value);
  speedLabelEl.textContent = speedMap[speed] || 'normal';
  localStorage.setItem('opiabrowser_human_mode', humanModeEl.checked ? '1' : '0');
  localStorage.setItem('opiabrowser_speed', String(speed));
  send('setMode', { human: humanModeEl.checked, speed });
}

function send(type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const [tabId, tab] of tabs.entries()) {
    const el = document.createElement('div');
    el.className = `tab ${tabId === activeTabId ? 'active' : ''}`;
    el.innerHTML = `<span class="tabTitle">${tab.title || 'New Tab'}</span><button class="tabClose" title="Close tab">✕</button>`;
    el.onclick = () => send('switchTab', { tabId });
    el.querySelector('.tabClose').onclick = (e) => {
      e.stopPropagation();
      send('closeTab', { tabId });
    };
    tabsEl.appendChild(el);
  }
}

function setSecurity(url) {
  securityEl.className = 'security unknown';
  securityEl.textContent = '○';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      securityEl.className = 'security secure';
      securityEl.textContent = '🔒';
    } else if (u.protocol === 'http:') {
      securityEl.className = 'security insecure';
      securityEl.textContent = '!';
    }
  } catch {}
}

ws.addEventListener('open', () => {
  statusEl.textContent = 'connected';
  sendMode();
});

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);

  if (msg.type === 'tabs') {
    tabs.clear();
    for (const t of msg.tabs) tabs.set(t.tabId, t);
    activeTabId = msg.activeTabId;
    renderTabs();
    const active = tabs.get(activeTabId);
    if (active) {
      titleEl.textContent = active.title || 'New Tab';
      urlInput.value = active.url || urlInput.value;
      setSecurity(active.url || '');
    }
  }

  if (msg.type === 'frame') {
    viewport.src = `data:image/png;base64,${msg.data}`;
    if (msg.url) urlInput.value = msg.url;
    if (msg.title) titleEl.textContent = msg.title;
    setSecurity(msg.url || '');
  }
  if (msg.type === 'status') statusEl.textContent = msg.message;
  if (msg.type === 'error') statusEl.textContent = `error: ${msg.message}`;
});

ws.addEventListener('close', () => {
  statusEl.textContent = 'disconnected';
});

document.getElementById('goBtn').addEventListener('click', () => send('navigate', { url: urlInput.value.trim() }));
document.getElementById('backBtn').addEventListener('click', () => send('back'));
document.getElementById('forwardBtn').addEventListener('click', () => send('forward'));
document.getElementById('refreshBtn').addEventListener('click', () => send('refresh'));
document.getElementById('newTabBtn').addEventListener('click', () => send('newTab', { url: 'https://example.com' }));
humanModeEl.addEventListener('change', sendMode);
speedEl.addEventListener('input', sendMode);

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send('navigate', { url: urlInput.value.trim() });
});

viewport.addEventListener('click', (e) => {
  e.preventDefault();
  const rect = viewport.getBoundingClientRect();
  send('click', { x: e.clientX - rect.left, y: e.clientY - rect.top, vw: rect.width, vh: rect.height });
});

window.addEventListener('keydown', (e) => {
  const ctrlLike = e.ctrlKey || e.metaKey;
  if (ctrlLike && e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const next = prompt('Set opiabrowser API key (blank to clear):', localStorage.getItem('opiabrowser_api_key') || '');
    if (next === null) return;
    if (next.trim()) localStorage.setItem('opiabrowser_api_key', next.trim());
    else localStorage.removeItem('opiabrowser_api_key');
    statusEl.textContent = 'API key updated. Reload page.';
    return;
  }
  if (ctrlLike && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    urlInput.focus();
    urlInput.select();
    return;
  }
  if (ctrlLike && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    send('refresh');
    return;
  }
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key.length === 1) send('type', { text: e.key });
  else send('key', { key: e.key });
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  send('scroll', { dx: e.deltaX, dy: e.deltaY });
}, { passive: false });
