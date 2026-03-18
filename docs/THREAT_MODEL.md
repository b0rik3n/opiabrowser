# opiabrowser Threat Model (v0.1)

## Assets
- Host machine/network where opiabrowser runs
- Internal services (localhost, RFC1918, cloud metadata)
- Session data (page state, cookies, screenshots)
- API credentials

## Trust Boundaries
1. Client -> opiabrowser API
2. opiabrowser API -> browser runtime
3. browser runtime -> external internet
4. container/process -> host OS

## Primary Threats
- SSRF into internal services and metadata endpoints
- Browser escape / sandbox bypass
- Session hijacking or cross-session leakage
- Abuse for scanning, phishing automation, or DoS
- Supply-chain compromise (dependencies, base images)

## Controls in v0.1
- URL policy validation (scheme + host + DNS/IP checks)
- Block private/link-local/localhost by default
- Block non-http(s) schemes by default
- Per-session ephemeral browser contexts
- Session TTL + max session cap
- Optional bearer API key
- Hardened deployment defaults (non-root, read-only fs, no-new-privileges)

## Residual Risk
No browser automation service is "vulnerability free". Residual risk remains from:
- 0day browser/runtime exploits
- dependency CVEs between patch windows
- policy bypass edge-cases

## Ongoing Security Plan
- Weekly dependency & container image updates
- CI SAST/dependency scan
- Security disclosure policy + rapid patch process
- Add egress proxy layer and CIDR denylist in depth
