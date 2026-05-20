# DX completion — 4-phase roadmap

**Status:** plan, 2026-05-20. Decisions locked.
**Origin:** session 2026-05-20 — surveyed the existing DX surface (factories, mail preview, `Http::fake()`, `Storage::fake()`, Ignition-style error page, doctor, typed routes) and identified four real gaps that line up as Laravel-parity DX wins. Each phase is self-contained and ships as its own PR. Pattern follows the doctor roadmap.

## Locked design decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **`RUDDERJS_TINKER=1` env-var sentinel** (not a `boot({ mode })` core API) | Boot path is mostly passive (Prisma client + BullMQ Queue/Worker construction is lazy; network listeners only fire from `app.listen()`/`app.serve()`). Real conflict surface is narrow — horizon's WorkerCollector, anything polling in `boot()`. Framework already uses this idiom (`RUDDERJS_QUEUE_WORKER=1` set by cli, checked by horizon). Adding `RUDDERJS_TINKER=1` matches the existing pattern; zero new core API. |
| 2 | **Phase 3: hand-augmentation only** (no scanner-emit) | Per `feedback_template_literals_over_scanner_codegen`. URL generator needs a `name → path` registry (TS can't infer that natively), but the *population* is the question. Hand-augmentation in `env.d.ts` ships in 1 PR; scanner-emit is its own 3-phase project (vite plugin, dynamic-route edge cases, sync command). Get the types into users' hands first; revisit scanner-emit if usage signals demand it. |
| 3 | **`APP_EDITOR=vscode` (default)** for Phase 2 | Fits the `APP_*` family (`APP_KEY` / `APP_ENV` / `APP_NAME`). Editor preference is app-config (per-developer setting that lives with the app), not framework-runtime (`RUDDERJS_*`) and not log driver (`LOG_*`). Don't read the Unix `EDITOR` env var — users have it set to `vim`/`nano`, neither speaks URL schemes. |

---

## Why this exists

Three signals make this the right next bet:

1. **Doctor + typed-routes both landed.** The framework is past the "ship correctness" phase and into the "shave dev-loop friction" phase. Each remaining gap below is a moment where a Laravel/Rails dev coming from those frameworks asks "wait, why isn't this here?"
2. **No real-world user signal beyond Pilotiq.** Until more apps are in flight, the highest-leverage moves are the ones that make the *first hour* and the *first debugging session* dramatically nicer. That's tinker and editor-launch.
3. **The typed-routes work is half-finished.** #482 + #564 typed `req.params` / `req.query` / `req.body`. The URL generator `route('users.show', { id: 1 })` is still untyped. Capping that story is now a small additive PR — defer it and the inconsistency sits in the surface forever.

## Goals

- **One command, one DX win per phase.** Each phase ships independently. No phase blocks any other except by review bandwidth.
- **Laravel parity, RudderJS ergonomics.** Match the Laravel verb (`artisan tinker` → `rudder tinker`) where it's load-bearing; reshape where Laravel's PHP-specific design doesn't translate (no Symfony console wrappers, no Tinker class).
- **Zero new runtime cost.** Phases 3 + 4 are pure type-system / scaffolder additions. Phases 1 + 2 add new commands / dev-mode behaviors but don't touch the request-time hot path.
- **No new public API surface that we can't keep.** Each phase's public API gets reviewed at the design-doc level before implementation lands. Don't ship something we'll need to break.

## Non-goals

- **Not a replacement for telescope.** Telescope is the runtime observability surface; this roadmap is about the *write-and-debug* loop.
- **Not a UI / view-layer overhaul.** No `useForm()` helper, no Inertia-style form-state bridge, no view package changes. Those are bigger product decisions, separate roadmap.
- **Not a redesign of `@rudderjs/testing`.** Factories already exist; the scaffolder gap is the only piece in scope.
- **Not new error-page features beyond editor-launch.** Copy-as-MD and the Ignition restoration line are done.

---

## Phase 1 — `rudder tinker` REPL

`pnpm rudder tinker` boots the app and drops into a Node REPL with the DI container, ORM models, route helpers, and event bus pre-imported. Killer Laravel-parity feature — every Laravel/Rails dev reaches for `php artisan tinker` first when they need to interactively probe state. RudderJS doesn't have it today.

### Surface

```bash
$ pnpm rudder tinker
RudderJS Tinker — node v22.14.0, env=local

> await User.count()
3

> const u = await User.where('email', 'like', '%@example.com').first()
> u.name
'Alice'

> u.posts().count()
5

> Route.get('/health')
[Route { method: 'GET', path: '/health', ... }]

> .help
.exit       — quit
.clear      — reset the context
.help       — this
.boot       — re-boot the app (after schema/code change)
```

### Design

- **Owned by `@rudderjs/cli`.** New file `src/commands/tinker.ts`. Skip-boot is **off** — tinker needs the full app booted (DI container, providers, route loaders).
- **Pre-imported globals** are populated on the REPL context after boot:
  - `app()` — DI container accessor
  - `Route` — the global Route alias
  - `rudder` — the CLI command registry (so the user can register an ad-hoc command and run it)
  - Every Model class found in `app/Models/*` — discovered by walking the directory, dynamic-import, register by class name on the REPL.
  - `Storage`, `Cache`, `Queue`, `Mail` facades when their providers are booted.
- **`.boot` meta-command** — re-runs `bootApp()` to pick up code/schema changes without leaving the REPL.
- **History persistence** — `~/.rudder-tinker-history` (Node's REPL supports `historyFile` out of the box).
- **Top-level await** — Node's REPL has supported top-level await since 16; enable via `replServer.context` setup. Critical because every meaningful query is async.
- **Pretty-print** — Models render with their public columns via a custom `inspect()` symbol; ORM query builders render as their compiled SQL (debug-friendly).

### Risks

- **Provider boot side effects.** Tinker boots the same app that `pnpm dev` boots. That includes session middleware, queue connections, etc. Need to short-circuit anything that opens a network connection by default. **Mitigation:** tinker sets `APP_ENV=tinker` (or honors a `TINKER=1` env flag) and providers like queue / mail / session check for it before starting workers. Or: tinker just doesn't call `app.start()`, only `app.boot()` — providers register but don't open listeners.
- **Model discovery is fragile.** Walking `app/Models/*` and dynamic-importing breaks if a model file has a syntax error. **Mitigation:** wrap each import in try/catch + warn; don't crash the REPL on a single bad model.
- **Memory leaks across `.boot` calls.** Re-booting the app produces fresh provider instances; old listeners may linger. **Mitigation:** Phase 1 doesn't claim to be leak-free across `.boot` — the meta-command is best-effort. Document this.

### Exit criteria

- `pnpm rudder tinker` from playground prints the welcome banner, accepts top-level await, exposes `User`, runs a query, exits cleanly on `.exit` / Ctrl-D.
- Tests: REPL bootstrap is unit-testable by importing the setup function and asserting the context shape. Don't test the actual REPL loop.

---

## Phase 2 — Editor-launch on error-page stack frames

The Ignition-style error page already renders parsed stack frames. Today they're plain text. Phase 2 wraps each frame's file:line in a clickable link that opens the user's editor via the platform's `vscode://` / `cursor://` / `idea://` URL scheme. Matches Laravel Ignition's `?editor=phpstorm` parameter.

### Surface

- Click any non-vendor frame on the dev error page → editor jumps to `file:line`.
- Configurable via `LOG_EDITOR=vscode|cursor|webstorm|phpstorm|sublime|atom|none` in `.env` (defaults to `vscode`; `none` disables the wrapping).
- Vendor frames (`node_modules/*`) stay un-linked by default — they're rarely what the user wants to open.

### Design

- **Owned by `@rudderjs/server-hono`** (where the error page lives — `src/error-page.ts`).
- **Editor URL scheme table** — hardcoded map of editor name → URL template:
  ```ts
  const EDITORS = {
    vscode:    (f, l) => `vscode://file/${f}:${l}`,
    cursor:    (f, l) => `cursor://file/${f}:${l}`,
    webstorm:  (f, l) => `webstorm://open?file=${f}&line=${l}`,
    phpstorm:  (f, l) => `phpstorm://open?file=${f}&line=${l}`,
    sublime:   (f, l) => `subl://open?url=file://${f}&line=${l}`,
    atom:      (f, l) => `atom://core/open/file?filename=${f}&line=${l}`,
  }
  ```
- **Path absolutization** — frame `file` is whatever the JS engine reports. macOS/Linux paths are absolute; Windows needs the path forward-slashed (`C:/Users/...`). Tested per-OS.
- **Opt-out** — `LOG_EDITOR=none` renders frames as plain text (matches today's behavior).

### Risks

- **Wrong editor opens.** User has VS Code and Cursor both installed; macOS resolves the URL scheme based on most-recently-installed. **Mitigation:** explicit `LOG_EDITOR` env var; default is `vscode`; doc this.
- **Path scheme on Windows.** `file://` URLs on Windows need `///` after the scheme and forward-slashed drive letters. **Mitigation:** dedicated `toFileUrl(path)` helper, tested against fixture Windows-shaped paths.
- **Click handler in production.** Error page only renders in `APP_ENV=local|dev`. Editor links never reach production. **Defensive check:** the page already gates on debug mode before rendering frames at all; this rides on that.

### Exit criteria

- In playground, trigger an error → error page shows clickable frames → clicking opens VS Code at the right line.
- Tests: unit test the URL builder for each editor + fixture stack frame; integration test in error-page.test.ts that the rendered HTML contains the expected `<a href="vscode://...">` wrappers.

---

## Phase 3 — Typed `route()` URL generator

The URL generator `route('users.show', { id: 1 })` is currently `(name: string, params?: Record<string, unknown>) => string` — zero type-safety on the params arg. With path params now type-extractable (the work behind #482), we can type-check the params arg against the named route's path at compile time.

### Surface

```ts
// routes/web.ts
Route.get('/users/:id', userController.show).name('users.show')
Route.get('/posts/:slug/comments/:cid', commentController.show).name('comments.show')

// anywhere
route('users.show', { id: 1 })                    // ✓
route('users.show', { id: 1, extra: 'oops' })     // ✓ (extras allowed for query string)
route('users.show', {})                           // ✗ TS error: missing 'id'
route('comments.show', { slug: 'x' })             // ✗ TS error: missing 'cid'
route('users.shwo', { id: 1 })                    // ✗ TS error: unknown route name 'users.shwo'
```

### Design

- **Owned by `@rudderjs/router`**, plus a small `@rudderjs/contracts` augmentation.
- **Module augmentation registry** — declare a global `RouteRegistry` interface that users (or the scanner) populate with `name → path` literal entries:
  ```ts
  // Auto-augmented by the route loader at dev time (or user-declared)
  declare module '@rudderjs/router' {
    interface RouteRegistry {
      'users.show':     '/users/:id'
      'comments.show':  '/posts/:slug/comments/:cid'
    }
  }
  ```
- **`route()` becomes generic** over the registry:
  ```ts
  type RouteNames = keyof RouteRegistry
  type PathFor<N extends RouteNames> = RouteRegistry[N]

  function route<N extends RouteNames>(
    name:   N,
    params: ExtractParams<PathFor<N>>,
    extras?: Record<string, unknown>,
  ): string
  ```
  `ExtractParams<P>` already exists from #482 — reused unchanged.
- **Population strategy** — two paths, both supported:
  1. **Hand-augmentation** in `env.d.ts` (or any `*.d.ts` in the app). Cheap, opt-in, no codegen.
  2. **Scanner-emitted** — `@rudderjs/vite`'s view scanner already emits `pages/__view/registry.d.ts` (typed `view()` registry). Same pattern: walk the route loaders at dev time, emit `pages/__route/registry.d.ts` with the augmentation.
- **Backward compat** — `RouteRegistry` defaults to an empty interface. If the user hasn't augmented it, `RouteNames = never` and the generic falls back to `string` (today's behavior). Zero-config keeps working; opt-in gets the types.

### Risks

- **Recursion depth in `ExtractParams`.** Already proven against 4-segment paths in #482; should hold for the URL-generator use case too. Documented limit ~50 params.
- **Scanner emit ordering vs typecheck.** If the user runs `tsc` before the dev server has populated `pages/__route/registry.d.ts`, type-checking sees the empty registry. **Mitigation:** add a `pnpm rudder route:sync` command (parallel to `view:sync`) that emits the registry from a cold start. Wire it into CI / pre-commit per project preference. Matches the `view:sync` story.
- **Decorator-based controllers can't contribute to the registry today** — same limitation called out in the typed-routes guide for `:param` inference. Decorator routes still work at runtime, just don't get into the type registry. Document the gap, no Phase 3 fix.

### Exit criteria

- Hand-augmenting `RouteRegistry` in `env.d.ts` makes `route()` calls type-check.
- The scanner-emitted path also populates the registry (alternative to hand-augmentation).
- Tests: type-only assertions in `typed-routes.test-d.ts` covering positive + `@ts-expect-error` negatives for missing params, unknown route names, extra params.

---

## Phase 4 — `make:factory` + `make:seeder` scaffolders

The runtime factory + seeder primitives both exist (`@rudderjs/orm/factory.ts`). What's missing is a one-liner `rudder make:factory User` / `make:seeder Users` to drop a stub file. Users hand-write the boilerplate today; first-day question is "why isn't there a generator for these?"

### Surface

```bash
$ pnpm rudder make:factory User
✓ Created app/Factories/UserFactory.ts

$ pnpm rudder make:seeder Users
✓ Created database/seeders/UsersSeeder.ts
```

Generated files mirror the existing factory + seeder patterns:

```ts
// app/Factories/UserFactory.ts (stub)
import { Factory } from '@rudderjs/orm/factory'
import { User } from 'App/Models/User.js'

export const UserFactory = Factory.define(User, (faker) => ({
  name:  faker.person.fullName(),
  email: faker.internet.email(),
  // …
}))
```

```ts
// database/seeders/UsersSeeder.ts (stub)
import type { Seeder } from '@rudderjs/orm'
import { UserFactory } from 'App/Factories/UserFactory.js'

export const UsersSeeder: Seeder = async () => {
  await UserFactory.count(10).create()
}
```

### Design

- **Owned by `@rudderjs/orm`** (where factories + seeders live) via the existing `MakeSpec` pattern. Same shape as `make:migration`. Two new MakeSpec exports under `commands/`:
  - `@rudderjs/orm/commands/make-factory` — `makeFactorySpec`
  - `@rudderjs/orm/commands/make-seeder` — `makeSeederSpec`
- **CLI loader** — `packages/cli/src/index.ts`'s `loadPackageCommands()` already imports orm command subpaths; just append two more `tryImport` calls + `registerMakeSpecs(...)`.
- **Template content** — keep the stubs minimal. The user's first task is to fill in the `Factory.define(...)` callback; the scaffolder shouldn't pre-decide the columns.
- **Faker integration** — the factory stub imports the `faker` arg from `Factory.define()`'s callback signature (faker is wired by the factory class, not imported separately). Verify against the existing factory runtime before locking the template.

### Risks

- **Existing apps may already have `app/Factories/` or `database/seeders/` populated.** **Mitigation:** the scaffolder refuses to overwrite an existing file without `--force` (matches every other `make:*` scaffolder's behavior — covered in CLAUDE.md).
- **`make:factory <Name>` vs the model class.** Convention: name without `Factory` suffix produces `<Name>Factory`. Match existing make:* naming logic; don't introduce a new convention.

### Exit criteria

- `pnpm rudder make:factory User` writes `app/Factories/UserFactory.ts` with the stub.
- `pnpm rudder make:seeder Users` writes `database/seeders/UsersSeeder.ts` with the stub.
- Tests: per-make smoke test (mirror existing make:* tests in `packages/cli/src/commands/make/*.test.ts`).
- Update `docs/guide/rudder.md` make:* list. Update README's "One CLI" highlight if it enumerates make:* targets (it currently does via "make:*" wildcard — no change needed).

---

## Sequencing

The phases are independent — none blocks any other. Suggested order matches the user's pick order:

1. **Phase 1 — `rudder tinker`** — biggest standalone DX win. Start here.
2. **Phase 2 — Editor-launch** — caps the Ignition restoration story. Small, visible.
3. **Phase 3 — Typed `route()`** — caps the typed-routes story. Type-only, low risk.
4. **Phase 4 — `make:factory` + `make:seeder`** — smallest. Tidy finish.

Each phase ships its own PR + changeset. Bundle into a single release-PR cascade (changesets accumulate, then one merge of `chore: version packages`).

## Out of scope / follow-ups

- **`useForm()` view helper bridging FormRequest → frontend forms.** Inertia-style. Touches view + contracts + auth views. Bigger product decision. Re-evaluate after Phase 1-4 land.
- **Telescope integration of tinker sessions.** Recording tinker queries to telescope's command timeline is a nice-to-have; not in this roadmap.
- **`route():open <name>`** — open the handler file in the editor for a named route. Would extend Phase 2's editor-launch infrastructure. Pick up if there's user demand.
- **Decorator-controller path-param + registry typing.** Same limitation called out by #482 — decorators lose literal types through metadata. Solving it is a TS-acrobatics project, not a DX bet.
- **`pnpm rudder dump <expr>`** — Laravel's `dump()` helper as a CLI command. Phase 1's tinker covers the same need more flexibly; skip.
