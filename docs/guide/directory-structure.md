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
│   └── index.ts            # Barrel re-export of all config files
├── app/
│   ├── Models/
│   │   └── User.ts         # ORM models — extends Model
│   ├── Services/
│   │   └── UserService.ts  # Business logic — bound in AppServiceProvider
│   ├── Providers/
│   │   ├── DatabaseServiceProvider.ts  # Connects ORM adapter
│   │   └── AppServiceProvider.ts       # Binds services and singletons
│   ├── Jobs/
│   │   └── SendWelcomeEmail.ts         # Queue jobs — extends Job
│   ├── Notifications/
│   │   └── WelcomeNotification.ts      # Notifications — extends Notification
│   └── Http/
│       └── Requests/
│           └── CreateUserRequest.ts    # Form requests — extends FormRequest
├── routes/
│   ├── api.ts              # router.get/post/all() — side-effect file, no exports
│   └── console.ts          # artisan.command() — side-effect file, no exports
├── pages/                  # Vike file-based SSR pages
│   ├── index/
│   │   └── +Page.tsx       # Rendered at /
│   └── +config.ts          # Vike renderer config
├── prisma/
│   └── schema.prisma       # Prisma schema — models, relations, datasource
├── src/
│   └── index.ts            # WinterCG entry: export default { fetch: forge.handleRequest }
├── .env                    # Secrets and environment-specific values
├── .env.example            # Template for team members
├── package.json
├── tsconfig.json
└── vite.config.ts          # Vite + Vike + React/Vue config
```

## Key Directories

### `bootstrap/`

The wiring layer. `app.ts` is the equivalent of Laravel's `bootstrap/app.php`. It configures the server adapter, registers providers, and declares route loaders. **Do not put business logic here.**

`providers.ts` exports an ordered array of service provider classes. Provider **boot order matters** — `DatabaseServiceProvider` must come first so the ORM is ready when other providers boot.

### `config/`

Named, typed configuration objects that read values from `.env` via `Env`. Think of these as Laravel's `config/` directory. Each file is a plain object exported by default:

```ts
// config/server.ts
import { Env } from '@forge/core/support'

export default {
  port: Env.getNumber('PORT', 3000),
  cors: { origin: Env.get('CORS_ORIGIN', '*') },
}
```

`config/index.ts` re-exports all of them so `bootstrap/app.ts` can import via `import * as configs from '../config/index.js'`.

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
- `console.ts` — Artisan commands via `artisan.command()`

These are loaded lazily by Forge via the `withRouting()` configuration.

### `pages/`

Vike file-based SSR pages. Files named `+Page.tsx` are rendered at the corresponding URL. This directory is optional — you can build a pure API app without any pages.

### `prisma/`

Contains `schema.prisma`. Run `pnpm exec prisma generate` after any schema change. SQLite is the default datasource in development.

### `src/index.ts`

The WinterCG-compatible HTTP entry point. This file must import `reflect-metadata` once before anything else:

```ts
import 'reflect-metadata'
import forge from '../bootstrap/app.js'

export default { fetch: forge.handleRequest }
```

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
