# Dev-only probe scripts

Manual diagnostics against the real PiShock API. **Not used by the app, CI, or Docker.**

| Script | What it does |
| --- | --- |
| `probe-devices.mjs` | Decrypts a stored PiShock session token from the DB (needs `DATABASE_URL` + `TOKEN_KEY`) and lists devices |
| `probe-operate.mjs` | Exercises the operate endpoints |
| `probe-share-operate.mjs` | Exercises share-code operate |

They read real credentials and can send **real commands to real devices**. Only run them
against your own account with consenting hardware, and never against a production database
you do not own.
