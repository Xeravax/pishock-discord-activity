# PiShock Discord Activity (.NET 10)

Discord Activity that controls PiShock devices. **ASP.NET Core 10** hosts the API and a **Blazor WebAssembly** UI. Postgres stores sessions, shares, bans, and logs. PiShock tokens stay encrypted on the server (`TOKEN_KEY`).

> **Safety:** This controls real shock devices. 18+ only, informed consent required, start low, keep E-STOP reachable. Users accept the risks.

The legacy v1 app lives in a separate repo folder (`pishock-discord-activity`) and is not part of this project.

## Stack

- Server: ASP.NET Core Minimal APIs, EF Core, `/api/ws`
- UI: Blazor WASM + Kiota-shaped activity client; Discord Embedded App SDK via a small JS bundle
- DB: PostgreSQL 16 (existing Prisma migration SQL is applied on fresh volumes; EF Baseline afterward)
- Deploy: Docker Compose / GHCR image on port 3000

## Quick start

```bash
cp .env.example .env   # fill DISCORD_CLIENT_ID/SECRET, TOKEN_KEY, PUBLIC_URL
docker compose up --build -d
```

- Health: `http://localhost:3000/api/health`
- UI demo (no Discord): `http://localhost:3000/?demo`

Required env vars match `.env.example`. `DISCORD_CLIENT_ID` is also a Docker **build-arg** baked into WASM `appsettings.json`.

## Local development

```bash
# Postgres up (compose db only is fine), then:
dotnet test PiShock.Activity.sln -c Release
dotnet run --project src/PiShock.Activity.Server
```

Set `DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `TOKEN_KEY`, and `PUBLIC_URL` in the environment (or `.env` loaded by the server).

## Layout

```
pishock-activity/
  src/PiShock.Activity.Server/     # Kestrel host, API, EF, broker/relay
  src/PiShock.Activity.Web/        # Blazor WASM UI
  src/PiShock.Activity.ApiClient/  # Activity API client (Kiota-shaped)
  tests/PiShock.Activity.Tests/    # Safety / abuse xUnit tests
  prisma/                          # Schema + SQL migrations (bootstrap)
  sdk-bundle/                      # esbuild for discordSdk.js
  Dockerfile
  docker-compose.yml
```

## CI

- `.github/workflows/test.yml` / `dotnet-test.yml` — `dotnet test`
- `.github/workflows/docker-publish.yml` — GHCR image (`DISCORD_CLIENT_ID` build-arg)
