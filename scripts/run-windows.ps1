$env:OPIA_HOST = if ($env:OPIA_HOST) { $env:OPIA_HOST } else { '127.0.0.1' }
$env:OPIA_PORT = if ($env:OPIA_PORT) { $env:OPIA_PORT } else { '8787' }
$env:OPIA_BLOCK_PRIVATE = if ($env:OPIA_BLOCK_PRIVATE) { $env:OPIA_BLOCK_PRIVATE } else { 'true' }
$env:OPIA_ALLOW_HTTP = if ($env:OPIA_ALLOW_HTTP) { $env:OPIA_ALLOW_HTTP } else { 'false' }
node src/index.js
