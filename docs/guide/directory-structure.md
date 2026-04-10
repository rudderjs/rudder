# Directory Structure

A scaffolded RudderJS application has the following layout:

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
│   └── console.ts          # rudder.command() — side-effect file, no exports
├── +server.ts              # Wires Vike to bootstrap/app.ts (fetch handler)
├── pages/                  # Vike file-based SSR pages
│   ├── +config.ts          # Root Vike config (UI renderer for single-framework apps)
│   ├── index/
│   │   ├── +config.ts      # Framework config (extends vike-react / vike-vue / vike-solid)
│   │   ├── +data.ts        # SSR data loader
│   │   └── +Page.tsx|.vue  # Home page — extension depends on primary framework
│   ├── _error/
│   │   └── +Page.tsx|.vue  # Error page (404, 401, 500)
│   └── {fw}-demo/          # Demo pages for secondary frameworks (when multiple selected)
│       └── +Page.tsx|.vue
├── src/
│   └── index.css           # Global stylesheet — only generated when Tailwind is selected
├── prisma/
│   └── schema.prisma       # Prisma schema — models, relations, datasource
├── .env                    # Secrets and environment-specific values
├── .env.example            # Template for team members
├── package.json
├── tsconfig.json
├── prisma.config.ts        # Prisma CLI config (schema path, datasource)
└── vite.config.ts          # Vite + framework plugins (react/vue/solid — conditional)
```

## Key Directories

### `bootstrap/`

The wiring layer. `app.ts` is the equivalent of Laravel's `bootstrap/app.php`. It configures the server adapter, registers providers, and declares route loaders. **Do not put business logic here.**

`providers.ts` exports an ordered array of service provider classes. Provider **boot order matters** — `prismaProvider(configs.database)` must appear first so `PrismaClient` is bound to the DI container before any other provider that needs it (auth, ORM models, etc.).

### `config/`

Named, typed configuration objects that read values from `.env` via `Env`. Think of these as Laravel's `config/` directory. Each file is a plain object exported by default:

```ts
// config/server.ts
import { Env } from '@rudderjs/core/support'

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
- `console.ts` — Rudder commands via `rudder.command()`

These are loaded lazily by RudderJS via the `withRouting()` configuration.

### `pages/`

Vike file-based SSR pages. The file extension depends on your primary framework — `.tsx` for React or Solid, `.vue` for Vue. Each page directory has a `+config.ts` that extends the appropriate vike framework config. This directory is optional — you can build a pure API app without any pages.

When multiple frameworks are selected via the scaffolder, secondary frameworks get demo pages under `pages/{fw}-demo/`.

### `prisma/`

Contains `schema.prisma`. Run `pnpm exec prisma generate` after any schema change. SQLite is the default datasource in development.

### `bootstrap/app.ts` — The Entry Point

`bootstrap/app.ts` is both the bootstrap and the HTTP entry point. It must have `import 'reflect-metadata'` at the top, and it `export default`s the `RudderJS` instance returned by `.create()`.

`+server.ts` at the project root wires Vike to the RudderJS instance:

```ts
// +server.ts
import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default {
  fetch: app.fetch,
} satisfies Server
```

No separate `src/index.ts` is needed — Vike consumes the `RudderJS` instance directly via `+server.ts`.

## Module Structure (optional)

For larger apps, you can organize features into modules — cohesive folders that contain their own models, services, providers, and routes:

```
app/
└── Modules/
    └── Blog/
        ├── Blog.prisma             # merged by module:publish
        ├── BlogSchema.ts
        ├── BlogService.ts
        └── BlogServiceProvider.ts
```

Use `pnpm rudder make:module Blog` to scaffold a module, then `pnpm rudder module:publish` to merge Prisma shards.
