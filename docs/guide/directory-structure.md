# Directory Structure

A scaffolded Forge application has the following layout:

```
my-app/
├── bootstrap/
│   ├── app.ts              # Application entry — configure() + create()
│   └── providers.ts        # Ordered array of service provider classes
├── config/
│   ├── app.ts              # APP_NAME, APP_ENV, APP_DEBUG
│   ├── server.ts           # PORT, CORS, TRUST_PROXY
│   ├── database.ts         # DB_CONNECTION, DATABASE_URL
│   ├── auth.ts             # AUTH_SECRET, APP_URL, social providers
│   ├── queue.ts            # Queue driver, connections
│   ├── mail.ts             # Default mailer, from address
│   └── index.ts            # Collects all configs into a single default-exported object
├── app/
│   ├── Models/
│   │   └── User.ts         # ORM models — extends Model
│   ├── Services/
│   │   └── UserService.ts  # Business logic — bound in AppServiceProvider
│   ├── Providers/
│   │   ├── DatabaseServiceProvider.ts  # Connects ORM adapter
│   │   └── AppServiceProvider.ts       # Binds services and singletons
│   ├── Middleware/
│   │   └── RequestIdMiddleware.ts      # Attaches X-Request-Id to every response
│   ├── Jobs/
│   │   └── SendWelcomeEmail.ts         # Queue jobs — extends Job
│   ├── Notifications/
│   │   └── WelcomeNotification.ts      # Notifications — extends Notification
│   └── Http/
│       └── Requests/
│           └── CreateUserRequest.ts    # Form requests — extends FormRequest
├── routes/
│   ├── api.ts              # router.get/post/all() — side-effect file, no exports
│   ├── web.ts              # Non-API server routes (redirects, guards) — side-effect file
│   └── console.ts          # artisan.command() — side-effect file, no exports
├── pages/                  # Vike file-based SSR pages
│   ├── index/
│   │   └── +Page.tsx       # Rendered at /
│   └── +config.ts          # Vike renderer config
├── src/
│   └── index.css           # Global stylesheet (Tailwind + shadcn theme)
├── prisma/
│   └── schema.prisma       # Prisma schema — models, relations, datasource
├── .env                    # Secrets and environment-specific values
├── .env.example            # Template for team members
├── package.json
├── tsconfig.json
├── prisma.config.ts        # Prisma CLI config (schema path, datasource)
└── vite.config.ts          # Vite + Vike + React/Vue config
```

## Key Directories

### `bootstrap/`

The wiring layer. `app.ts` is the equivalent of Laravel's `bootstrap/app.php`. It configures the server adapter, registers providers, and declares route loaders. **Do not put business logic here.**

`providers.ts` exports an ordered array of service provider classes. Provider **boot order matters** — `DatabaseServiceProvider` must appear before `AppServiceProvider` (and any provider that uses ORM models during `boot()`) so `ModelRegistry` is set in time.

### `config/`

Named, typed configuration objects that read values from `.env` via `Env`. Think of these as Laravel's `config/` directory. Each file is a plain object exported by default:

```ts
// config/server.ts
import { Env } from '@boostkit/core/support'

export default {
  port: Env.getNumber('PORT', 3000),
  cors: { origin: Env.get('CORS_ORIGIN', '*') },
}
```

`config/index.ts` collects all of them into a single default export so `bootstrap/app.ts` can import via `import configs from '../config/index.ts'`.

### `app/`

Your application code. Structured by concern:

- **`Models/`** — ORM model classes, one per file
- **`Services/`** — pure business logic, injected via the DI container
- **`Providers/`** — service provider classes that wire up dependencies
- **`Jobs/`** — queue job classes
- **`Notifications/`** — notification classes
- **`Http/Requests/`** — form request validation classes

### `routes/`

Side-effect files — they run for their side effects (registering routes/commands) and export nothing.

- `api.ts` — HTTP routes via `router.get/post/all()`
- `web.ts` — Non-API server routes: redirects, server-side auth guards, download endpoints, sitemaps
- `console.ts` — Artisan commands via `artisan.command()`

These are loaded lazily by Forge via the `withRouting()` configuration.

### `pages/`

Vike file-based SSR pages. Files named `+Page.tsx` are rendered at the corresponding URL. This directory is optional — you can build a pure API app without any pages.

### `prisma/`

Contains `schema.prisma`. Run `pnpm exec prisma generate` after any schema change. SQLite is the default datasource in development.

### `bootstrap/app.ts` — The Entry Point

`bootstrap/app.ts` is both the bootstrap and the HTTP entry point. It must have `import 'reflect-metadata'` at the top, and it `export default`s the `Forge` instance returned by `.create()`.

`pages/+config.ts` wires Vike to use it via `vike-photon`:

```ts
// pages/+config.ts
import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'

export default {
  extends: [vikePhoton],
  photon: { server: 'bootstrap/app.ts' },
} as unknown as Config
```

No separate `src/index.ts` is needed — `vike-photon` consumes the `Forge` instance directly.

## Module Structure (optional)

For larger apps, you can organize features into modules — cohesive folders that contain their own models, services, providers, and routes:

```
app/
└── Blog/
    ├── Models/
    │   └── Post.ts
    ├── Services/
    │   └── PostService.ts
    ├── Providers/
    │   └── BlogServiceProvider.ts
    └── schema.prisma           # merged by module:publish
```

Use `pnpm artisan make:module Blog` to scaffold a module, then `pnpm artisan module:publish` to merge Prisma shards.
