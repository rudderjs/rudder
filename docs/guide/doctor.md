# Rudder Doctor

`pnpm rudder doctor` pre-flights every layer of a Rudder app — environment, app structure, dependencies, ORM, runtime — and reports green / yellow / red with a paste-able fix line for each failure.

```bash
pnpm rudder doctor
```

```
Rudder Doctor

env
  ✓ Node version             v22.14.0 (matches >=22.12.0)
  ✓ Package manager          pnpm 11.5.3 — lockfile present
  ✓ APP_KEY                  set, 32 bytes
  ✗ AUTH_SECRET              missing
     fix: Add AUTH_SECRET to .env (any random string ≥ 32 chars)

deps
  ⚠ providers manifest        12 days old — schema may have drifted
     fix: pnpm rudder providers:discover

orm
  ✗ Prisma client             out of date — schema modified 2h ago, client 12d ago
     fix: pnpm rudder db:generate

37 checks · 33 ok · 1 warn · 3 errors · 4ms
```

Exit code is `0` when no checks are red. Warnings don't block the exit code — they're noted but the command still passes. Use it in CI, in `predev` hooks, or as the first thing you run when a scaffolded app misbehaves.

## Flags

| Flag | Purpose |
|---|---|
| `--deep` | Boot the app once and run runtime checks (DB connect, port, SMTP, Redis ping, migration drift). |
| `--fix` | Auto-apply safe fixes for any failure whose check declares a `fixer()`. Prompts before each fix. |
| `--yes` | Skip prompts under `--fix`. |
| `--verbose` | Show the `detail` block on every check (default: only failures). |
| `--only <substring>` | Run only checks whose id or category contains the substring (e.g. `--only orm`, `--only auth:secret`). |

```bash
pnpm rudder doctor --deep                  # all checks
pnpm rudder doctor --fix --yes             # apply every safe fix, no prompts
pnpm rudder doctor --only env              # just the env section
pnpm rudder doctor --only orm-prisma       # just the Prisma checks
```

## `--deep` — runtime checks

The default fast path runs everything that can be answered from the filesystem and `process.env`. `--deep` boots the app — same boot sequence as `pnpm dev` — and then asks each runtime check to talk to its dependency:

- Database connect (Prisma `$connect()` + `SELECT 1`).
- Migration drift (`prisma migrate status` parsed).
- Port availability (bind-and-release on `PORT`, default 3000).
- Redis ping (when `@rudderjs/queue-bullmq` is installed).
- SMTP TCP-connect (when `@rudderjs/mail` configured for a real SMTP).
- App boot itself — if boot throws, the failing provider is shown as a single red check rather than crashing doctor.

Boot is expensive (~1–2s). Save `--deep` for "the app won't start" — the fast path catches most setup failures without it.

## `--production` — pre-deploy readiness

```bash
pnpm rudder doctor --production
```

Adds a `production` category of strict invariants that would false-fire in local dev — meant to run on a production-shaped environment (the deploy server, or a CI step right before deploy). Each check has a clear fix hint with the exact env-var change required.

| Check | What it enforces |
|---|---|
| `production:app-debug` | `APP_DEBUG` must NOT be `true`/`1` — debug mode leaks stack traces + `dump()` output to clients |
| `production:app-env` | `APP_ENV` should equal `production` |
| `production:app-url` | `APP_URL` must start with `https://` — auth cookies + CSP rely on it |
| `production:database-url` | `DATABASE_URL` must NOT be SQLite (`file:...`) or point at `localhost`/`127.0.0.1`/`0.0.0.0`. Credentials are redacted in the report. |
| `production:rudder-pinning` | No `@rudderjs/*` deps on floating ranges (`latest`, `*`, `next`) — deploys shouldn't ride dist-tag movement |
| `production:workspace-refs` | No `workspace:*` refs in `package.json` — only resolvable inside the monorepo |
| `production:dist-exists` | `dist/` (the build output) must exist |
| `production:providers-manifest` | `bootstrap/cache/providers.json` must exist — auto-discovery's source of truth |

Combine with `--deep` for the full pre-deploy gate: `pnpm rudder doctor --deep --production`.

## `--fix` — conservative auto-fix

`--fix` runs the fast-path checks first, then for every failing check whose definition declares a `fixer()` it prompts:

```
$ pnpm rudder doctor --fix
…
deps
  ⚠ providers manifest        missing — providers won't auto-discover

◇  Apply fix for providers manifest? (missing — providers won't auto-discover)
│  ● Yes / ○ No
```

After fixers run, doctor re-checks and prints a second pass so you don't have to eyeball whether the fix landed:

```
Fixes
  ⚠ → ✓ providers manifest   regenerated (23 providers)
1 fixable · 1 fixed · 0 failed · 0 skipped

Rudder Doctor
deps
  ✓ providers manifest   present and current
```

Fixers are **idempotent regenerate-style operations only**. Doctor will never:

- Edit `.env` or `package.json`.
- Touch your DB schema or run migrations.
- Overwrite a file you authored.

Shipped fixers:

| Check | Fix |
|---|---|
| `deps:providers-manifest` | Regenerates `bootstrap/cache/providers.json` (same as `rudder providers:discover`). |
| `orm-prisma:client-generated` | Runs `pnpm exec prisma generate`. |
| `auth:views-vendored` | Copies `node_modules/@rudderjs/auth/views/<fw>/` to `app/Views/Auth/` — skips files that already exist. |

A fixer that throws is reported as a red fix outcome; doctor itself never crashes.

## Built-in checks

`@rudderjs/cli` ships these regardless of which framework packages are installed.

### `env`

| Check | What it asserts |
|---|---|
| `env:node-version` | `process.version` matches the `engines.node` declared in `package.json`. |
| `env:package-manager` | A single lockfile exists (`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `bun.lockb`). Warns if multiple lockfiles are present. |
| `env:dotenv-loadable` | `.env` exists and parses. |
| `env:app-key` | `APP_KEY` is set and base64-decodes to 32 bytes. |
| `env:app-env` | `APP_ENV` is one of `local` / `dev` / `staging` / `production`. |

### `structure`

| Check | What it asserts |
|---|---|
| `structure:bootstrap-app` | `bootstrap/app.ts` exists and lexically parses. |
| `structure:bootstrap-providers` | `bootstrap/providers.ts` exists and has a default export. |
| `structure:routes` | At least one of `routes/web.ts`, `routes/api.ts`, `routes/console.ts` exists. |
| `structure:rudder-types-tsconfig` | When `.rudder/types/` exists, the `tsconfig.json` `include` array covers it with the glob form (`".rudder/**/*"` — dot-directories are invisible to `**/*` globs and to bare-directory entries). Without it, typed `view()` / `route()` / `Model.for<>()` silently stop resolving. |
| `structure:welcome-view` | `app/Views/Welcome.*` (or a `pages/index/+Page.*` for file-based routing) is present. |

### `deps`

| Check | What it asserts |
|---|---|
| `deps:providers-manifest` | `bootstrap/cache/providers.json` exists and is newer than `package.json`. _Has fixer._ |
| `deps:declared-installed` | Every `@rudderjs/*` in `package.json` resolves from `node_modules/`. |
| `deps:version-skew` | Every installed `@rudderjs/*` package's declared ranges on sibling `@rudderjs/*` packages are satisfied by the versions that actually resolve. Catches exact `pnpm.overrides` pins that fall below a sibling's floor — the failure otherwise surfaces at runtime as a bare ESM link error (`does not provide an export named '…'`) naming no package and no version. |

### `runtime` (only under `--deep`)

| Check | What it asserts |
|---|---|
| `runtime:app-boot` | The app boots without throwing. If it throws, the error is shown verbatim with the failing provider. |
| `runtime:port-free` | Binds + releases `PORT` (default `3000`). Reports the PID holding the port on failure. |

## Package-contributed checks

Each `@rudderjs/*` package that ships a `doctor.ts` registers its own checks at doctor-startup time.

| Package | Checks |
|---|---|
| `@rudderjs/auth` | `auth:secret` (`AUTH_SECRET` length); `auth:views-vendored` (`app/Views/Auth/` populated when a vike-* renderer is installed). _Has fixer._ |
| `@rudderjs/session` | `session:secret` (`SESSION_SECRET` set — soft-passes if absent, since sessions fall back to `APP_KEY`). |
| `@rudderjs/hash` | `hash:driver` (configured hash algo is recognised). |
| `@rudderjs/orm-prisma` | `orm-prisma:schema`, `orm-prisma:client-generated` (mtime sanity), `orm-prisma:database-url`. Under `--deep`: `orm-prisma:db-connect`, `orm-prisma:migration-drift`. _Client-generated has fixer._ |
| `@rudderjs/orm-drizzle` | `orm-drizzle:schema`, `orm-drizzle:database-url`. |
| `@rudderjs/cashier-paddle` | `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`. |
| `@rudderjs/queue-bullmq` | `queue-bullmq:redis-url`. Under `--deep`: `queue-bullmq:redis-ping`. |
| `@rudderjs/queue-inngest` | `queue-inngest:event-key`, `queue-inngest:signing-key`. |
| `@rudderjs/orm` | Under `--deep`: `orm-native:db-connect` (native engine connectivity). |
| `@rudderjs/broadcast-redis` | `broadcast-redis:url`. Under `--deep`: `broadcast-redis:connectivity`. |
| `@rudderjs/mail` | Under `--deep`: `mail:smtp-connect`. |
| `@rudderjs/ai` | `ai:provider-keys` (at least one key set for the providers listed in `config/ai.ts`). |
| `@rudderjs/mcp` | `mcp:route-mounted` (warns if `app/Mcp/` has tools but no MCP route is registered). |
| `@rudderjs/telescope` / `@rudderjs/pulse` / `@rudderjs/horizon` | `{telescope,pulse,horizon}:dashboard` — warns if the package is installed but its dashboard route isn't registered. |

The exact set of checks depends on which `@rudderjs/*` packages are installed — each package's `doctor.ts` registers its own at startup.

## Contributing a check

Doctor uses the same plug-in shape as `rudder.command()`. A package contributes a check by exporting a `doctor.ts` subpath whose side-effect import calls `registerDoctorCheck()` for its rules.

```ts
// packages/<my-package>/src/doctor.ts
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

registerDoctorCheck({
  id:       'my-package:api-key',
  category: 'auth',
  title:    'MY_API_KEY',
  run(): DoctorResult {
    const v = process.env['MY_API_KEY']
    if (!v) return {
      status:  'error',
      message: 'unset',
      fix:     'Add MY_API_KEY to .env (https://my-service.com/dashboard/api)',
    }
    if (v.length < 32) return {
      status:  'warn',
      message: `set but only ${v.length} chars — recommend ≥ 32`,
    }
    return { status: 'ok', message: `set, ${v.length} chars` }
  },
})
```

Wire it into the CLI's loader list and `package.json` exports:

```ts
// packages/cli/src/doctor/load-package-checks.ts
const PACKAGES_WITH_CHECKS: string[] = [
  // ...
  '@rudderjs/my-package',
]
```

```json
// packages/<my-package>/package.json
{
  "exports": {
    ".":        { "import": "./dist/index.js"  },
    "./doctor": { "import": "./dist/doctor.js" }
  }
}
```

The CLI's loader walks `node_modules/@rudderjs/<pkg>/dist/doctor.js` directly — no `import('<pkg>/doctor')` machinery to worry about. Packages not installed in the user's app are silently skipped.

### The check shape

```ts
interface DoctorCheck {
  id:        string                                 // e.g. 'my-package:api-key'
  category:  string                                 // group label for the report
  title:     string                                 // shown next to the status icon
  needsBoot?: boolean                               // true → only runs under --deep
  run():      DoctorResult | Promise<DoctorResult>
  fixer?:    () => DoctorResult | Promise<DoctorResult>
}

interface DoctorResult {
  status:  'ok' | 'warn' | 'error'
  message: string                                   // one-line summary
  fix?:    string                                   // paste-able shell command
  detail?: string                                   // shown with --verbose
}
```

Conventions:

- **`id`** is `<package>:<rule>` — `cashier-paddle:webhook-secret`, `orm-prisma:db-connect`. The prefix lets `--only <pkg>` narrow to one package.
- **`fix`** is what the user types into their shell. Make it a real command when you can: `pnpm rudder providers:discover` beats "regenerate the manifest."
- **`detail`** is multi-line context (`prisma migrate status` output, the parsed DSN with password redacted, etc.). Default-hidden so the report stays scannable.
- **`needsBoot: true`** is for anything that talks to a live service (DB, Redis, SMTP, message broker) or needs the DI container.
- **`fixer()`** is optional and **must be idempotent**. Re-running it when the check is already green is a no-op. Never edit `.env`, `package.json`, or user-authored files. Throwing a fixer is captured and reported as a red fix outcome — it never crashes doctor.

### Adding a fixer

```ts
registerDoctorCheck({
  id:    'my-package:cache-dir',
  // ... run() as before
  fixer(): DoctorResult {
    fs.mkdirSync(path.join(process.cwd(), '.my-cache'), { recursive: true })
    return { status: 'ok', message: 'created .my-cache/' }
  },
})
```

Doctor will pick it up automatically — `--fix` discovers fixers from the registered checks.

## When to run doctor

- **After scaffolding** — `pnpm create rudder` runs `providers:discover` for you, but the rest of the green/yellow/red picture is one command away.
- **After `pnpm rudder add <pkg>`** — confirm the new package's checks all pass.
- **In CI** — fast path is sub-second on a built tree; runs without booting anything.
- **When something breaks** — green doctor isn't a guarantee, but a red doctor is the answer in 90 % of "the app won't start" cases.

## See also: `rudder about`

Doctor tells you *what's broken*. `rudder about` prints a one-screen snapshot of *what you're running on* — useful for bug reports, shared context with teammates, and feeding to an LLM that's helping you debug:

```bash
pnpm rudder about
```

```
Environment
  App Name ................................................. my-app
  Framework ........................................ @rudderjs/core 1.5.1
  CLI ............................................... @rudderjs/cli 4.7.1
  Node ......................................................... v22.14.0
  Package Manager .................................................. pnpm
  OS .............................................. Darwin 25.1.0 (arm64)
  APP_ENV ....................................................... local
  APP_DEBUG ..................................................... true
  APP_URL ............................................. http://localhost:3000

Installed @rudderjs/* packages (11)
  @rudderjs/cli         ........................................... 4.7.1
  @rudderjs/core        ........................................... 1.5.1
  @rudderjs/router      ........................................... 1.7.1
  ...
```

Pass `--json` for a machine-readable snapshot — ideal for bug-report attachments and LLM context.

Like `doctor`, `about` skips the app boot — it's fast (under 50ms) and works even when the app can't boot.

## Pitfalls

- **Doctor doesn't replace error messages.** A red doctor names the layer; you still need the stack trace for app-code bugs. `--deep`'s `runtime:app-boot` shows the boot error verbatim — that's the primary debugging signal, not the doctor.
- **`bootstrap/cache/providers.json` is gitignored.** On a fresh clone, `deps:providers-manifest` may warn "missing" if the app has never booted. Harmless — the first boot self-heals it (and `--fix --yes` or `pnpm rudder providers:discover` regenerate it explicitly).
- **Stale-mtime checks can lag.** Some checks (notably `orm-prisma:client-generated`) compare mtimes; under pnpm + Prisma 7, the symlink target's mtime doesn't move when the client is regenerated. A future release will switch to a content hash.
- **`--fix` over a broken `.env`.** Fixers never touch `.env`, so `--fix` won't help with "missing AUTH_SECRET." Add the env var, then re-run.
