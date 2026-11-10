#!/bin/sh
set -eu

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

require() {
  # shellcheck disable=SC2086
  eval "val=\${$1-}"
  if [ -z "$val" ]; then
    fail "$1 is required but empty. Set it in your .env or compose environment, then restart."
  fi
}

echo "Checking required environment…"

require DATABASE_URL
require DISCORD_CLIENT_ID
require DISCORD_CLIENT_SECRET
require TOKEN_KEY
require PUBLIC_URL

# PORT is optional (Dockerfile defaults to 3000)
if [ -n "${PORT-}" ]; then
  case "$PORT" in
    ''|*[!0-9]*) fail "PORT must be a number (got: $PORT)" ;;
  esac
fi

if [ -z "${DISCORD_BOT_TOKEN-}" ]; then
  echo "WARN: DISCORD_BOT_TOKEN is empty — Discord Shockers / Activity Instance checks may fail." >&2
fi

if [ -z "${DISCORD_PUBLIC_KEY-}" ] && [ "${REQUIRE_DISCORD_PROXY_AUTH-}" = "1" ]; then
  fail "DISCORD_PUBLIC_KEY is required when REQUIRE_DISCORD_PROXY_AUTH=1."
fi

echo "Applying database migrations…"
npx prisma migrate deploy

echo "Starting PiShock Activity on :${PORT:-3000}…"
exec node dist/server.js
