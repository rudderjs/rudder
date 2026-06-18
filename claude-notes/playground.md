# Playground

`playground/` is the framework's own demo app — exercises auth, routing, ORM, queue, mail, cache, storage, scheduling, broadcast, sync, telescope/pulse/horizon, Agents (`@rudderjs/ai`). Pure framework, no extra dependencies.

**Two ORM twins**: `playground/` runs the **native engine** (sqlite, `database/migrations/`, `Model.for<>()` typed models, committed registry); `playground-prisma/` is the same app on the **Prisma adapter** (`prisma/schema/`, delegate table names, cuid ids). Some package tables on native still use literal delegate-style SQL names (`userMemory`, `notification`, `syncDocument`) so package models run unchanged on both; `@rudderjs/cashier-paddle` (`paddle_customers`, …) and `@rudderjs/passport` (`oauth_clients`, …) instead carry real `@@map` SQL names + `keyType: 'ulid'` on their models, resolved on Prisma via orm-prisma's SQL-name→delegate fallback (the forward direction the remaining package models will migrate to). Sync persistence on native uses `syncDatabase()` (rides the app's ORM adapter; same `syncDocument` table layout as `syncPrisma()` on the twin).

```bash
cd playground && pnpm dev   # :3000
```

> Always run `pnpm build` from the repo root before running the playground — packages must be compiled first.

## Playground structure

```
playground/
├── .rudder/types/      # generated typed registries (committed; views/routes/models .d.ts)
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [...(await defaultProviders()), eventsProvider({...}), AppServiceProvider]
├── config/             # ai, app, auth, cache, cashier, database, hash, horizon, localization,
│                       #   log, mail, passport, pulse, queue, server, session, storage, sync,
│                       #   telescope + index.ts barrel
├── app/
│   ├── Agents/ResearchAgent.ts   # @rudderjs/ai framework demo
│   ├── Commands/                 # custom rudder commands
│   ├── Events/ + Listeners/      # event dispatching demo
│   ├── Exceptions/               # custom exception renderers
│   ├── Http/                     # Controllers/, Middleware/ (Laravel-style namespace)
│   ├── Jobs/ExampleJob.ts        # queue demo
│   ├── Mail/DemoMail.ts          # mail demo
│   ├── Mcp/                      # MCP servers + tools (Echo + secured)
│   ├── Models/                   # User + demo models (Post/Video/Comment/Tag/Todo use Model.for<>())
│   ├── Modules/Todo/             # self-contained module with service + test
│   ├── Notifications/            # WelcomeNotification + others
│   ├── Providers/AppServiceProvider.ts
│   ├── Services/                 # singleton-ish app services
│   └── Views/                    # Laravel-style view() components (controller-returned)
│       ├── Welcome.tsx           #   `export const route = '/'` → served at /
│       ├── Home.tsx / About.tsx  #   id-derived URLs — /home, /about
│       ├── Auth/                 #   vendored from @rudderjs/auth/views/react/
│       │   └── {Login,Register,ForgotPassword,ResetPassword}.tsx
│       └── Demos/                #   /demos index + 14 framework-feature demos
├── routes/
│   ├── web.ts          # Web routes: welcome + registerAuthRoutes() + redirects/guards
│   ├── api.ts          # JSON API routes (router.get/post/all())
│   └── console.ts      # rudder.command() + db:seed + scheduler
├── pages/              # Vike file-based routing; `pages/__view/` is auto-generated
├── database/migrations/  # native-engine migrations (users, demo tables, package tables)
└── vite.config.ts
```

(`playground-prisma/` keeps the pre-conversion shape: `prisma/schema/` multi-file schema instead of `database/migrations/`, no models registry.)

**Provider boot order**: `DatabaseServiceProvider` (via `database()`) must come before any provider that uses ORM models.
