# PiShock Discord Activity

A production-ready Discord Activity that enables consensual control of PiShock electrical devices in a multiplayer Discord environment. The UI mirrors the official pishock.com control page. Each Discord user links their own PiShock account through PiShock’s login relay; the browser never receives the PiShock session token.

---

## ⚠️ **CRITICAL SAFETY WARNING** ⚠️

**This application controls electrical shock devices that can cause physical harm, injury, or death if misused.**

- **Age Requirement**: You must be 18+ to use this application
- **Explicit Consent**: Only use with explicit, informed consent from all participants
- **Safety First**: Always start with lowest intensity settings and establish safe words
- **Legal Compliance**: Ensure compliance with all local laws and regulations
- **Personal Responsibility**: Users assume all risks and responsibility for safe use

By using this application, you acknowledge that you have read, understood, and agree to be bound by the [Terms of Service](src/client/components/TermsOfService.tsx) and [Privacy Policy](src/client/components/PrivacyPolicy.tsx).

---

## Table of Contents

- [Features Overview](#features-overview)
- [Architecture Overview](#architecture-overview)
- [Complete Setup Guide](#complete-setup-guide)
- [User Guide](#user-guide)
- [Development](#development)
- [API Reference](#api-reference)
- [Data Storage](#data-storage)
- [Safety & Security Features](#safety--security-features)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Legal & Compliance](#legal--compliance)
- [Support & Resources](#support--resources)
- [Quick Start Checklist](#quick-start-checklist)

---

## Features Overview

### Core Functionality
- **Discord Integration**: Native Discord Activity running in voice channels or DMs
- **Official-style Controller**: Shock, vibrate, beep, duration presets, intensity rails, TAP / Use Mode (press-and-hold)
- **Multiplayer Support**: Own hubs plus Discord participants who share devices into the activity
- **Real-time Updates**: WebSocket live panel updates for shares, settings, and E-STOP
- **PiShock Login Relay**: Users authenticate with PiShock; the server stores an encrypted session token (never sent to the browser)
- **Shares & Links**: Redeem website share codes, create codes, manage pause state
- **Announcements**: Live PiShock announcement banner when available

### Safety & Security Features
- **Dual Limits**: PiShock device max (hard ceiling) plus separate Discord Activity Limits per shocker
- **Activity Logging**: Commands logged for transparency and accountability
- **Consent Gate**: Safety warnings and acknowledgment required before use
- **Ban System**: Block specific Discord users from controlling your devices
- **Owner E-STOP**: Latched emergency stop per shocker; blocks all commands until released
- **Encrypted Credentials**: PiShock tokens encrypted at rest with AES-256-GCM
- **Instance Verification**: Optional Discord Activity Instance checks via bot token
- **Proxy Auth**: Optional Discord proxy signature validation for participant routes

### Technical Features
- **Self-hosted Docker stack**: Combined Fastify API + React UI, Postgres for persistence
- **GHCR images**: Published from the `release` branch (and tags / `develop`)
- **Responsive Design**: Works across desktop, mobile, and Discord’s embedded layout
- **Error Handling**: User-visible errors with graceful failure for broker/API issues

---

## Architecture Overview

```
Discord Client → Discord Activity (iframe)
                     ↓
              Fastify app (UI + API)
                     ↓
         ┌───────────┴───────────┐
         ↓                       ↓
   PostgreSQL              PiShock broker / API
   (users, sessions,       (devices, operate,
    shares, bans, logs)     login relay)
```

### Technology Stack
- **Frontend**: React 18, TypeScript, Vite, Discord Embedded App SDK
- **Backend**: Node.js, Fastify, WebSockets (`ws`)
- **Database**: PostgreSQL 16 + Prisma
- **Device API**: PiShock broker / website APIs (session-based, not the legacy v0 key API)
- **Deployment**: Docker Compose (local build or GHCR image)

### Project Structure
```
pishock-activity/
├── src/
│   ├── client/                 # React Discord Activity UI
│   │   ├── components/         # Controller, settings, safety, shares, logs
│   │   ├── App.tsx             # Main activity shell
│   │   ├── DemoApp.tsx         # Local demo without Discord
│   │   └── discord.ts          # Embedded SDK bootstrap
│   ├── server/                 # Fastify API
│   │   ├── routes/             # auth, control, shares, participants, …
│   │   ├── pishock/            # Broker client, login relay, crypto session
│   │   ├── realtime.ts         # Activity WebSocket hub
│   │   └── index.ts            # Server entry
│   └── shared/                 # Shared constants
├── prisma/                     # Schema + migrations
├── public/                     # Static fonts / assets
├── scripts/                    # Broker probe helpers
├── Dockerfile                  # Multi-stage UI+API image
├── docker-compose.yml          # Local build + Postgres
├── docker-compose.ghcr.yml     # Run published GHCR image + Postgres
├── .env.example                # Runtime env template
└── package.json
```

---

## Complete Setup Guide

### Prerequisites

#### Required Accounts & Services
1. **Discord Developer Account** — [Discord Developer Portal](https://discord.com/developers/applications)
2. **PiShock Account** — [PiShock Website](https://pishock.com) (each end user links their own account)
3. **Docker** — Docker Engine + Compose (for production-style hosting)
4. **Node.js 22+** — optional, for local development without Docker
5. **HTTPS reverse proxy** — Discord Activities require a public HTTPS URL

#### Required Knowledge
- Basic Discord Applications / Activities configuration
- Environment variables and Docker Compose
- Safety implications of electrical shock devices

---

## Step-by-Step Setup Instructions

### Step 1: Discord Application Setup

#### 1.1 Create Discord Application
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g. “PiShock Controller”)
3. **Save your Application ID** — this is `DISCORD_CLIENT_ID`

#### 1.2 Configure OAuth2
1. Open **OAuth2 → General**
2. Copy the **Client Secret** — this is `DISCORD_CLIENT_SECRET`
3. Add redirect / mapping URLs for your public host as required by Discord Activities (typically your activity origin served over HTTPS)
4. Ensure scopes needed for Activities / identify are available for your app

#### 1.3 Create and Configure Discord Bot
1. Open the **Bot** section and create a bot if needed
2. **Copy the Bot Token** — this is `DISCORD_BOT_TOKEN` (used for Activity Instance verification)
3. Enable privileged intents only if your Discord app configuration requires them for your deployment

#### 1.4 Configure Discord Activity
1. Open **Activities** for the application
2. Set the **Activity URL** to your public HTTPS origin, e.g. `https://activity.example.com`
3. Set age rating to **18+** (required)
4. For Discord’s embedded proxy, map `/` (and API paths as needed) to your host so `.proxy` requests reach the Fastify app

---

### Step 2: Repository / Image Setup

#### Option A — Build locally with Compose
```bash
git clone <your-repo-url>
cd pishock-activity
cp .env.example .env
# fill DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, TOKEN_KEY, PUBLIC_URL, …
docker compose up --build -d
```

`DISCORD_CLIENT_ID` is passed into the image build as `VITE_DISCORD_CLIENT_ID` so the Embedded SDK gets a real client id (missing this causes Discord `Invalid Origin` / dummy-client failures).

#### Option B — Run the published GHCR image
```bash
cp .env.example .env
# fill the same variables; optionally set PISHOCK_IMAGE=ghcr.io/<owner>/<repo>:release
docker compose -f docker-compose.ghcr.yml --env-file .env up -d
```

Images are published by `.github/workflows/docker-publish.yml` on pushes to `release` / `develop` and on version tags. For CI builds, set a GitHub Actions **variable** `DISCORD_CLIENT_ID` so the UI is baked with the correct client id.

---

### Step 3: Environment Configuration

Copy [`.env.example`](.env.example) → `.env` and set:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | ✅ | Postgres connection string (Compose default talks to the `db` service) |
| `DISCORD_CLIENT_ID` | ✅ | Discord Application ID (also baked into the UI build) |
| `DISCORD_CLIENT_SECRET` | ✅ | Discord OAuth2 client secret |
| `DISCORD_BOT_TOKEN` | Recommended | Activity Instance verification |
| `DISCORD_PUBLIC_KEY` | Optional | Application public key (hex) for proxy signature checks |
| `REQUIRE_DISCORD_PROXY_AUTH` | Optional | Set `1` to require proxy signatures on `/api/participants/*` |
| `TOKEN_KEY` | ✅ | 32-byte key for AES-256-GCM (64 hex chars, or any string hashed to SHA-256) |
| `PUBLIC_URL` | ✅ | Public HTTPS URL Discord points at |
| `PORT` | Optional | Host port mapped to the app (default `3000`) |
| `PISHOCK_IMAGE` | Optional | Override GHCR image when using `docker-compose.ghcr.yml` |

**Security notes**
- Never commit real `.env` values
- `TOKEN_KEY` protects PiShock session tokens at rest — treat it like a master secret
- Only `DISCORD_CLIENT_ID` is intentionally exposed to the frontend build (`VITE_DISCORD_CLIENT_ID`)

---

### Step 4: Reverse Proxy & Discord Finalization

1. Terminate TLS in front of the Compose `PORT` (e.g. Caddy, nginx, Traefik)
2. Set `PUBLIC_URL` to that HTTPS origin
3. Update the Discord Activity URL to the same origin
4. Launch the activity from a Discord voice channel / DM and confirm auth + PiShock link work

---

## User Guide

### For End Users

#### Initial Setup
1. **Join the Activity** in a Discord voice channel or DM
2. **Accept safety / consent** screens ([`SafetyWarning.tsx`](src/client/components/SafetyWarning.tsx), [`ConsentGate.tsx`](src/client/components/ConsentGate.tsx))
3. **Link PiShock**: start the login relay, complete PiShock login, confirm the account on the activity
4. **Make devices available**: choose which shockers are shared into Discord and set Activity Limits
5. Optional: redeem / create website share codes under Shares & links

#### Using the Controller
1. Select a hub / shocker on the official-style remote
2. Set intensity and duration (presets, ±1, optional random range for shock)
3. **Operate** for one-shot commands; enable **TAP / Use Mode** for press-and-hold continuous operate (requires hold permission)
4. **SO** (cog) opens Activity Limits / settings for the active shocker
5. Owners can latch **E-STOP** on a shocker to block all commands until released
6. Monitor the command log for accountability

#### Safety Features for Users
- Per-shocker Activity Limits (must stay at or below the PiShock device max)
- Public-facing command logging in the activity
- Ban unwanted Discord users from controlling your devices
- Owner emergency stop latch
- Safety notice / reminders in the UI

---

## Development

### Local Development
```bash
cp .env.example .env
# point DATABASE_URL at a local Postgres, fill Discord + TOKEN_KEY + PUBLIC_URL

npm install
npx prisma migrate deploy
npm run dev          # Fastify API (tsx watch)
npm run dev:client   # Vite UI (separate terminal)
```

`DemoApp` can be used to exercise UI flows without a full Discord embed.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | API server with hot reload |
| `npm run dev:client` | Vite frontend |
| `npm run build` | Prisma generate + Vite build + server compile |
| `npm start` | Run compiled `dist/server.js` |
| `npm run typecheck` | TypeScript checks (server + client) |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Apply migrations (`prisma migrate deploy`) |

### Environment Variables Reference

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `DATABASE_URL` | Runtime | Yes | Postgres URL for Prisma |
| `DISCORD_CLIENT_ID` | Runtime + build | Yes | Discord Application ID |
| `DISCORD_CLIENT_SECRET` | Runtime | Yes | Discord OAuth2 client secret |
| `DISCORD_BOT_TOKEN` | Runtime | Recommended | Activity Instance API |
| `DISCORD_PUBLIC_KEY` | Runtime | Optional | Proxy signature verification |
| `REQUIRE_DISCORD_PROXY_AUTH` | Runtime | Optional | `1` to enforce proxy auth |
| `TOKEN_KEY` | Runtime | Yes | AES-256-GCM key material |
| `PUBLIC_URL` | Runtime | Yes | Public activity origin |
| `PORT` | Runtime | No | Listen / host port (default 3000) |
| `VITE_DISCORD_CLIENT_ID` | Build | Yes* | Usually set from `DISCORD_CLIENT_ID` during Docker/CI build |

\*Required for a working Discord embed; without it the client falls back to a dummy id and Discord rejects the origin.

---

## API Reference

Unauthenticated:
- `GET /api/health` — liveness
- `GET /api/announcements` — PiShock announcements proxy

Discord-authenticated (Bearer / activity token):
- `POST /api/auth/discord` — exchange / establish session
- `GET /api/me` — current user + link state
- `POST /api/consent` — record consent

PiShock session (server-side token; never returned to browser):
- `POST /api/pishock/login/start`
- `GET /api/pishock/login/status`
- `POST /api/pishock/login/confirm`
- `POST /api/pishock/login/cancel`
- `DELETE /api/pishock/session`

Devices & control:
- `GET /api/devices`
- `POST /api/operate`
- `PUT /api/emergency-stop`
- `POST /api/pause`
- `GET /api/broker/status`
- `GET /api/logs`

Shares / website links:
- `GET|POST /api/links`
- `DELETE /api/links/:linkId`
- `POST|PUT /api/shares`
- `DELETE /api/shares/:shareId`

Activity availability & limits:
- `GET|PUT /api/activity/share`
- `GET|PUT /api/activity/settings`

Multiplayer participants:
- `POST /api/participants/status`
- `POST /api/participants/:targetDiscordUserId/operate`

Realtime:
- WebSocket upgrade for live panel / share / E-STOP events (see [`src/server/realtime.ts`](src/server/realtime.ts))

---

## Data Storage

Postgres via Prisma ([`prisma/schema.prisma`](prisma/schema.prisma)):

| Model | Purpose |
|-------|---------|
| `DiscordUser` | Profile, consent, personal activity caps, E-STOP shocker ids |
| `PiShockSession` | Encrypted PiShock session token (AES-256-GCM) |
| `ActivityShare` | Devices shared into Discord + dual limits / capability flags |
| `ActivityBan` | Owner → banned Discord user |
| `CommandLog` | Operate history for accountability |

Compose defaults create a local volume for Postgres (`pishock_pgdata`). Production deploys should back up that volume (or use managed Postgres via `DATABASE_URL`).

---

## Safety & Security Features

### Built-in Safety Mechanisms
- Consent / safety acknowledgment before control ([`ConsentGate.tsx`](src/client/components/ConsentGate.tsx))
- Dual intensity/duration ceilings (device max + Activity Limits)
- Owner E-STOP latch per shocker
- Ban list for Discord users
- Command logging
- TAP continuous hold only when the share/device allows hold

### Data Protection
- PiShock session tokens encrypted at rest (`TOKEN_KEY` → AES-256-GCM)
- Browser never receives the PiShock token
- Discord OAuth / activity auth required for control routes
- Optional Discord proxy signature enforcement for participant APIs
- Privacy Policy: [`PrivacyPolicy.tsx`](src/client/components/PrivacyPolicy.tsx)

---

## Troubleshooting

### Common Issues

#### Discord `RPCError: Invalid Origin` / dummy client id
**Cause**: UI built without a real `VITE_DISCORD_CLIENT_ID`  
**Solution**: Rebuild with `DISCORD_CLIENT_ID` available to Compose build args, or set the GitHub Actions variable `DISCORD_CLIENT_ID` and republish the image

#### Activity won’t load behind Discord proxy
**Cause**: HTTPS / URL mapping / `PUBLIC_URL` mismatch  
**Solution**: Confirm Activity URL, reverse-proxy paths, and `PUBLIC_URL` all match the public origin Discord embeds

#### PiShock link / login fails
**Cause**: Relay cancelled, account mismatch, or broker unreachable  
**Solution**: Restart login from the activity, confirm the same PiShock account, check server logs and hub online status

#### Operate rejected / limited
**Cause**: Activity Limits, device max, pause, ban, or E-STOP  
**Solution**: Check Activity Limits, share pause state, bans, and whether the owner latched E-STOP

#### Database / migrate errors on boot
**Cause**: Postgres not ready or volume permissions  
**Solution**: Wait for the `db` healthcheck; for bind-mounted data dirs ensure the Postgres user can write (official image often runs as uid `70`)

#### GHCR image won’t start
**Cause**: Missing env vars or wrong image tag  
**Solution**: Compare `.env` to [`.env.example`](.env.example); set `PISHOCK_IMAGE` to a tag that exists (`:release`, `:develop`, or a version tag)

### Useful Commands
```bash
docker compose ps
docker compose logs -f app
curl -sS "$PUBLIC_URL/api/health"
```

---

## Contributing

### Development Guidelines
- **Safety first**: changes must maintain or improve consent, limits, logging, and E-STOP behavior
- **No safety bypasses**: do not weaken auth, encryption, or limit enforcement for convenience
- **Test device control carefully** on hardware you own / have consent to use
- **Update docs** when APIs or setup steps change

### Code Standards
- TypeScript for client and server
- Keep Prisma schema and migrations in sync
- Prefer small, focused changes over drive-by refactors

---

## Legal & Compliance

### Terms of Service
See [`TermsOfService.tsx`](src/client/components/TermsOfService.tsx):
- Educational and consensual adult use only
- Users must be 18+
- Explicit consent required from all participants
- Users assume all risks and responsibility for safe use
- Must comply with applicable local laws

### Liability Disclaimer
- Developers assume no responsibility for harm, injury, or misuse
- Users are solely responsible for safe operation of electrical devices
- Application provided “as-is” without warranties

### Safety Requirements
- Always start with lowest intensity settings
- Establish safe words and emergency procedures
- Never use with individuals who have medical conditions or contraindicated devices
- Avoid sensitive body areas and follow PiShock safety guidelines
- Monitor all participants for consent and comfort

### Data Privacy
See [`PrivacyPolicy.tsx`](src/client/components/PrivacyPolicy.tsx):
- Users control linking / unlinking their PiShock session
- Activity logs exist for safety and accountability
- No sharing of user data with unauthorized third parties beyond Discord and PiShock as required for operation

---

## Support & Resources

### Getting Help
1. Review this README and [`.env.example`](.env.example)
2. Check [Troubleshooting](#troubleshooting)
3. For safety emergencies, stop use immediately and follow local emergency procedures
4. For technical issues, inspect Compose logs and `/api/health`

### Useful Links
- [Discord Activities overview](https://discord.com/developers/docs/activities/overview)
- [Discord Embedded App SDK](https://github.com/discord/embedded-app-sdk)
- [PiShock](https://pishock.com)

### Community Guidelines
- Prioritize safety in all discussions and usage
- Respect consent and privacy
- Follow responsible disclosure for security issues
- Keep device control transparent and accountable

---

## Quick Start Checklist

- [ ] Discord Application created (18+ Activity)
- [ ] `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / bot token available
- [ ] `.env` filled from `.env.example` (`TOKEN_KEY`, `PUBLIC_URL`, DB, Discord)
- [ ] Stack running via `docker compose up --build` or `docker-compose.ghcr.yml`
- [ ] HTTPS reverse proxy pointing at the mapped host port
- [ ] Discord Activity URL set to `PUBLIC_URL`
- [ ] UI built/baked with real `DISCORD_CLIENT_ID` (no dummy client id)
- [ ] Activity launches inside Discord
- [ ] Safety / consent screens reviewed
- [ ] PiShock account linked and a device online
- [ ] Activity Limits set; emergency procedures agreed before first use

---

**Remember: Safety is paramount. This application controls electrical devices. Always prioritize user safety, consent, and legal compliance in all usage and development.**

---

## License

This project is provided for educational purposes. Users are responsible for ensuring compliance with all applicable laws and regulations in their jurisdiction.

## Acknowledgments

- Powered by Discord’s Embedded App SDK
- Uses PiShock for device control and account linking
- UI patterns inspired by the official PiShock remote / control page
