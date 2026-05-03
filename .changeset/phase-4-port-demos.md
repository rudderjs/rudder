---
"create-rudder-app": minor
---

feat: port 5 playground demos into the scaffolder (Phase 4)

The "Select demos" prompt now offers 8 demos, gated on relevant Phase-2
packages:

- **Todos** (requires ORM) — full CRUD via a self-contained
  `app/Modules/Todo/` (TodoSchema/TodoService/TodoServiceProvider) +
  Prisma `Todo` model in `prisma/schema/modules.prisma`.
  AppServiceProvider's `boot()` registers the module dynamically.
- **Avatar resize** (requires Storage + Image) — file upload + 256×256
  WebP via `@rudderjs/image`, persisted to the `public` Storage disk so
  the URL is browser-reachable.
- **Worker threads / Fibonacci** (requires Concurrency) — sequential vs
  `Concurrency.run([...])` parallel cost comparison.
- **System info** (requires Process) — `git rev-parse HEAD`,
  `node --version`, `uptime` via `Process.run()` and `Process.pool()`.
- **Feature flags / Pennant** (requires Pennant + Auth) — four feature
  shapes (boolean, value, scoped, lottery); `/demos/pennant/beta`
  guarded by `FeatureMiddleware('beta-dashboard')` to demo the 403 path.
  AppServiceProvider seeds the four definitions.

The cascade-aware prompt (Phase 2) handles every gate: Todos hidden when
ORM=none, Avatar hidden without Storage+Image, etc. AppServiceProvider's
boot() switches to `async` only when at least one demo needs dynamic
provider registration or feature seeding.

Smoke profiles added: `--profile=todos` (single-demo lane) and
`--profile=demos-all` (every Phase-4 demo at once). Both pass full boot.

Billing demo (cashier-paddle webhook + checkout flow) deferred to a
follow-up — it needs its own Prisma migration and webhook controller and
shouldn't share a PR with the simpler view+API ports.
