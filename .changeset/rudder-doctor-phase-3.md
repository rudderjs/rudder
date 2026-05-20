---
'@rudderjs/cli':            minor
'@rudderjs/auth':           minor
'@rudderjs/session':        minor
'@rudderjs/hash':           minor
'@rudderjs/orm-prisma':     minor
'@rudderjs/orm-drizzle':    minor
'@rudderjs/cashier-paddle': minor
'@rudderjs/queue-bullmq':   minor
'@rudderjs/queue-inngest':  minor
'@rudderjs/ai':             minor
'@rudderjs/mcp':            minor
'@rudderjs/telescope':      minor
'@rudderjs/pulse':          minor
'@rudderjs/horizon':        minor
---

Phase 3 of `rudder doctor` — first wave of package-contributed checks.

Thirteen framework packages now ship a `<package>/doctor` subpath whose
side-effect import registers domain-specific health checks on the shared
doctor registry. The CLI's lazy loader auto-imports them when
`rudder doctor` runs.

New checks (14 total, grouped by category):

- **auth** — `auth:secret` (AUTH_SECRET set + length sane), `auth:views-vendored`
  (vendored when a frontend renderer is installed).
- **auth** (cont.) — `session:secret` (SESSION_SECRET length when set), `hash:driver`
  (config string ∈ {bcrypt, argon2}; flags missing `argon2` peer).
- **orm** — `orm-prisma:schema` (schema files present), `orm-prisma:client-generated`
  (mtime check vs schema), `orm-prisma:database-url`, `orm-drizzle:schema`,
  `orm-drizzle:database-url`.
- **billing** — `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`
  (both conditional on a cashier route being mounted).
- **queue** — `queue-bullmq:redis-url`, `queue-inngest:event-key`,
  `queue-inngest:signing-key`.
- **ai** — `ai:provider-keys` (greps `config/ai.ts` for declared driver
  literals, then checks each cloud provider's API key env var).
- **mcp** — `mcp:route-mounted` (if `app/Mcp/` has tools, mcp route is
  registered).
- **monitoring** — `telescope:dashboard`, `pulse:dashboard`,
  `horizon:dashboard` (dashboard route reachable from `routes/web.ts`).

Adding a new contributing package: ship a `<package>/doctor` subpath with
side-effect `registerDoctorCheck` calls and append the package name to
`PACKAGES_WITH_CHECKS` in `@rudderjs/cli/src/doctor/load-package-checks.ts`.

Implementation notes:

- The CLI's loader resolves doctor subpaths via direct path
  (`<cwd>/node_modules/<pkg>/dist/doctor.js`), not `createRequire.resolve`,
  because the `./doctor` exports condition is `import`-only (no `require`)
  and the strict-mode pnpm node_modules don't expose user-installed
  packages from the CLI's location. Documented as the ESM-only-peer
  resolution workaround.
- `deps:auth-views` was removed from the CLI's built-in checks — the
  identical concern now lives at `auth:views-vendored` in
  `@rudderjs/auth/doctor`, where it belongs. Net check count for a user
  with `@rudderjs/auth` installed: same (one each); for a user without
  auth, doctor stays silent on the topic instead of saying "auth not
  installed — skip".

No tests added in this phase — each check is small enough to be tested
implicitly via integration smoke (the existing temp-dir test suite in
`@rudderjs/cli`, plus a manual smoke against `playground/`). Per-package
test suites for these checks may land in a follow-up.

Phase 4 (`--deep`) and Phase 5 (`--fix`) follow in subsequent releases.
