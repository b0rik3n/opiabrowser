# Security Policy

## Supported Versions
- `0.x` is supported while the project stabilizes.

## Responsible Disclosure
Please report vulnerabilities privately via GitHub Security Advisories.
Do **not** post exploitable details in public issues.

## Security Intent
opiabrowser is a defensive isolation tool for high-risk links.

It is **not** intended for bypassing anti-bot systems, paywalls, authentication barriers, or other access controls.

## Baseline Controls
- Isolated browser session per connected client (ephemeral)
- Default deny to private/internal/link-local/metadata targets
- Non-HTTP(S) schemes blocked by default
- Optional API token auth for non-local exposure
- Least-privilege deployment guidance (non-root runtime)

## Operator Hardening Checklist
- Bind to localhost unless intentionally exposed
- Always set `OPIA_API_KEY` when exposed beyond localhost
- Place behind TLS reverse proxy for remote use
- Keep Playwright/browser binaries patched
- Apply resource limits (CPU/memory)
- Use network egress controls where possible

## Residual Risk
No browser isolation tool can guarantee zero vulnerabilities.
Residual risk includes browser 0days, dependency CVEs, and policy bypass edge cases.

## Recommended Response SLA
- Critical: acknowledge within 24h, patch or mitigation target within 72h
- High: acknowledge within 48h, patch target within 7 days
- Medium/Low: next scheduled security release
