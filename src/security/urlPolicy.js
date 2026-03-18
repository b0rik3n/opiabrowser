import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_SCHEMES = new Set(['file:', 'ftp:', 'gopher:', 'ws:', 'wss:', 'data:', 'javascript:']);

function isPrivateIpv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return false;
  if (p[0] === 10) return true;
  if (p[0] === 127) return true;
  if (p[0] === 0) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized === '::'
  );
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return false;
}

async function resolveHost(hostname) {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map(r => r.address);
  } catch {
    return [];
  }
}

export async function validateUrl(raw, cfg) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  if (!['http:', 'https:'].includes(scheme)) return { ok: false, reason: 'unsupported_scheme' };
  if (!cfg.allowHttp && scheme === 'http:') return { ok: false, reason: 'http_not_allowed' };
  if (BLOCKED_SCHEMES.has(scheme)) return { ok: false, reason: 'blocked_scheme' };
  if (cfg.blockedHosts.includes(host)) return { ok: false, reason: 'blocked_host' };

  if (cfg.allowedHosts.length > 0 && !cfg.allowedHosts.includes(host)) {
    return { ok: false, reason: 'host_not_allowlisted' };
  }

  const isLiteralIp = net.isIP(host) !== 0;
  const ips = isLiteralIp ? [host] : await resolveHost(host);

  if (!ips.length) return { ok: false, reason: 'dns_resolution_failed' };

  if (cfg.blockPrivateNetworks && ips.some(isPrivateIp)) {
    return { ok: false, reason: 'private_network_blocked' };
  }

  return { ok: true, parsed, host, ips };
}
