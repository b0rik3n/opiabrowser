# opiabrowser

Secure-by-default sandboxed browser service for automation and screenshots.

## What it is
`opiabrowser` runs Playwright in isolated sessions behind a small HTTP API.
It is designed for **defense in depth** and practical hardening, not blind trust.

## Security stance
No system can honestly claim "vulnerability free" forever. This project aims for:
- least privilege by default
- strong isolation boundaries
- deny-by-default network policy
- fast patchability

See `docs/THREAT_MODEL.md` and `docs/SECURITY.md`.

## Features (v0.1)
- Session lifecycle API (`/session`, `/session/:id/...`)
- Navigate, click, type, screenshot
- URL policy checks with DNS/IP resolution
- Blocks localhost/private/link-local networks by default
- Blocks non-HTTP(S) schemes by default
- Session TTL and max session limits
- Optional Bearer token auth (`OPIA_API_KEY`)
- Linux hardened Docker deployment + native run scripts for macOS/Windows/Linux

## API
- `GET /healthz`
- `POST /session`
- `POST /session/:id/navigate` body: `{ "url": "https://example.com" }`
- `POST /session/:id/click` body: `{ "selector": "button#submit" }`
- `POST /session/:id/type` body: `{ "selector": "input[name=q]", "text": "hello" }`
- `POST /session/:id/screenshot` body: `{ "fullPage": true }`
- `DELETE /session/:id`

If `OPIA_API_KEY` is set, send `Authorization: Bearer <key>`.

## Local run (native)
```bash
npm install
npx playwright install --with-deps chromium
npm start
```

macOS/Linux helper scripts:
```bash
./scripts/run-macos.sh
./scripts/run-linux.sh
```

Windows PowerShell:
```powershell
./scripts/run-windows.ps1
```

## Docker (Linux hardening path)
```bash
cd deploy/docker
docker compose up --build
```

Recommended production hardening:
- add seccomp profile tailored for Chromium sandboxing
- run with constrained CPU/memory
- keep image patched frequently
- front with authenticated API gateway

## Important environment variables
- `OPIA_HOST` (default `127.0.0.1`)
- `OPIA_PORT` (default `8787`)
- `OPIA_API_KEY` (default empty)
- `OPIA_SESSION_TTL_MS` (default `300000`)
- `OPIA_MAX_SESSIONS` (default `5`)
- `OPIA_NAV_TIMEOUT_MS` (default `20000`)
- `OPIA_BLOCK_PRIVATE` (default `true`)
- `OPIA_ALLOW_HTTP` (default `false`)
- `OPIA_ALLOWED_HOSTS` (comma-separated allowlist)
- `OPIA_BLOCKED_HOSTS` (comma-separated denylist)

## Roadmap
- Add rate limiting and request quotas
- Add audit log sink (JSONL + signed hash chain)
- Add stricter egress firewall integration
- Add policy test suite with SSRF bypass fixtures
- Add SBOM and signed release artifacts
