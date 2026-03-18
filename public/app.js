const viewport = document.getElementById('viewport');
const statusEl = document.getElementById('status');
const titleEl = document.getElementById('title');
const urlInput = document.getElementById('urlInput');

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const token = localStorage.getItem('opiabrowser_api_key') || '';
const wsUrl = `${wsProto}://${location.host}/ws/control${token ? `?token=${encodeURIComponent(token)}` : ''}`;
const ws = new WebSocket(wsUrl);

function send(type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

ws.addEventListener('open', () => {
  statusEl.textContent = 'connected';
});

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'frame') {
    viewport.src = `data:image/png;base64,${msg.data}`;
    if (msg.url) urlInput.value = msg.url;
    if (msg.title) titleEl.textContent = msg.title;
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
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send('navigate', { url: urlInput.value.trim() });
});

viewport.addEventListener('click', (e) => {
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
