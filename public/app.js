const viewport = document.getElementById('viewport');
const statusEl = document.getElementById('status');
const urlInput = document.getElementById('urlInput');

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const token = localStorage.getItem('opiabrowser_api_key') || '';
const wsUrl = `${wsProto}://${location.host}/ws/browser${token ? `?token=${encodeURIComponent(token)}` : ''}`;
const ws = new WebSocket(wsUrl);
const manualOnlyEl = document.getElementById('manualOnly');
manualOnlyEl.checked = (localStorage.getItem('opiabrowser_manual_only') ?? '1') === '1';

function send(type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function sendInputMode() {
  localStorage.setItem('opiabrowser_manual_only', manualOnlyEl.checked ? '1' : '0');
  send('setInputMode', { manualOnly: manualOnlyEl.checked });
}

ws.addEventListener('open', () => { statusEl.textContent = 'connected'; sendInputMode(); });
ws.addEventListener('close', () => { statusEl.textContent = 'disconnected'; });

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'frame') {
    viewport.src = `data:image/png;base64,${msg.data}`;
    if (msg.url) urlInput.value = msg.url;
  } else if (msg.type === 'status') {
    statusEl.textContent = msg.message;
  } else if (msg.type === 'error') {
    statusEl.textContent = `error: ${msg.message}`;
  }
});

document.getElementById('goBtn').addEventListener('click', () => send('navigate', { url: urlInput.value.trim() }));
document.getElementById('backBtn').addEventListener('click', () => send('back'));
document.getElementById('forwardBtn').addEventListener('click', () => send('forward'));
document.getElementById('refreshBtn').addEventListener('click', () => send('refresh'));
manualOnlyEl.addEventListener('change', sendInputMode);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send('navigate', { url: urlInput.value.trim() }); });

viewport.addEventListener('click', (e) => {
  const rect = viewport.getBoundingClientRect();
  send('click', { x: e.clientX - rect.left, y: e.clientY - rect.top, vw: rect.width, vh: rect.height });
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  send('scroll', { dx: e.deltaX, dy: e.deltaY });
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const ctrlLike = e.ctrlKey || e.metaKey;
  if (ctrlLike && e.key.toLowerCase() === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); return; }
  if (ctrlLike && e.key.toLowerCase() === 'r') { e.preventDefault(); send('refresh'); return; }
  if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key.length === 1) send('type', { text: e.key });
  else send('key', { key: e.key });
});
