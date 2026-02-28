# ⚡ Forge — Architecture Document
> A Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite.

---

## Philosophy

| Principle | Description |
|-----------|-------------|
| **Modular** | Every feature is an opt-in package. Core stays lean. |
| **Convention over config** | Sensible defaults, but fully escapable. |
| **Framework-agnostic UI** | React, Vue, Solid — first-class support for all. |
| **Fullstack-first** | Server and client code live together, co-located by feature. |
| **Laravel DX** | Familiar patterns: service container, eloquent-style ORM, artisan CLI, middleware, form requests. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build / Dev server | Vite |
| SSR / File routing | Vike |
| UI | React / Vue / Solid (adapters) |
| Language | TypeScript |
| Runtime | Node.js 20+ / Bun |
| HTTP server | Hono / Express / Fastify / H3 (developer's choice via adapter) |
| ORM | Prisma adapter / Drizzle adapter (swappable) |
| Queues | Inngest (default) / BullMQ adapter |
| Validation | Zod (internal) with a Laravel-style Form Request wrapper |
| DI Container | Custom (inspired by tsyringe / InversifyJS — lighter) |

---

## Monorepo Structure

```
framework-root/
├── packages/
│   ├── core/               # Bootstrapper, kernel, app lifecycle
│   ├── router/             # Vike wrapper + decorator-based routing
│   ├── di/                 # Service container / dependency injection
│   ├── orm/                # ORM contract + base query builder
│   ├── orm-prisma/         # Prisma adapter
│   ├── orm-drizzle/        # Drizzle adapter
│   ├── server-hono/        # Hono server adapter
│   ├── server-express/     # Express server adapter
│   ├── server-fastify/     # Fastify server adapter
│   ├── server-h3/          # H3 server adapter (Nitro-compatible)
│   ├── middleware/         # Middleware pipeline
│   ├── validation/         # Form request + Zod integration
│   ├── queue/              # Queue contract
│   ├── queue-inngest/      # Inngest adapter
│   ├── queue-bullmq/       # BullMQ adapter
│   ├── auth/               # Auth module (sessions, JWT, OAuth)
│   ├── cli/                # Artisan-style CLI (forge CLI)
│   ├── config/             # Config loader + env helper
│   ├── support/            # Helpers, macros, collection class
│   └── testing/            # Testing utilities
├── create-forge-app/       # CLI scaffolder (like create-next-app)
└── docs/                   # Documentation site (built with the framework itself)
```

---

## Application Folder Structure (User's App)

```
my-app/
├── app/
│   ├── Http/
│   │   ├── Controllers/        # Page & API controllers
│   │   │   ├── UserController.ts
│   │   │   └── PostController.ts
│   │   ├── Middleware/         # Custom middleware
│   │   │   ├── AuthMiddleware.ts
│   │   │   └── ThrottleMiddleware.ts
│   │   └── Requests/           # Form request / validation classes
│   │       ├── CreateUserRequest.ts
│   │       └── UpdatePostRequest.ts
│   ├── Models/                 # ORM models (Eloquent-style)
│   │   ├── User.ts
│   │   └── Post.ts
│   ├── Jobs/                   # Queue jobs
│   │   ├── SendWelcomeEmail.ts
│   │   └── ProcessUpload.ts
│   ├── Services/               # Business logic / service classes
│   │   └── UserService.ts
│   ├── Providers/              # Service providers (registered in DI container)
│   │   ├── AppServiceProvider.ts
│   │   └── AuthServiceProvider.ts
│   └── Events/                 # Event & listener system
│       ├── UserRegistered.ts
│       └── SendVerificationEmail.ts
│
├── pages/                      # Vike file-based routing
│   ├── index/
│   │   ├── +Page.tsx           # UI component
│   │   ├── +data.ts            # Server-side data loader
│   │   └── +guard.ts           # Route guard (auth check, redirect)
│   ├── users/
│   │   ├── +Page.tsx
│   │   ├── +data.ts
│   │   └── @id/                # Dynamic segment
│   │       ├── +Page.tsx
│   │       └── +data.ts
│   └── api/                    # API routes (no UI)
│       └── users/
│           ├── +handler.ts     # GET/POST/PUT/DELETE handlers
│           └── @id/
│               └── +handler.ts
│
├── config/
│   ├── app.ts                  # App config (name, env, debug)
│   ├── database.ts             # ORM / DB connection config
│   ├── queue.ts                # Queue driver config
│   └── auth.ts                 # Auth guards & providers config
│
├── database/
│   ├── migrations/             # DB migrations
│   ├── seeders/                # DB seeders
│   └── schema.ts               # Drizzle schema OR prisma/schema.prisma
│
├── bootstrap/
│   ├── app.ts                  # App bootstrapper (register providers)
│   └── kernel.ts               # HTTP kernel (global middleware stack)
│
├── public/                     # Static assets
├── storage/                    # Logs, cache, uploads
├── tests/
│   ├── Unit/
│   └── Feature/
│
├── bootstrap/app.ts            # App wiring (server, providers, routes)
├── vite.config.ts              # Vite + Vike config (UI framework plugins)
├── tsconfig.json
└── package.json
```

---

## Key Concepts

### Routing — Two Styles

**File-based (Vike conventions):**
```
pages/users/@id/+data.ts  →  GET /users/:id
pages/api/posts/+handler.ts  →  API route
```

**Decorator-based (in controllers):**
```ts
@Controller('/users')
export class UserController {
  @Get('/:id')
  @Middleware([AuthMiddleware])
  async show({ params }: Context) {
    return User.find(params.id)
  }
}
```

---

### Service Container / DI

```ts
// bootstrap/app.ts
app.bind(UserService, () => new UserService())
app.singleton(MailService, () => new MailService(config('mail')))

// In a controller (auto-injected)
@Injectable()
export class UserController {
  constructor(private users: UserService) {}
}
```

---

### Eloquent-style ORM (Prisma Adapter)

```ts
// app/Models/User.ts
export class User extends Model {
  static table = 'users'

  posts() {
    return this.hasMany(Post)
  }
}

// Usage
const user = await User.with('posts').where('active', true).first()
```

---

### Validation / Form Requests

```ts
// app/Http/Requests/CreateUserRequest.ts
export class CreateUserRequest extends FormRequest {
  rules() {
    return {
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
    }
  }
}

// In controller — auto validated before handler runs
async store({ request }: Context) {
  const data = await request.validate(CreateUserRequest)
  return User.create(data)
}
```

---

### Queue / Jobs

```ts
// app/Jobs/SendWelcomeEmail.ts
export class SendWelcomeEmail extends Job {
  constructor(public user: User) {}

  async handle() {
    await Mail.to(this.user.email).send(new WelcomeMail(this.user))
  }
}

// Dispatching
await SendWelcomeEmail.dispatch(user)
await SendWelcomeEmail.dispatch(user).delay('5 minutes')
```

---

### Middleware Pipeline

```ts
// bootstrap/kernel.ts
export class HttpKernel extends Kernel {
  middleware = [
    CorsMiddleware,
    ThrottleMiddleware,
    SessionMiddleware,
  ]

  middlewareGroups = {
    web: [CsrfMiddleware, AuthMiddleware],
    api: [ApiAuthMiddleware],
  }
}
```

---

### CLI (forge — like Artisan)

```bash
# Scaffolding
forge make:controller UserController
forge make:model Post --migration
forge make:job SendWelcomeEmail
forge make:request CreateUserRequest
forge make:middleware AuthMiddleware
forge make:provider PaymentServiceProvider

# Database
forge db:migrate
forge db:seed
forge db:fresh --seed

# Queue
forge queue:work
forge queue:listen --queue=emails

# Dev
forge serve
forge build
forge routes:list
```

---

## bootstrap/app.ts (App wiring)

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'   // or express() / fastify() / h3()
import { router } from '@forge/router'
import { providers } from './providers.ts'
import configs from '../config/index.ts'
import '../routes/api.ts'

export const server = hono()
export const app = Application.create({ name: configs.app.name, providers })
export const handleFetch = await server.createFetchHandler((adapter) => {
  router.mount(adapter)
})
```

UI framework is handled by Vike's ecosystem — install `vike-react`, `vike-vue`, or `vike-solid` and configure in `vite.config.ts` and `pages/+config.ts`.

---

## Package Names (npm scope)

```
@forge/core
@forge/router
@forge/di
@forge/orm
@forge/orm-prisma
@forge/orm-drizzle
@forge/middleware
@forge/validation
@forge/queue
@forge/queue-inngest
@forge/queue-bullmq
@forge/auth
@forge/cli
@forge/support
@forge/testing
@forge/server-hono
@forge/server-express
@forge/server-fastify
@forge/server-h3
create-forge-app
```

---

## Roadmap (Suggested)

| Phase | Focus |
|-------|-------|
| **v0.1** | Core, DI, Router (Vike wrapper), CLI scaffold |
| **v0.2** | ORM adapters (Prisma + Drizzle), Validation |
| **v0.3** | Middleware pipeline, HTTP kernel |
| **v0.4** | Queue (Inngest + BullMQ), Jobs |
| **v0.5** | Auth module, Sessions |
| **v0.6** | React + Vue + Solid adapters |
| **v1.0** | Docs site, create-forge-app CLI, public launch |