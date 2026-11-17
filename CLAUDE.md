# PiShock Discord Activity — agent guide

Discord Activity (Fastify + React 19 + Prisma/Postgres) that lets consenting users control
PiShock **electrical shock devices**. Mistakes here can physically hurt people. Treat every
change near device control as safety-critical.

## Commands
```bash
npm test             # node --test: safety gates, validation, route invariants
npm run lint         # oxlint --type-aware (typescript-eslint doesn't support TS 7)
npm run typecheck    # server + client (does NOT cover test/)
npm run build        # prisma generate + vite + tsc + scripts/postbuild.mjs
npm run dev          # API (tsx watch)   |   npm run dev:client   # Vite UI
```
Run `npm run lint && npm run typecheck && npm test` before finishing. CI is blocking.

## Safety invariants — never weaken these
1. **Limits are enforced server-side only.** The client may send `canShock`, `maxIntensity`,
   etc.; the server ignores them. Ceilings come from `src/server/operate-policy.ts`
   (device max ∩ share/personal Activity Limits). Never trust `body.clientId` for routing.
2. **Every path that fires a device must go through the gates**: consent, rate limit,
   e-stop, PiShock pause, ban, mode flags, ceilings, clamps. `test/route-invariants.test.ts`
   statically enforces this and lists the only routes/files allowed to fire a device.
   If it fails after your change, fix the code — do not just edit the allowlist. Adding a
   new firing path needs an explicit review and a matching update to that test.
3. **Queued commands are re-validated at execution time** (`command-queue-runtime.ts`).
4. **E-STOP is a DB-backed latch** (`emergencyStopShockerIds`) plus an in-memory pending
   overlay (`gateEmergencyStops`). Stop frames must never be blocked by limits.
5. **Holds must always end.** `scheduleHoldAutoEnd` timers live in memory; shutdown and
   crash handlers flush them via `endAllActiveHolds`. Keep both wired.
6. **Fail safe on restart/uncertainty**: unknown state means block or stop, not proceed.
7. Secrets: PiShock tokens are AES-GCM encrypted (`TOKEN_KEY`) and never sent to the
   browser. Don't log tokens, bearer headers, or `?token=` URLs (logger redacts these).

## Conventions
- Request bodies are validated with Zod in `src/server/schemas/` via `parseBody()`.
  Schemas are non-strict (strip unknown keys) so older clients keep working; keep the
  existing error messages, and match what the client actually sends (e.g. `warning` is an
  object on both operate routes).
- Single-instance design: module-level `Map`s hold rate buckets, queues, broker sessions.
  Don't add horizontally-scaled assumptions; see README "Restarts & safety".
- New env vars go through `loadEnv()` in `src/server/env.ts` and `.env.example` + README.
- Prisma changes need a migration in `prisma/migrations/`.
- Client lint warnings (`set-state-in-effect`, `refs`, `purity`) are known debt in the
  3k-line `App.tsx` / `OfficialController.tsx`; don't add new ones.
- Prettier config exists but the repo isn't reformatted — don't mass-format in feature PRs.
- `scripts/dev/` holds manual probes that can send real commands; never run them in CI.

## Not covered by tests (check by hand)
Discord iframe behaviour (CSP is report-only until `CSP_ENFORCE=1`), real PiShock API
responses, WebSocket realtime flows.
