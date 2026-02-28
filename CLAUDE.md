# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

---

## Project Overview

**Forge** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It aims to bring Laravel's developer experience (DI container, Eloquent-style ORM, Artisan CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@forge/*`
- **Status**: Early development (v0.0.1)

---

## Commands

All commands run from the **repo root**:

```bash
pnpm build        # Build all packages via Turbo
pnpm dev          # Watch mode for all packages
pnpm typecheck    # Type-check all packages
pnpm clean        # Remove all dist/ directories
```

Working on a single package:
```bash
cd packages/core
pnpm build        # tsc
pnpm dev          # tsc --watch
pnpm typecheck    # tsc --noEmit
```

Running the playground (demo app):
```bash
cd playground
pnpm dev          # tsx src/index.ts
```

> Always run `pnpm build` from root before `pnpm dev` in playground — packages must be compiled first.

---

## Monorepo Layout

```
forge/
├── packages/           # Core framework packages (@forge/*)
│   ├── core/           # App bootstrapper, ServiceProvider, lifecycle
│   ├── di/             # DI container + @Injectable/@Inject decorators
│   ├── router/         # Decorator routing + Vike wrapper
│   ├── middleware/      # Middleware pipeline + built-ins
│   ├── validation/     # FormRequest + Zod integration
│   ├── orm/            # ORM contract/interface
│   ├── orm-prisma/     # Prisma adapter
│   ├── orm-drizzle/    # Drizzle adapter (stub)
│   ├── queue/          # Queue contract/interface
│   ├── queue-inngest/  # Inngest adapter
│   ├── queue-bullmq/   # BullMQ adapter (stub)
│   ├── server/         # Server adapter contract
│   ├── server-hono/    # Hono adapter ✅
│   ├── server-express/ # Express adapter (stub)
│   ├── server-fastify/ # Fastify adapter (stub)
│   ├── server-h3/      # H3 adapter (stub)
│   ├── auth/           # Auth module (stub)
│   ├── support/        # Helpers, Collection, Env utilities
│   └── cli/            # Forge CLI (Artisan-style)
├── create-forge-app/   # Project scaffolder CLI
└── playground/         # Demo app — primary integration reference
```

---

## Package Status

| Package | Status | Notes |
|---|---|---|
| `@forge/support` | ✅ Complete | Collection, Env, helpers |
| `@forge/di` | ✅ Complete | Container, @Injectable, @Inject |
| `@forge/core` | ✅ Complete | Application, ServiceProvider |
| `@forge/server` | ✅ Complete | ServerAdapter interface |
| `@forge/server-hono` | ✅ Complete | Hono adapter |
| `@forge/router` | ✅ Complete | Decorators + Router class |
| `@forge/middleware` | ✅ Complete | Pipeline, CORS, Logger, Throttle |
| `@forge/validation` | ✅ Complete | FormRequest, validate(), z re-export |
| `@forge/queue` | ✅ Complete | Job, QueueAdapter interface |
| `@forge/queue-inngest` | ✅ Complete | Inngest adapter |
| `@forge/orm` | ✅ Complete | Model, QueryBuilder interface |
| `@forge/orm-prisma` | ✅ Complete | Prisma adapter |
| `@forge/cli` | ✅ Complete | make:controller/model/job/middleware/request/provider |
| `@forge/auth` | 📋 Planned | Sessions, JWT, guards |
| `@forge/orm-drizzle` | 📋 Planned | Drizzle adapter |
| `@forge/queue-bullmq` | 📋 Planned | BullMQ adapter |

---

## Architecture

### Dependency Flow

```
@forge/support
      ↑
@forge/di
      ↑
@forge/core
      ↑
@forge/router   @forge/middleware   @forge/orm   @forge/queue   @forge/validation
      ↑                ↑               ↑              ↑
@forge/server ←── server-hono      orm-prisma    queue-inngest
```

### Core Abstractions

#### `@forge/di` — Service Container
```ts
container.bind('key', (c) => new MyService())
container.singleton(MyService, (c) => new MyService())
container.make(MyService)   // auto-resolves @Injectable classes
```
- Uses `reflect-metadata` — always `import 'reflect-metadata'` at entry point
- `@Injectable()` marks a class for auto-resolution
- `@Inject(token)` overrides constructor parameter injection token

#### `@forge/core` — Application
```ts
const app = Application.create({
  name: 'MyApp',
  env: 'development',
  providers: [AppServiceProvider],
})
await app.bootstrap()
```
- `ServiceProvider` has `register()` (bind into container) and `boot()` (run after all providers registered)
- Global helpers: `app()`, `resolve(token)`

#### `@forge/router` — Routing
```ts
@Controller('/users')
class UserController {
  @Get('/:id')
  @Middleware([AuthMiddleware])
  show({ params }: ForgeRequest) { ... }
}

router.registerController(UserController)
router.mount(server)  // mount onto any ServerAdapter
```

#### `@forge/server` — Server Adapter Contract
```ts
interface ServerAdapter {
  registerRoute(route: RouteDefinition): void
  applyMiddleware(middleware: MiddlewareHandler): void
  listen(port: number, callback?: () => void): void
  getNativeServer(): unknown
}
```
Developer picks their server in `bootstrap/app.ts`:
```ts
export const server = hono()  // or express(), fastify(), h3()
```
UI framework is configured via Vike's own ecosystem (`vike-react`, `vike-vue`, `vike-solid`) in `vite.config.ts` and `pages/+config.ts`.

#### `@forge/orm` — ORM Contract
```ts
class User extends Model {
  static table = 'users'
  static hidden = ['password']
}

// Usage
const user = await User.find(1)
const users = await User.where('active', true).with('posts').get()
const paginated = await User.query().paginate(1, 15)
```

#### `@forge/validation` — Form Requests
```ts
class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name: z.string().min(2),
      email: z.string().email(),
    })
  }
}

// Inline validation
const data = await validate(z.object({ name: z.string() }), req)
```

#### `@forge/queue` — Jobs
```ts
class SendWelcomeEmail extends Job {
  constructor(public user: User) { super() }
  async handle() { /* send email */ }
}

await SendWelcomeEmail.dispatch(user).send()
await SendWelcomeEmail.dispatch(user).delay(5000).onQueue('emails').send()
```

#### `@forge/cli` — Forge CLI
```bash
forge make:controller UserController     # app/Http/Controllers/UserController.ts
forge make:model Post                    # app/Models/Post.ts
forge make:job SendWelcomeEmail          # app/Jobs/SendWelcomeEmail.ts
forge make:middleware Auth               # app/Http/Middleware/AuthMiddleware.ts
forge make:request CreateUser            # app/Http/Requests/CreateUserRequest.ts
forge make:provider App                  # app/Providers/AppServiceProvider.ts
```
All commands support `--force` to overwrite existing files.

---

## TypeScript Conventions

- All packages extend `../../tsconfig.base.json`
- `experimentalDecorators: true` + `emitDecoratorMetadata: true` — required for DI and routing decorators
- Always `import 'reflect-metadata'` at the **entry point** of any app using decorators
- `module: "NodeNext"` — use `.js` extensions in all imports even for `.ts` source files
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- Package `exports` always point to `dist/index.js`
- Turbo respects `^build` — changing a package auto-rebuilds all dependents

## Common Pitfalls

- **Missing `reflect-metadata`**: If you see `Reflect.defineMetadata is not a function`, add `import 'reflect-metadata'` to the entry point and install it as a dependency (not devDependency)
- **`workspace:*` not resolving**: Run `pnpm install` from root after adding a new local dependency
- **Stale `dist/`**: Run `pnpm build` from root before running the playground
- **`@prisma/client` errors**: Requires `prisma generate` to be run first in any app using `@forge/orm-prisma`
- **Decorator errors**: Make sure `experimentalDecorators` and `emitDecoratorMetadata` are enabled in the package's `tsconfig.json`