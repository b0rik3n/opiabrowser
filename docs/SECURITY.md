# Security Policy

## Supported Versions
- 0.x: supported while rapidly iterating

## Reporting a Vulnerability
Please report privately via GitHub Security Advisory / private email (to be added).
Do not open public issues for exploitable findings.

## Security Baseline
- Secure-by-default policy denies internal/private network targets
- No non-http(s) URL schemes
- Short-lived isolated sessions
- Least-privilege deployment guidance (non-root + hardened container)

## Hardening Recommendations
- Bind service to localhost unless behind authenticated gateway
- Always set `OPIA_API_KEY` for remote access
- Run behind TLS termination + mTLS for internal services
- Add rate limiting and WAF/API gateway in production
- Keep Playwright + browser binaries up to date
