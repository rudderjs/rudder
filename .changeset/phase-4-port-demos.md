---
"create-rudder-app": minor
---

feat: port 5 playground demos into the scaffolder + drop cashier-paddle (Phase 4)

The "Select demos" prompt now offers 8 demos, gated on the relevant
Phase-2 packages:

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

**Removed `@rudderjs/cashier-paddle` from the scaffolder.** It was wired
in Phase 2 as a dep + config + env keys, but with no demo to back it
the scaffolded project shipped a "ghost" — `config/cashier.ts` was
generated but no controllers ever imported it, so the package just sat
in `node_modules` until the user manually wired it. Cashier requires a
Paddle vendor account, webhook URL, product IDs, and sandbox/prod
toggles that the scaffolder cannot meaningfully simulate, so a built-in
demo would either fail on first click or balloon the README. Users who
want billing should `pnpm add @rudderjs/cashier-paddle` post-scaffold
and follow that package's own setup — same path as `@rudderjs/queue`
drivers and other "needs external service" packages.

Removed surface area: `cashierPaddle` package key, `config/cashier.ts`
template, `PADDLE_*` env keys, `@rudderjs/cashier-paddle` dep wiring,
"Cashier-Paddle" multiselect row, and the "auth, sanctum, passport,
billing" → "auth, sanctum, passport" log message when ORM=none.

Smoke profiles added: `--profile=todos` (single-demo lane) and
`--profile=demos-all` (every Phase-4 demo at once). Both pass full boot.
