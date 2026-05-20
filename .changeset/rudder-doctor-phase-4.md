---
'@rudderjs/cli':          minor
'@rudderjs/orm-prisma':   minor
'@rudderjs/queue-bullmq': minor
'@rudderjs/mail':         minor
---

Phase 4 of `rudder doctor` — `--deep` runtime mode.

`rudder doctor --deep` now boots the app (catching boot errors as a check
result, never crashing doctor itself) and runs 6 new runtime checks
that interrogate the live DI graph and external services.

What's new:

- **`runtime:app-boot`** (cli) — wraps `bootApp()` in try/catch. Boot
  success/failure becomes a check result with the error message + stack
  trace under `--verbose`. The fix line points at the most likely causes
  (missing env vars, unreachable services, missing provider deps).

- **`runtime:port-free`** (cli) — `net.createServer().listen(PORT)` then
  immediately close. On `EADDRINUSE` it shells out to `lsof -ti :PORT`
  (macOS/Linux) to report the holding PID with a paste-able `kill <pid>`
  fix. Windows skips the PID lookup since `lsof` isn't standard there.

- **`orm-prisma:db-connect`** — spawns a fresh PrismaClient via the
  user's resolved `@prisma/client`, runs `$connect()` + `$queryRaw\`SELECT
  1\``, disconnects. DSN passwords are redacted in error messages.

- **`orm-prisma:migration-drift`** — runs `pnpm exec prisma migrate
  status`; warns on pending migrations or drift, points at
  `pnpm rudder migrate`.

- **`queue-bullmq:redis-ping`** — opens an ioredis connection with
  `lazyConnect: true`, `maxRetriesPerRequest: 0`, sends `PING`, closes.
  Fails fast (no retry storm), redacts the URL in the error.

- **`mail:smtp-connect`** — raw TCP connect (no SMTP handshake, no
  credentials sent) to MAIL_HOST:MAIL_PORT or the host inferred from
  `config/mail.ts`. Times out after 2s.

Implementation notes:

- Boot status flows from the doctor command to runtime checks via a
  `globalThis['__rudderjs_doctor_boot_status__']` slot (the same pattern
  cli/router/orm use for cross-module singletons that survive Vite SSR
  re-eval).

- The doctor command stays in `NO_BOOT_EXACT`. With `--deep`, the
  handler calls `bootApp()` itself inside try/catch, AFTER the
  built-in/package checks have registered. This means a boot crash
  doesn't take out the orchestrator — every runtime check still gets
  to render.

- `--only <substring>` now matches both check id AND category. `--only
  orm` catches `orm-prisma:*` + `orm-drizzle:*`; `--only runtime`
  catches every `category: 'runtime'` check regardless of package
  prefix.

- Each runtime check that depends on an env var (DATABASE_URL,
  REDIS_URL, MAIL_HOST) skips with a clean "covered by <fast-path
  check>" message when the var is unset, instead of failing loudly.
  The fast-path check has already flagged the issue.

End-to-end smoke against the playground: 28 checks across 10
categories with `--deep`, every runtime check loads via the lazy
loader and surfaces actionable findings or appropriate skips.

Phase 5 (`--fix` idempotent auto-recovery) and Phases 6-7 (docs +
ship) follow in subsequent PRs.
