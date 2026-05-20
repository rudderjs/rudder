---
'@rudderjs/console': minor
'@rudderjs/cli':     minor
---

Add `rudder doctor` — a diagnostic command that pre-flights common setup
failures in a RudderJS app and reports them with paste-able fix instructions.

**Why this exists:** when something breaks in a scaffolded app, the user
typically sees a stack trace 8 frames deep into vike / hono / `@rudderjs/core`
with nowhere to triage. `rudder doctor` flips that — one shell-out, every
common setup failure gets a green / yellow / red icon + a one-line fix.

**Phase 1 + 2 ship in this release.** Phase 3 (package-contributed checks)
and Phase 4 (`--deep` runtime checks) and Phase 5 (`--fix` auto-recovery)
follow in subsequent releases.

What's new:

- `@rudderjs/console`: new public API for package authors —
  `registerDoctorCheck()`, `getRegisteredChecks()`, `DoctorCheck` /
  `DoctorResult` / `DoctorStatus` types, plus a `DoctorRegistry` class.
  Singleton on `globalThis` so it survives Vite SSR module re-eval, with
  last-writer-wins semantics for duplicate ids (matches `rudder.command()`).

- `@rudderjs/cli`: new `rudder doctor` command with 12 built-in CLI-owned
  checks across three categories:

  - **env** (5) — `env:node-version` (semver vs `engines.node`),
    `env:package-manager` (lockfile + user-agent mismatch),
    `env:dotenv-loadable`, `env:app-key` (length validated, both raw and
    base64), `env:app-env` (recognized values).

  - **structure** (4) — `structure:bootstrap-app`,
    `structure:bootstrap-providers`, `structure:routes`,
    `structure:welcome-view`.

  - **deps** (3) — `deps:providers-manifest` (mtime vs `package.json`),
    `deps:declared-installed` (every `@rudderjs/*` resolvable from
    `node_modules`), `deps:auth-views` (vendored when a frontend
    renderer is installed alongside `@rudderjs/auth`).

  Reporter renders icons + per-check `fix:` lines + footer counts and
  timing. Exit code is `1` if any check is `error`, else `0`. Flags:
  `--verbose` (show `detail` blocks under passing checks too) and
  `--only <substring>` (run a subset by id). `--deep` / `--fix` / `--json`
  are reserved with a clear "not implemented yet" message — they land in
  subsequent phases.

Tests: 23 new tests across registry, orchestrator, reporter, and a
temp-dir integration suite that covers golden-path scaffold + 10
broken-state scenarios.

Public API stability: `DoctorCheck` / `DoctorResult` / `registerDoctorCheck`
are stable. The `--json` flag is intentionally reserved (currently errors
with exit code 2) so the future machine-readable output can land without
churn.
