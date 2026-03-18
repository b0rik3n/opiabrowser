# opiabrowser Threat Model (v0.2)

## Objective
Provide safer browsing for high-risk links by isolating browser execution from the host OS.

## Protected Assets
- Host OS and local user environment
- Internal network services (localhost, RFC1918, metadata endpoints)
- Session data generated during isolated browsing
- API credentials/configuration

## Trust Boundaries
1. User UI client -> opiabrowser service
2. opiabrowser service -> isolated browser context
3. isolated browser context -> external internet
4. runtime/container boundary -> host OS

## Primary Threats
- SSRF/internal network probing via loaded pages
- Browser sandbox escape or runtime compromise
- Session leakage across users/connections
- Abuse as a generic automation/scanning proxy
- Supply-chain compromise (dependencies/base images)

## Security Controls Implemented
- URL validation with scheme and host/IP checks
- Private/internal/link-local blocking by default
- Non-HTTP(S) protocol deny-by-default
- Ephemeral session lifecycle (destroy on disconnect)
- Optional API auth for non-local deployment
- Hardened container guidance (least privilege)

## Out of Scope / Non-Goals
- Bypassing anti-bot protections
- Evading access controls or website security policies
- Offensive automation tooling

## Residual Risk
- Browser engine 0day vulnerabilities
- Third-party dependency CVEs between updates
- Novel parser/URL-policy bypass techniques

## Security Operations Plan
- Keep browser/runtime dependencies current
- Track CVEs and publish patch releases quickly
- Add automated dependency/container scanning in CI
- Maintain private vulnerability intake and coordinated disclosure
