# opiabrowser v0.2.0 (draft)

## Summary
First security-focused public build of opiabrowser as an isolated high-risk link browser.

## Highlights
- RBI-style simple browsing UI (`/`)
- Isolated browser session per connected client
- Default network safety policy:
  - block localhost/private/link-local/metadata
  - block non-HTTP(S) schemes
- Configurable startup home URL (`OPIA_HOME_URL`)
- Optional token auth (`OPIA_API_KEY`)

## Security Positioning
opiabrowser is a defensive isolation tool.
It is not designed for bypassing anti-bot or access-control protections.

## Breaking/Behavior Notes
- Session lifecycle is intentionally ephemeral in simple mode.
- Startup default home URL is `https://example.com` for reliability.

## Next
- Session recording and forensic mode
- Rate limiting and quotas
- SBOM + signed releases
