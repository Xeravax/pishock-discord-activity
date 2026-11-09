# PiShock Discord Activity

Dockerized Discord activity that mirrors the pishock.com control page. Each Discord user links their own PiShock session via PiShock's login relay; the browser never receives the PiShock token.

## Run

```bash
cp .env.example .env
# fill DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, TOKEN_KEY, PUBLIC_URL
docker compose up --build
```

Required env:

- `DATABASE_URL` (compose default talks to the `db` service)
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` — this Discord application
- `TOKEN_KEY` — 32-byte key (64 hex chars, or any string hashed to SHA-256)
- `PUBLIC_URL` — public HTTPS URL Discord points at
- `PORT` — host port (default 3000)

Point the Discord application's activity URL at `PUBLIC_URL`.
