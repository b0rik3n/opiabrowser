let sessionId = null;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const shotEl = $('shot');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function authHeaders() {
  const key = $('apiKey').value.trim();
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });

  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const err = ct.includes('application/json') ? await res.json() : await res.text();
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  if (ct.includes('application/json')) return res.json();
  return res;
}

async function createSession() {
  const out = await api('/session', 'POST');
  sessionId = out.sessionId;
  $('sessionId').textContent = sessionId;
  setStatus(`Session created: ${sessionId}`);
}

async function closeSession() {
  if (!sessionId) return;
  await api(`/session/${sessionId}`, 'DELETE');
  sessionId = null;
  $('sessionId').textContent = 'none';
  shotEl.removeAttribute('src');
  setStatus('Session closed');
}

async function navigate() {
  if (!sessionId) throw new Error('Create a session first');
  const url = $('url').value.trim();
  const out = await api(`/session/${sessionId}/navigate`, 'POST', { url });
  setStatus(`Navigated: status=${out.status} final=${out.finalUrl}`);
}

async function refreshShot() {
  if (!sessionId) throw new Error('Create a session first');
  const key = $('apiKey').value.trim();
  const headers = key ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  const res = await fetch(`/session/${sessionId}/screenshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fullPage: true })
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  shotEl.src = URL.createObjectURL(blob);
  setStatus('Screenshot updated');
}

async function clickSelector() {
  if (!sessionId) throw new Error('Create a session first');
  const selector = $('selector').value.trim();
  await api(`/session/${sessionId}/click`, 'POST', { selector });
  setStatus(`Clicked: ${selector}`);
}

async function typeSelector() {
  if (!sessionId) throw new Error('Create a session first');
  const selector = $('selector').value.trim();
  const text = $('text').value;
  await api(`/session/${sessionId}/type`, 'POST', { selector, text });
  setStatus(`Typed into: ${selector}`);
}

async function run(fn) {
  try {
    await fn();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
}

$('createBtn').addEventListener('click', () => run(createSession));
$('closeBtn').addEventListener('click', () => run(closeSession));
$('goBtn').addEventListener('click', () => run(async () => { await navigate(); await refreshShot(); }));
$('shotBtn').addEventListener('click', () => run(refreshShot));
$('clickBtn').addEventListener('click', () => run(async () => { await clickSelector(); await refreshShot(); }));
$('typeBtn').addEventListener('click', () => run(async () => { await typeSelector(); await refreshShot(); }));
