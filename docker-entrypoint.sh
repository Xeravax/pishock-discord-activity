#!/bin/sh
set -eu

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

require() {
  eval "val=\${$1-}"
  if [ -z "$val" ]; then
    fail "$1 is required but empty. Set it in your .env or compose environment, then restart."
  fi
}

# Prisma uses ?schema=public; psql/Npgsql do not accept that query key.
psql_url() {
  printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*//g; s/\?&/?/g; s/\?$//; s/&&+/\&/g'
}

echo "Checking required environment…"
require DATABASE_URL
require DISCORD_CLIENT_ID
require DISCORD_CLIENT_SECRET
require TOKEN_KEY
require PUBLIC_URL

if [ -z "${DISCORD_BOT_TOKEN-}" ]; then
  echo "WARN: DISCORD_BOT_TOKEN is empty — Discord Shockers / Activity Instance checks may fail." >&2
fi

if [ -z "${DISCORD_PUBLIC_KEY-}" ] && [ "${REQUIRE_DISCORD_PROXY_AUTH-}" = "1" ]; then
  fail "DISCORD_PUBLIC_KEY is required when REQUIRE_DISCORD_PROXY_AUTH=1."
fi

PSQL_DATABASE_URL="$(psql_url "$DATABASE_URL")"

# Fresh volumes: apply Prisma SQL once so EF's empty Baseline can mark history without CreateTable.
# Existing volumes already have tables from _prisma_migrations — leave them untouched.
apply_prisma_if_needed() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "WARN: psql unavailable — skipping Prisma SQL bootstrap (startup MigrateAsync still runs)."
    return 0
  fi

  if psql "$PSQL_DATABASE_URL" -Atc "SELECT to_regclass('public.\"DiscordUser\"')" 2>/dev/null | grep -q DiscordUser; then
    echo "Postgres schema present (DiscordUser) — leaving Prisma history intact."
    return 0
  fi

  echo "No DiscordUser table — applying prisma/migrations/*.sql in order…"
  for f in /app/prisma/migrations/*/migration.sql; do
    [ -f "$f" ] || continue
    echo "  → $f"
    psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
}

echo "Ensuring database schema…"
apply_prisma_if_needed || echo "WARN: Prisma bootstrap failed; app MigrateAsync may still record EF baseline."

echo "Starting PiShock Activity on :${PORT:-3000}…"
exec dotnet PiShock.Activity.Server.dll
