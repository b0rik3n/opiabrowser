export const config = {
  host: process.env.OPIA_HOST || '127.0.0.1',
  port: Number(process.env.OPIA_PORT || 8787),
  apiKey: process.env.OPIA_API_KEY || '',
  sessionTtlMs: Number(process.env.OPIA_SESSION_TTL_MS || 5 * 60 * 1000),
  maxSessions: Number(process.env.OPIA_MAX_SESSIONS || 5),
  navigationTimeoutMs: Number(process.env.OPIA_NAV_TIMEOUT_MS || 20_000),
  blockPrivateNetworks: process.env.OPIA_BLOCK_PRIVATE !== 'false',
  allowHttp: process.env.OPIA_ALLOW_HTTP !== 'false',

  // Interaction realism mode (helps avoid bursty bot-like behavior, not a bypass tool)
  interactionMode: process.env.OPIA_INTERACTION_MODE || 'fast', // fast | human
  actionDelayMinMs: Number(process.env.OPIA_ACTION_DELAY_MIN_MS || 90),
  actionDelayMaxMs: Number(process.env.OPIA_ACTION_DELAY_MAX_MS || 280),
  frameIntervalMs: Number(process.env.OPIA_FRAME_INTERVAL_MS || 220),

  // Runtime knobs
  headless: process.env.OPIA_HEADLESS !== 'false',
  viewportWidth: Number(process.env.OPIA_VIEWPORT_WIDTH || 1366),
  viewportHeight: Number(process.env.OPIA_VIEWPORT_HEIGHT || 768),

  allowedHosts: (process.env.OPIA_ALLOWED_HOSTS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  blockedHosts: (process.env.OPIA_BLOCKED_HOSTS || 'localhost,169.254.169.254,metadata.google.internal')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
};
