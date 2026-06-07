# Directory Structure

A scaffolded Rudder app puts each concern in a predictable place — bootstrap, config, app code, routes, schema — with a small Vite/Vike layer for the frontend.

```
my-app/
├── .rudder/                # Generated-files home (committed) — see "Generated files"
│   ├── README.md           # What each file is + regen commands
│   └── types/              # Type registries: views.d.ts, routes.d.ts, models.d.ts, env.d.ts
├── bootstrap/
│   ├── app.ts              # Application.configure() — entry point
│   ├── providers.ts        # Ordered service providers
│   └── cache/
│       └── providers.json  # Provider manifest — self-heals at boot (gitignored)
├── config/                 # Typed config objects (read .env via Env)
├── app/
│   ├── Http/
│   │   ├── Controllers/    # Decorator-based controllers
│   │   ├── Middleware/     # Custom HTTP middleware
│   │   └── Requests/       # Form-request validators
│   ├── Models/             # ORM models — extend Model
│   ├── Providers/          # Service provider classes
│   ├── Terminal/           # Ink components for `terminal('id', props)` — make:terminal
│   └── Views/              # Controller-returned views (`view('id', props)`)
├── routes/
│   ├── api.ts              # API routes — router.get/post/all()
│   ├── web.ts              # Web routes — controller views, redirects, guards
│   └── console.ts          # Rudder commands — rudder.command()
├── pages/                  # Vike file-based SSR pages (optional)
│   ├── +onCreatePageContext.ts  # Auto-generated stub re-exporting @rudderjs/vite — overwrite to customize
│   ├── +onError.ts              # Auto-generated stub
│   └── +headersResponse.ts      # Auto-generated stub (reads pageContext.viewHeaders)
├── database/migrations/    # Native-engine migrations (default scaffold)
├── prisma/schema/          # Multi-file Prisma schema — only when Prisma is selected
├── boost.json              # @rudderjs/boost agent + skill config (commit it)
├── src/index.css           # Stylesheet — only when Tailwind is selected
├── +server.ts              # Wires Vike to bootstrap/app.ts
├── vite.config.ts
├── tsconfig.json
└── .env
```

A fresh `pnpm create rudder` scaffold ships only the directories above. Other conventional folders — `Jobs/`, `Services/`, `Events/`, `Listeners/`, `Exceptions/`, `Mail/`, `Commands/`, `Notifications/`, `Agents/`, `Mcp/`, `Terminal/` — get created the first time you run the matching `make:*` command. See [Rudder Console](/guide/rudder) for the full list.

`bootstrap/cache/providers.json` is gitignored and maintained automatically: `defaultProviders()` reads it at boot and regenerates it whenever it's missing or your dependencies changed. `pnpm rudder providers:discover` bakes it explicitly — needed only in build pipelines for bundled/serverless deploys.

## Key directories

### `bootstrap/`

The wiring layer. `app.ts` configures the server adapter, lists providers, and declares route loaders. Do not put business logic here.

`providers.ts` exports an ordered array of provider classes. The order matters: providers boot in array order, so anything depending on the database must come after the database provider. See [Service Providers](/guide/service-providers).

### `config/`

Named, typed configuration objects. Each file is a plain object exported by default:

```ts
// config/server.ts
import { Env } from '@rudderjs/support'

export default {
  port: Env.getNumber('PORT', 3000),
  cors: { origin: Env.get('CORS_ORIGIN', '*') },
}
```

`config/index.ts` collects them all into one default export so `bootstrap/app.ts` can pull a single `configs` object.

### `app/`

Your application code, organized by concern.

| Folder | Created by | Contains |
|---|---|---|
| `Http/Controllers/` | scaffolder + `make:controller` | Decorator-based controllers |
| `Http/Middleware/` | scaffolder + `make:middleware` | Custom HTTP middleware classes |
| `Http/Requests/` | `make:request` | Form-request validators |
| `Models/` | scaffolder (with auth) + `make:model` | ORM model classes |
| `Providers/` | scaffolder + `make:provider` | Service providers wiring up dependencies |
| `Views/` | scaffolder + vendor:publish | Controller-returned views — see [Frontend](/guide/frontend) |
| `Jobs/` | `make:job` | Queue jobs extending `Job` |
| `Events/` / `Listeners/` | `make:event` / `make:listener` | Event classes + their listeners |
| `Exceptions/` | `make:exception` | Domain exceptions — see [Error Handling](/guide/error-handling) |
| `Mail/` | `make:mail` | Mailable classes |
| `Commands/` | `make:command` | Custom rudder CLI commands |

PascalCase filenames in `Views/` map to kebab-case ids: `AdminUsers.tsx` → `admin-users`. Nested directories use dotted ids: `Auth/Login.tsx` → `auth.login`.

#### Importing from `app/`

Use the `App/` path alias instead of relative imports — it works the same way `App\\` does in Laravel:

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { User } from 'App/Models/User.js'                      // ✅ alias
import { AuthController } from 'App/Http/Controllers/AuthController.js'

Route.get('/users', async () => User.all())
```

```ts
// ❌ Avoid — brittle and verbose, especially as files move
import { User } from '../app/Models/User.js'
import { User } from '../../app/Models/User.js'
```

The alias resolves via `tsconfig.json` `paths` (typecheck + IDE jump-to-definition) and the `@rudderjs/vite` plugin (dev + build). Both are wired automatically by `create-rudder`. Sibling imports inside `app/` itself stay relative — `App/` is for code outside the directory reaching in.

A separate `@/` alias points at `src/` for non-`app/` code like CSS entry points: `import '@/index.css'`.

### `routes/`

Side-effect files — they run for their side effects (registering routes or commands) and export nothing.

- **`api.ts`** — API routes via `router.get/post/all()`. Tagged `'api'`, stateless by default.
- **`web.ts`** — Controller-view routes, redirects, server-side guards. Tagged `'web'`, gets session + auth middleware automatically.
- **`console.ts`** — Rudder commands via `rudder.command()`.

These files are loaded lazily by the framework. `web.ts` and `api.ts` are loaded on the first HTTP request; `console.ts` only when you run `pnpm rudder`.

### `pages/`

Vike file-based SSR pages. The file extension matches your primary framework — `.tsx` for React or Solid, `.vue` for Vue. Each page directory has a `+config.ts` that extends the appropriate `vike-*` config.

This directory is **optional**. Pure API apps omit it entirely and remove Vike from `vite.config.ts`. See [Frontend](/guide/frontend) for the full Vike + controller-view model.

### `database/migrations/`

Native-engine migration files — the default scaffold. Timestamped classes with `up()` / `down()` using the `Schema` blueprint, applied with `pnpm rudder migrate` (which also regenerates the typed model registry at `.rudder/types/models.d.ts`). See [Migrations](/guide/database/migrations) and the [Native Engine guide](/guide/database/native#migrations).

### `prisma/schema/`

Only present when Prisma is selected. Multi-file Prisma schema — each `@rudderjs/*` package that ships models (e.g. `@rudderjs/auth`) publishes its own `<name>.prisma` file via `pnpm rudder vendor:publish`. Your app-specific models live in `app.prisma`. The `datasource` and `generator` blocks live in `base.prisma`.

Run `pnpm rudder db:generate` after any schema change (ORM-agnostic — on Prisma this shells to `prisma generate`; on Drizzle it's a no-op; the native engine has no client to generate).

## Generated files

The framework generates a small, fixed set of files. The rule: **generated type registries live in the committed `.rudder/` directory** (so `tsc`/CI stay green with no generate step); **regenerable caches live in `bootstrap/cache/` and are gitignored**. Everything generated carries an `AUTO-GENERATED` header — never hand-edit it.

| File | What it is | Committed? | Regenerated by |
|---|---|---|---|
| `.rudder/types/views.d.ts` | Typed-views registry — view id → exported `Props`, type-checks `view('id', props)` | **yes** | views scanner (dev/build) or `pnpm rudder view:sync` |
| `.rudder/types/routes.d.ts` | `RouteRegistry` augmentation — typed `route(name, params)` from `.name()` chains | **yes** | routes scanner (dev/build) or `pnpm rudder routes:sync` |
| `.rudder/types/models.d.ts` | Typed-models registry — column types introspected from the migrated schema (native engine) | **yes** — CI can't regenerate it (needs a live, migrated database) | `pnpm rudder migrate` / `pnpm rudder schema:types` |
| `.rudder/types/env.d.ts` | Typed-env registry — `Env.get()` keys declared in `.env.example` (the committed contract; `.env` itself is never read) | **yes** | env scanner (dev/build) or `pnpm rudder env:sync` |
| `.rudder/README.md` | Self-description of the directory + regen commands | **yes** | either Vite scanner |
| `pages/__view/**` | Vike page stubs for `app/Views/**` | **yes** — Vike discovers pages via `git ls-files`; gitignoring 404s every view | views scanner, on every dev/build |
| `bootstrap/cache/providers.json` | Provider auto-discovery manifest | **no** (gitignored) | self-heals at boot; `pnpm rudder providers:discover` to bake in CI/build |

Unlike `.nuxt/`-style directories, `.rudder/` is **committed** — its artifacts can't all be regenerated without context (the models registry needs your migrated database), and committing them keeps a fresh clone type-checking with zero generate steps. The Vike page stubs stay in `pages/__view/` because Vike's filesystem routing pins them there; only the pure `.d.ts` registries live in `.rudder/types/`.

Two upgrade notes for apps created before `.rudder/` existed (2026-06):

- Each generator **migrates automatically** — the first dev/build/sync after upgrading writes the new path and deletes the legacy file (`pages/__view/registry.d.ts`, `routes/__registry.d.ts`, `app/Models/__schema/registry.d.ts`). Commit the resulting rename.
- Add `".rudder/**/*"` to your `tsconfig.json` `include` array. Dot-directories are invisible to `**/*` globs (and to bare-directory include entries), so without the explicit glob the registries silently drop out of the program. `rudder doctor` warns when this is missing.

## The entry point

`bootstrap/app.ts` is both the bootstrap file and the HTTP entry point. `import 'reflect-metadata'` must be the first line — it enables the entire DI container.

`+server.ts` at the project root wires Vike to the Rudder instance:

```ts
// +server.ts
import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default { fetch: app.fetch } satisfies Server
```

No separate `src/index.ts` is needed — Vike consumes the Rudder instance directly.

## Modules (optional)

For larger apps, organize features into self-contained modules under `app/Modules/`:

```
app/
└── Modules/
    └── Blog/
        ├── BlogSchema.ts           # Zod input/output schemas + types
        ├── BlogService.ts          # @Injectable service
        ├── BlogServiceProvider.ts  # routes + DI bindings
        ├── Blog.test.ts            # smoke test
        └── Blog.prisma             # merged by module:publish
```

Generate one with `pnpm rudder make:module Blog`, then `pnpm rudder module:publish` merges the module's Prisma shard into the main schema. Modules are an organizational convention — the framework treats `app/Modules/Blog/` no differently from a regular folder. The benefit is keeping a feature's schema, service, provider, test, and Prisma model co-located.
