# Architecture

## Dependency Flow (summary)

Foundation (contracts, support) → Core (middleware, validation, router, server-hono, core) → Data (database, orm, cache, queue) → Auth & Security → Communication → Utilities → AI → Monitoring (telescope, pulse, horizon) → Testing/CLI/Build

> **Cycle resolution**: `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer('@rudderjs/router')`. Never add `@rudderjs/core` to router's `dependencies` or `devDependencies`.

## Middleware Groups (web / api)

Routes loaded via `withRouting({ web })` are tagged `'web'`; via `withRouting({ api })` tagged `'api'`. The server adapter prepends the matching group's middleware stack before per-route middleware, Laravel-style.

- **`m.web(...)` / `m.api(...)`** in `withMiddleware((m) => ...)` — append to a named group's stack.
- **`m.use(...)`** — global, runs on every request regardless of group (order: `m.use` → group → per-route → handler).
- **`appendToGroup('web' | 'api', handler)`** (core export) — provider-facing helper. Framework packages install into a group during `boot()` instead of calling `router.use()` globally.
- **`@rudderjs/session`** auto-installs `sessionMiddleware` on the `web` group.
- **`@rudderjs/auth`** auto-installs `AuthMiddleware` on the `web` group.
- **API routes are stateless by default** — no `req.user`, no session. Opt into bearer auth per-route with `RequireBearer()` + `scope(...)` from `@rudderjs/passport`, or `RequireAuth('api')` with a token guard.
- **`SessionGuard.user()` soft-fails** when no session ALS context — matches Laravel's `Auth::user()` semantics (returns `null`, never throws).
- Route loaders run **serially**, not via `Promise.all`, because group tagging uses a module-level variable in `@rudderjs/router` that concurrent loaders would clobber. Sequential execution is negligibly slower for ≤4 loaders.

## Dynamic Provider Registration

Providers can be registered at runtime via `app().register(ProviderClass)`:

- Called from within another provider's `boot()` method
- Calls `register()` immediately; calls `boot()` if app is already booted or booting
- Duplicate guard by class reference and class name — safe to call multiple times

```ts
// Inside a provider's boot()
app().register(SomeServiceProvider)
```

## Controller Views (`@rudderjs/view`)

Routes return `view('id', props)` and the page is rendered through Vike's SSR pipeline — Laravel ergonomics, Vike performance, no Inertia adapter. View files live in `app/Views/**` and are discovered by `@rudderjs/vite`'s scanner at dev/build time.

- **Id → URL mapping** is 1:1 by default (`'dashboard'` → `/dashboard`, `'admin.users'` → `/admin/users`). Override by exporting a `route` constant at the top of the view file: `export const route = '/'` or `export const route = '/login'`. **Required** whenever the controller URL diverges from the id-derived path — otherwise Vike's client route table doesn't match the browser URL and SPA nav falls back to full reloads.
- **Framework support**: React / Vue / Solid / vanilla (Blade equivalent — HTML-string functions, zero client JS). Scanner auto-detects the installed `vike-*` renderer. Vanilla views should use the `html\`\`` tagged template from `@rudderjs/view` for auto-escaping.
- **Packages shipping views** follow the shape `packages/<name>/views/<framework>/<Name>.{tsx,vue}` + `src/routes.ts` exporting `registerXRoutes(router, opts)`. `@rudderjs/auth` is the reference implementation — see `feedback_package_ui_shape.md` in memory.
- **Welcome page** (`app/Views/Welcome.tsx` with `export const route = '/'`) is the default landing page scaffolded by `create-rudder`. Auth-aware: shows Log in / Register links or a signed-in user with a Sign out button.
- **Typed `view()` calls** — when a view file exports `interface Props` (or `type Props`), `@rudderjs/vite`'s scanner emits `.rudder/types/views.d.ts` mapping the view id to `import('App/Views/<file>').Props`. The corresponding `view('id', ...)` call is then type-checked at the controller. Views without `Props` keep the loose `Record<string, unknown>` behavior — opt in per view, no migration required. See `docs/guide/typed-views.md`.

## Terminal Views (`@rudderjs/terminal`)

Commands return `terminal('id', props)` and the component is rendered in the terminal via Ink (React 19). Component files live in `app/Terminal/**`, discovered by convention at runtime (no Vite scanner needed — commands run in Node).

- **Id → file mapping**: `'dashboard'` → `app/Terminal/Dashboard.tsx`, `'admin.users'` → `app/Terminal/Admin/Users.tsx` (same dot-notation as `view()`)
- **React 19 required**: `ink@7+` requires `react>=19.2.0`. Do not use `ink@5.x` — it crashes against React 19's internals.
- **TTY guard**: `terminal()` throws a clear error in non-interactive environments (CI, piped output). Check `process.stdout.isTTY` if you need a no-op fallback.
- **Exit signal**: use `useApp().exit()` from Ink to signal completion. Without it, the command hangs until `Ctrl+C`.
- **Scaffolder**: `pnpm rudder make:terminal <Name>` generates `app/Terminal/<Name>.tsx` with a stub component.

## Package Merge Policy (Tight-Coupling Only)

Merge packages only when they are effectively one runtime unit.

Checklist before merging:

1. **Always co-deployed**: both packages are always installed/booted together.
2. **Shared lifecycle**: they register/boot together and one has no meaningful standalone behavior.
3. **No adapter boundary**: package is not a plugin/driver integration surface.
4. **No portability boundary**: package is not optional due to runtime/environment constraints.
5. **Same release cadence**: they nearly always change together.
6. **Low blast radius**: merge does not force widespread import/dependency churn.

If any item fails, keep packages separate.

## Bootstrap Pattern (Laravel 11-style)

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { requestIdMiddleware } from 'App/Http/Middleware/RequestIdMiddleware.ts'
import config from '../config/index.ts'
import providers from './providers.ts'

// `server:` is optional — omitted, core auto-resolves @rudderjs/server-hono
// with config('server'). Pass `server: hono(config.server)` to override.
export default Application.configure({ config, providers })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    // Global — runs on every request, regardless of group
    m.use(requestIdMiddleware)

    // Per-group — only the matching route loader's stack gets these
    m.web(RateLimit.perMinute(60))
    m.web(CsrfMiddleware({ exclude: ['/paddle/webhook'] }))
  })
  .create()
```

```ts
// bootstrap/providers.ts
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ /* event → listeners map */ }),
  AppServiceProvider,
]
```

## Provider Auto-Discovery

Framework providers are auto-discovered from each package's `package.json` `rudderjs` field. The `defaultProviders()` helper reads `bootstrap/cache/providers.json` and returns the right classes in stage + topo order — `foundation → infrastructure → feature → monitoring`, with `depends` resolved within each stage.

**The manifest self-heals at boot** (manifest v3): it carries a fingerprint of the dependency state (`depsHash` = sha256 of the app package.json deps blocks + a lockfile size/mtime stat — stat only, never read; absent in workspace apps where the lockfile lives at the repo root). Missing or stale (raw `pnpm add/remove`) → boot rescans `node_modules` and, in dev, rewrites the manifest (atomic tmp+rename) with one `[Rudder]` log line. **Production honors a stale manifest** (deterministic boots; warns on stale v3, silent on legacy v2) and scans in memory when it's missing (warn; best-effort write swallowed for read-only FS). No node_modules to scan → 7-entry `BUILTIN_REGISTRY` fallback. `providers:discover` remains as the **build-step primitive** — bundled/serverless deploys must bake the manifest at build time. Note: CLI commands suppress console during `bootApp()`, so the self-heal log lines surface in `pnpm dev`/server boots, not `rudder <cmd>` output. The manifest is gitignored.

**Opt-out paths:**

- **Skip a specific framework provider** — pass `skip` to `defaultProviders()`:
  ```ts
  ...(await defaultProviders({ skip: ['@rudderjs/horizon'] }))
  ```
- **Turn off auto-discovery entirely** — don't call `defaultProviders()`. Import each `*Provider` class explicitly and list them in the array, same as before.
- **Opt a package out of being discovered** — set `rudderjs.autoDiscover: false` in that package's `package.json`. Useful for packages that need explicit positioning or whose `boot()` has side effects that shouldn't fire by default.
- **Load the provider class from a subpath** — set `rudderjs.providerSubpath: "./server"` (or any subpath) in the package's `package.json`. The loader imports `<package>/<providerSubpath>` instead of the main entry. Used by `@rudderjs/ai` so the runtime-agnostic main entry doesn't pull in `@rudderjs/core`.

**`eventsProvider({...})` stays as a function** — it takes a per-app event-listener map, not a config key, so it lives outside auto-discovery and the user adds it manually.

**Dev-mode boot log** — when `app.isDevelopment()` and providers were loaded via `defaultProviders()`, the framework prints them grouped by stage right before `[Rudder] ready`. Missing packages are immediately visible instead of failing silently when first used. Production stays silent.

For third-party package authors writing their own provider, see `docs/guide/service-providers.md`.
