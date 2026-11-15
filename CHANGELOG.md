# Changelog

## v2.2.0 — 2026-11-15

## What's changed

### Friends & sharing
- Invite someone into the activity from the roster (Discord invite dialog, or a share link)
- Share a shock, vibrate, or beep from the log as an animated card in Discord (desktop activity)
- Shared cards show a warning pill when a pre-shock warning was sent
- Roster avatars show who is speaking or muted when voice access is allowed

### Discord & layout
- Discord connect times out and retries cleanly, and the activity still opens if voice permission is declined
- Official remote layout fits more window sizes

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v2.1.1...v2.2.0

## v2.1.0 — 2026-11-15

## What's changed

### Platform
- Rebuilt as a self-hosted Discord Activity (Fastify + React + Postgres) with GHCR/Docker deploy
- Live build version badge; outdated clients are blocked until relaunch
- Click the version badge for **Latest version** + changelog
- Auto GitHub Releases on every push to `release` (`#major` / `#minor` / `#patch`)

### Controls & friends
- Official-style remote: shock / vibrate / beep, hold (tap) mode, duration presets, edge nudges
- Discord Shockers: control friends in the activity with live roster status
- Multi-shock and per-person intensity; color-coded targets and limit markers
- Owner E-STOP latch; pause sync from PiShock; share / Activity Limit ceilings enforced server-side
- PIP surface shows incoming hits (and queue next when enabled)

### Sharing & setup
- First-run setup for which shockers to share into Discord
- Per-mode Activity Limits (shock / vibrate / beep min–max intensity & duration)
- PiShock link flow with confirm, API key reveal, and rejected-key recovery
- Default start menu prompt (own hubs vs Discord Shockers)

### Command queue
- Optional owner queue: pause, halt, skip, clear, stars / stars-only access
- Real-time queue position and ETA for senders

### Mobile & Discord chrome
- Respect Discord mobile safe areas (Leave / Invite / minimize bar)
- Compact remote layout on short/narrow phones (no oversized desktop scale)

### Safety & ops
- Safety notice / consent gate; richer public command log (source & location)
- Graceful shutdown + health reporting for deploys
- Emergency-stop and hold-cancel race fixes; firmer limit enforcement

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v1.0...v2.1.0
