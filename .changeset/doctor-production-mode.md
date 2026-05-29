---
'@rudderjs/cli': minor
'@rudderjs/console': minor
---

`rudder doctor --production` — pre-deploy readiness mode.

```bash
pnpm rudder doctor --production           # strict prod-readiness check
pnpm rudder doctor --production --deep    # ...with app-boot runtime checks too
```

Adds a new `production` category of strict invariants gated behind `--production` (so they don't false-fire in dev). Each maps to a real "I almost shipped a security bug" class:

| Check | Enforces |
|---|---|
| `production:app-debug` | `APP_DEBUG` is NOT `true`/`1` (would leak stack traces + `dump()` output) |
| `production:app-env` | `APP_ENV` is `production` |
| `production:app-url` | `APP_URL` starts with `https://` |
| `production:database-url` | `DATABASE_URL` is NOT SQLite or `localhost`/`127.0.0.1`/`0.0.0.0` (creds redacted in the report) |
| `production:rudder-pinning` | No `@rudderjs/*` deps on floating ranges (`latest`/`*`/`next`) |
| `production:workspace-refs` | No `workspace:*` refs in `package.json` |
| `production:dist-exists` | `dist/` build output exists |
| `production:providers-manifest` | `bootstrap/cache/providers.json` is present |

Designed for the deploy pipeline:

```yaml
- name: Pre-deploy doctor
  run: pnpm rudder doctor --production
```

Non-zero exit on any non-green outcome — catches the bug before the deploy lands.

**Internal:** `DoctorCheck.productionOnly?: boolean` is the new flag on the registry interface (`@rudderjs/console` minor bump). Both the `--production` gate AND the existing `--deep` gate are applied in the orchestrator's filter; `--deep --production` runs everything.
