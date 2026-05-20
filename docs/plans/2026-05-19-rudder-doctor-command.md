# `rudder doctor` — diagnostic command for scaffolded apps

**Status:** plan, 2026-05-19. Pickup task for the next framework session.
**Origin:** session 2026-05-19 — agreed the framework is past the "constantly shipping fixes" phase (1.0 graduated across all packages; cold-boot / ORM / static-state / MCP / perf audits done) and into "make it diagnosable for outsiders" phase. The user-empathy gap: when something breaks in a scaffolded app, the user sees a stack trace 8 frames deep into vike / hono / @rudderjs/core with nowhere to triage. `rudder doctor` is the answer — one shell-out, every common setup failure surface gets a green / yellow / red + a paste-able fix.

---

## Why this exists

The framework's failure modes are layered. A user installs a recipe, runs `pnpm dev`, and the app dies for one of N reasons that all surface as opaque errors:

- Missing env var (`APP_KEY`, `AUTH_SECRET`, `PADDLE_API_KEY`, …) — surfaces as a deep crash inside a provider's `boot()`.
- Stale `bootstrap/cache/providers.json` after `pnpm add @rudderjs/<X>` — `[RudderJS] @rudderjs/X listed in the provider manifest but not installed` (or the inverse: package installed but not in the manifest, so its provider never runs).
- Prisma client out of date vs `schema.prisma` — `Cannot find module '.prisma/client/default'`.
- Auth views not vendored when `@rudderjs/auth` is installed — `/login` resolves to a missing view at boot.
- Port 3000 in use — server bind error.
- Vike renderer ambiguity — multi-renderer install error from the view scanner.
- ORM is configured but the DB at `DATABASE_URL` isn't running.
- Peer dep installed but not the corresponding adapter (`queue` without `queue-bullmq` / `queue-inngest`).

Each of these has a recognizable fingerprint, a documented one-line fix, and is invisible until the user hits it. A doctor command flips that: pre-flight every layer, name the broken one, paste the fix.

This is also a force multiplier for the package ecosystem. Each first-party package contributes its own checks via a registry — same shape as `rudder.command()` — so new packages plug in for free, and community packages can do the same.

### What surfaced it

Two signals from session 2026-05-19:

1. The cashier-paddle silent-fail bug (#545) was caught by **real Paddle traffic from pilotiq.io's first prod checkout**, not by tests. The recovery script in pilotiq-io (`/portal/recover`) is the kind of triage surface every framework user needs but doesn't have unless they build it themselves. Doctor lifts that surface into the framework.
2. The npm coverage gap (#547) means we don't even *know* what breaks on non-pnpm setups for outside users — but the manifest-staleness class of bug is independent of PM and will hit them. Doctor catches that without needing a full per-PM E2E.

## Goals

- **One command, sub-second fast path.** `pnpm rudder doctor` runs env + structure + deps + manifest checks without booting the app. Most common setup failures surface here.
- **Extensible via a registry.** Packages contribute checks in their provider's `boot()` (skip-boot variant: contribute via a registry export so cli can load checks without booting). Same idiom as `rudder.command()`.
- **One-line output per check.** Status icon + short message. Failures expose a `fix:` line that's a literal shell command the user can paste. `--verbose` shows the multi-line detail when needed.
- **Deep mode for "the app won't start."** `pnpm rudder doctor --deep` boots the app once and runs runtime checks (DB connect, port, external services).
- **Conservative fix mode.** `pnpm rudder doctor --fix` auto-applies only safe fixes (regenerate manifest, regenerate Prisma client, vendor auth views). Never modifies `.env` or `package.json`.

## Non-goals

- Not a replacement for actual error messages in user code — code bugs need stack traces, not health checks.
- Not a security scanner (no vulnerability or audit checks).
- Not a runtime monitor — runs once and exits. Live monitoring belongs in `@rudderjs/pulse`.
- Not a perf profiler — perf belongs in dedicated benchmarks.
- Not auto-fix by default. `--fix` is opt-in.
- Not a JSON-output mode in v1. CI integration is a follow-up.

## Architecture

Plugin-registry pattern, mirroring `@rudderjs/cli`'s existing `rudder.command()` shape.

```
@rudderjs/cli
├── src/
│   ├── doctor/
│   │   ├── registry.ts        # registerDoctorCheck + getRegisteredChecks
│   │   ├── orchestrator.ts    # collect → run → format
│   │   ├── reporter.ts        # column output, icons, fix lines
│   │   ├── types.ts           # DoctorCheck, DoctorResult
│   │   └── built-in/          # cli-owned checks (env, structure, deps, manifest)
│   │       ├── node-version.ts
│   │       ├── package-manager.ts
│   │       ├── env-vars.ts
│   │       ├── bootstrap.ts
│   │       ├── providers-manifest.ts
│   │       └── declared-deps.ts
│   └── commands/doctor.ts     # rudder.command('doctor', ...) wiring
```

Public API:

```ts
// @rudderjs/cli/doctor — re-exported from main barrel for ergonomics
export interface DoctorCheck {
  id:          string                                 // 'cashier-paddle:webhook-secret'
  category:    'env' | 'structure' | 'deps' | 'orm' | 'runtime' | string
  title:       string                                 // 'Paddle webhook secret'
  needsBoot?:  boolean                                // true → only runs in --deep
  run():       Promise<DoctorResult> | DoctorResult
}

export interface DoctorResult {
  status:      'ok' | 'warn' | 'error'
  message:     string                                 // one-line summary
  fix?:        string                                 // paste-able shell command
  detail?:     string                                 // shown with --verbose
}

export function registerDoctorCheck(check: DoctorCheck): void
```

Package usage:

```ts
// In a provider's register() (NOT boot — checks must be available without booting)
import { registerDoctorCheck } from '@rudderjs/cli/doctor'

registerDoctorCheck({
  id:       'cashier-paddle:webhook-secret',
  category: 'env',
  title:    'PADDLE_WEBHOOK_SECRET',
  run:      () => (process.env['PADDLE_WEBHOOK_SECRET']?.length ?? 0) >= 16
    ? { status: 'ok',    message: 'set' }
    : { status: 'error', message: 'missing or too short',
        fix:     'Set PADDLE_WEBHOOK_SECRET in .env (Paddle Dashboard → Developer Tools → Notifications)' },
})
```

The doctor command does **not** boot the app for the fast path. Checks are loaded by iterating package manifest entries and calling each package's `boot.ts` / `checks.ts` subpath if exported. The CLI already does similar lazy loading for `loadPackageCommands()` — we extend the pattern with a `doctor` subpath convention (per `package_commands_dont_register_in_cli` pitfall, you have to wire packages into the CLI explicitly; same applies here).

Output shape:

```
RudderJS Doctor

env
  ✓ Node version             22.14.0 (matches ^20.19.0 || >=22.12.0)
  ✓ Package manager          pnpm 10.29.3 — lockfile present
  ✓ APP_KEY                  set, 32 bytes
  ✗ AUTH_SECRET              missing
    fix: Add AUTH_SECRET to .env (any random string >=32 chars)
  ✗ PADDLE_WEBHOOK_SECRET    missing or too short
    fix: Set PADDLE_WEBHOOK_SECRET in .env (Paddle Dashboard → Developer Tools → Notifications)

structure
  ✓ bootstrap/app.ts         parses
  ✓ bootstrap/providers.ts   resolves
  ⚠ providers manifest        12 days old — schema may have drifted
    fix: pnpm rudder providers:discover
  ✓ Welcome view              app/Views/Welcome.tsx

deps
  ✓ @rudderjs/* installed     12 declared, 12 found
  ⚠ Auth views                @rudderjs/auth installed but app/Views/Auth/ missing
    fix: pnpm rudder cashier:install   (or vendor manually from @rudderjs/auth/views/react/)

orm
  ✓ Prisma schema             prisma/schema/*.prisma found
  ✗ Prisma client             out of date — schema modified 2h ago, client 12d ago
    fix: pnpm rudder db:generate

14 checks · 10 ok · 1 warn · 3 errors · 0.4s

Run with --deep to also check DB connect, port availability, external services.
Run with --fix to auto-apply safe fixes (providers manifest, Prisma client, auth views).
```

## Phases

### Phase 1 — Contract + registry + orchestrator + reporter

`@rudderjs/cli` only. No package-side changes yet.

- `src/doctor/types.ts` — `DoctorCheck`, `DoctorResult` interfaces.
- `src/doctor/registry.ts` — global registry. `registerDoctorCheck()`, `getRegisteredChecks()`. Stored on `globalThis` symbol (per `feedback_static_state_singleton_audit` — survives Vite SSR re-eval). Idempotent registration by check id (last write wins, log a warn if collision).
- `src/doctor/orchestrator.ts` — collect checks, group by category, run in declared order, capture errors as red results. Concurrent execution within a category.
- `src/doctor/reporter.ts` — formatted output with status icons (`✓` / `⚠` / `✗`). Fix lines indented under failed checks. Summary footer with counts + timing. `--verbose` flag shows `detail`.
- `src/commands/doctor.ts` — `rudder.command('doctor', ...)` wiring. Argv: `--deep`, `--fix`, `--verbose`, `--json` (reserved, error in v1).
- Tests: registry idempotency, orchestrator handles thrown checks, reporter renders OK / WARN / ERROR / mixed.

**Exit criteria:** `rudder doctor` runs, reports "no checks registered yet" cleanly, exits 0. Tests green.

### Phase 2 — Built-in checks (cli-owned, skip-boot)

Add the env / structure / deps / manifest checks owned by `@rudderjs/cli` itself. These don't need to boot the app.

- `env:node-version` — read `package.json` `engines.node`, compare with `process.version`. semver match.
- `env:package-manager` — detect from `npm_config_user_agent` + presence of lockfiles. Warn if multiple lockfiles present (mixed PM).
- `env:dotenv-loadable` — `.env` exists + readable + parses.
- `env:app-key` — `APP_KEY` set + base64-decoded length is 32 bytes.
- `env:app-env` — `APP_ENV` is one of `local|dev|staging|production` (warn if other value).
- `structure:bootstrap-app` — `bootstrap/app.ts` exists + dynamic-imports without throwing (lexical parse only — no provider boot).
- `structure:bootstrap-providers` — `bootstrap/providers.ts` exists + exports default array.
- `structure:routes` — at least one of `routes/web.ts`, `routes/api.ts` exists.
- `structure:welcome-view` — `app/Views/Welcome.*` OR `pages/index/+Page.*` exists (depends on which mode the app is in).
- `deps:providers-manifest` — `bootstrap/cache/providers.json` exists + mtime newer than `package.json`. Warn if stale, error if missing.
- `deps:declared-installed` — every `@rudderjs/*` in `package.json` is resolvable from `node_modules`.
- `deps:auth-views` — if `@rudderjs/auth` installed AND app uses React/Vue/Solid, check `app/Views/Auth/` is populated.

Tests: golden-path scaffolded app passes all checks; intentionally-broken scaffolds surface the right failures.

**Exit criteria:** Running doctor on a fresh `create-rudder-app` scaffold prints all-green; running on `rm -rf app/Views/Auth` or `rm bootstrap/cache/providers.json` surfaces the right failure.

### Phase 3 — Package-contributed checks (skip-boot subset)

Wire the first wave of framework packages to contribute their own checks via a new `<package>/doctor` subpath export. Mirror the existing `<package>/commands/<name>` pattern documented in CLAUDE.md ("Package commands don't register in CLI").

CLI's doctor loader eagerly imports known subpaths at startup — same shape as `loadPackageCommands()`:

```ts
// packages/cli/src/doctor/load-package-checks.ts
const PACKAGES_WITH_CHECKS = [
  '@rudderjs/auth', '@rudderjs/session', '@rudderjs/hash',
  '@rudderjs/orm-prisma', '@rudderjs/orm-drizzle',
  '@rudderjs/cashier-paddle',
  '@rudderjs/queue', '@rudderjs/queue-bullmq', '@rudderjs/queue-inngest',
  '@rudderjs/broadcast', '@rudderjs/sync',
  '@rudderjs/ai', '@rudderjs/mcp',
  '@rudderjs/telescope', '@rudderjs/pulse', '@rudderjs/horizon',
]
```

Each contributing package exports a `doctor.ts` (or `<package>/doctor` subpath) that calls `registerDoctorCheck` for its rules. Concrete first-wave checks (per package):

- `auth` — AUTH_SECRET set, length sane; views vendored if a frontend is installed.
- `session` — SESSION_SECRET set, length sane.
- `hash` — APP_KEY length valid (already in env layer); verify hash algo string in config is recognized.
- `orm-prisma` — `prisma/schema/*.prisma` files present; generated `node_modules/.prisma/client` exists; client mtime > schema mtime; `DATABASE_URL` parseable.
- `orm-drizzle` — schema file present; `DATABASE_URL` parseable.
- `cashier-paddle` — `PADDLE_API_KEY` + `PADDLE_WEBHOOK_SECRET` set if any cashier route is mounted; `@paddle/paddle-node-sdk` resolvable if server-side calls referenced.
- `queue-bullmq` — `REDIS_URL` set (connect check moves to --deep).
- `queue-inngest` — `INNGEST_EVENT_KEY` set.
- `ai` — at least one provider API key set for the configured provider list.
- `mcp` — if `app/Mcp/` has tools, the mcp route is registered in `routes/api.ts`.
- `telescope` / `pulse` / `horizon` — if installed, the dashboard route is reachable from `routes/web.ts`.

Tests: per-package, scaffold + intentional break + assert.

**Exit criteria:** Doctor surfaces failures for each package's broken state. New package adding doctor checks needs only (a) a `doctor.ts` and (b) one line in `PACKAGES_WITH_CHECKS`.

### Phase 4 — Deep mode (`--deep`)

`rudder doctor --deep` boots the app once (catching boot errors as a check result, not a crash), then runs runtime checks.

- `runtime:app-boot` — wrap `bootApp()` in try/catch. If it throws, that's a single red check with the error message + fix pointing to the failing provider.
- `runtime:port-free` — net-server bind/release on `PORT` (default 3000). Report PID holding the port (via `lsof -ti :3000`).
- `runtime:db-connect` — ORM-specific: for Prisma, `$connect()` + 1 query; for Drizzle, equivalent.
- `runtime:redis-ping` — if `queue-bullmq` configured, ping Redis.
- `runtime:mail-smtp` — if `mail` configured to a real SMTP, TCP-connect (no send).
- `runtime:migration-drift` — `prisma migrate status` parsed; warn on pending migrations.

`needsBoot: true` on the check definition. Orchestrator skips these unless `--deep`.

Tests: stub the boot path, assert the orchestrator wraps a thrown boot as a check failure (doesn't crash doctor itself).

**Exit criteria:** `--deep` on a healthy app passes; on a broken-DB-URL app surfaces the connect error as a red check with the DSN (redacted) + fix.

### Phase 5 — Fix mode (`--fix`) — SHIPPED 2026-05-20

Conservative auto-fix. Only checks that explicitly declare a `fixer()` function are eligible.

```ts
export interface DoctorCheck {
  // ... existing fields
  fixer?: () => Promise<DoctorResult> | DoctorResult
}
```

First wave of fixers:

- `deps:providers-manifest` — regenerates `bootstrap/cache/providers.json` **in-process** by calling `@rudderjs/core/commands/providers-discover`'s `scanProviders` + `writeProviderManifest`. No shell-out.
- `orm-prisma:client-generated` — shells out `pnpm exec prisma generate`. Matches the existing `rudder db:generate` invocation pattern (hardcoded pnpm; same constraint applies).
- `auth:views-vendored` — copies `node_modules/@rudderjs/auth/views/<fw>/` → `app/Views/Auth/`. **Never overwrites** existing files (copy-once semantics so a user's in-progress edits are safe). Falls back to `react/` if the per-framework set isn't shipped yet.

`--fix` runs the fast-path checks first, prompts before applying each fixable issue (`--yes` to skip prompts), then re-runs the same checks to confirm. Never touches `.env`, `package.json`, or DB schema. A fixer that throws is captured as a red fix outcome — doctor itself never crashes.

Implementation lives in `packages/cli/src/doctor/fixer.ts` (`applyFixes()` + `FixOutcome` / `FixResult` types); the reporter renders a "Fixes" section between the first and second check pass.

**Exit criteria — met:**
- ✅ `--fix --yes` on a broken-manifest playground applies the fix and re-passes (verified end-to-end).
- ✅ No-eligible case ("everything green") renders "No fixable failures" cleanly.
- ✅ Skipped + thrown + happy-path tested in `packages/cli/src/doctor/fixer.test.ts`.

**Pre-existing check bug surfaced (out of scope for Phase 5):** `orm-prisma:client-generated`'s staleness detection reads `node_modules/@prisma/client/package.json` mtime. Prisma 7 + pnpm writes to `node_modules/.pnpm/@prisma+client@.../node_modules/@prisma/client` (the real pnpm location); the symlink target's mtime never moves. The fixer regenerates correctly; the staleness *check* needs follow-up.

### Phase 6 — Docs

- `docs/guide/doctor.md` — usage, all built-in checks, how to contribute a check (package author guide).
- `claude-notes/create-app.md` — short pointer in the "Common Pitfalls" section.
- README — one-line mention in the "What you get" list ("first-class diagnostics: `pnpm rudder doctor`").
- `create-rudder-app` welcome view — add a "Something broken? Try `pnpm rudder doctor`" link / note.
- CLAUDE.md — add `doctor` to the per-package `Commands` lists for packages that contribute checks.

### Phase 7 — Changeset + ship

- `@rudderjs/cli` — minor (new `doctor` command + new public API).
- Each first-wave package contributing checks — patch (added `doctor.ts` subpath).
- Single PR or staged? See **Out of scope** below.

## Risks

- **Green doctor on broken app is worse than no doctor.** Every check must earn its keep with a tight question: "would this fail *before* the underlying error did?" A check that returns ok when a dep is in `package.json` (without confirming it's loadable) is a regression — users will trust the signal and stop reading the actual error. Mitigation: every check has a paired "broken" test that confirms the check catches the failure.
- **Boot-time check explosion in --deep.** Booting the app to run runtime checks means provider crashes surface inside doctor. Mitigation: wrap `bootApp()` in try/catch + report the boot error as a single red check; never crash doctor itself. The boot error message itself becomes the primary triage signal.
- **Manifest staleness false positive.** `bootstrap/cache/providers.json` is gitignored — on a fresh clone it's missing but not "broken." Doctor should surface this as a yellow warning with the fix command, not a red error. The `--fix` path makes it a one-keystroke recovery.
- **Maintenance drift.** 30+ checks across 15+ packages = surface area to keep accurate. Mitigate by colocating each check with the package it covers (no central god-file), and by having an integration test per recipe that runs doctor on the scaffolded output (must be all-green).
- **Output noise.** If every check shows even when ok, the screen fills. Default: summary mode shows category headers + failed checks + counts; passing checks render as a single "12 ok" line per category. `--verbose` expands.
- **Fix mode footguns.** A user could run `--fix --yes` and overwrite an in-progress edit (e.g. partial Prisma schema). Mitigation: fixers run **idempotent regenerate-style operations** only. Never delete, never rewrite user-authored files.
- **Registry collisions.** Two packages registering the same `id`. Mitigation: last write wins + log a warning; convention forces `<package>:<check>` naming so collisions are unlikely.

## Out of scope / follow-up

- **JSON output mode** (`--json`) for CI integration. Plan after v1 shapes settle.
- **Watch mode** (`--watch`) — re-run doctor on filesystem change. Better as a dev-server integration than a separate flag.
- **Web dashboard** (telescope-style live doctor view). Possible later if pulse / horizon parity calls for it.
- **User-app custom checks beyond AppServiceProvider.** A `checks/` directory convention (auto-loaded by doctor like `commands/` is for `rudder.command()`). Defer until the public API has bedded in.
- **Vue / Solid auth-view checks.** Phase 3 covers React (since that's the only framework with vendored auth views today). Vue / Solid land when those views ship.
- **Per-recipe baseline expectations.** A check that knows "this is an `api-service` recipe, frontend shouldn't be there" — needs a recipe-detection heuristic that doesn't exist yet.
- **Staged PRs vs single PR.** Phases 1-2 are tightly coupled (the contract + the built-in checks land together). Phases 3 onwards can each be a separate PR if the diff gets large.
