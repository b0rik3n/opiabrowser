# opiabrowser

Isolated browser for high-risk links.

`opiabrowser` is an open-source security tool that lets you open suspicious URLs in an isolated browser runtime so your host OS is less exposed.

## Project scope (important)
**Primary goal:** safe link detonation / high-risk browsing isolation.

**Not a goal:** bypassing anti-bot systems, access controls, or security protections on target websites.

## Why use it
- Reduce host OS exposure when opening unknown links
- Keep browsing sessions isolated and ephemeral
- Apply deny-by-default network policy to internal targets
- Keep deployment local and auditable

## Security model at a glance
- Ephemeral browser session per connected UI client (destroyed on disconnect)
- Private network / localhost / metadata targets blocked by default
- Non-HTTP(S) schemes blocked by default
- Optional API auth (`OPIA_API_KEY`)
- Supports hardened Linux container deployment (non-root + read-only fs guidance)

See:
- `docs/THREAT_MODEL.md`
- `docs/SECURITY.md`

## Current UX
Simple RBI-style UI at `/`:
- Back / Forward / Refresh
- Address bar + Go
- Live isolated viewport stream

## Quick start
```bash
npm install
npx playwright install --with-deps chromium
npm start
```
Open: `http://127.0.0.1:8787/`

## Recommended secure run
```bash
OPIA_HOST=127.0.0.1 \
OPIA_API_KEY='change-me' \
OPIA_BLOCK_PRIVATE=true \
OPIA_ALLOW_HTTP=false \
npm start
```

## Docker (Linux hardening path)
```bash
cd deploy/docker
docker compose up --build
```

## Key environment variables
- `OPIA_HOST` (default `127.0.0.1`)
- `OPIA_PORT` (default `8787`)
- `OPIA_API_KEY` (default empty)
- `OPIA_HOME_URL` (default `https://example.com`)
- `OPIA_NAV_TIMEOUT_MS` (default `20000`)
- `OPIA_BLOCK_PRIVATE` (default `true`)
- `OPIA_ALLOW_HTTP` (default `false`)
- `OPIA_ALLOWED_HOSTS` (optional allowlist)
- `OPIA_BLOCKED_HOSTS` (optional denylist)
- `OPIA_HEADLESS` (default `true`)

## Roadmap (security-first)
- Session recording for incident review
- URL detonation workflow mode
- Rate limiting and quotas
- SBOM + signed release artifacts
- Egress policy plugins (proxy/firewall integration)
