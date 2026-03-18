#!/usr/bin/env bash
set -euo pipefail
export OPIA_HOST=${OPIA_HOST:-127.0.0.1}
export OPIA_PORT=${OPIA_PORT:-8787}
export OPIA_BLOCK_PRIVATE=${OPIA_BLOCK_PRIVATE:-true}
export OPIA_ALLOW_HTTP=${OPIA_ALLOW_HTTP:-false}
node src/index.js
