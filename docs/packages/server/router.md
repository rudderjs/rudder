# @boostkit/router

Fluent HTTP router and decorator-based controller support for Forge.

```bash
pnpm add @boostkit/router
```

---

## Fluent Routing

Register routes in `routes/api.ts` using the global `router` singleton:

```ts
import { router } from '@boostkit/router'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

router.get('/api/users', async (_req: ForgeRequest, res: ForgeResponse) => {
  return res.json({ data: [] })
})

router.post('/api/users', async (req: ForgeRequest, res: ForgeResponse) => {
  return res.status(201).json({ data: req.body })
})

router.put('/api/users/:id', async (req: ForgeRequest, res: ForgeResponse) => {
  return res.json({ id: req.params.id })
})

router.delete('/api/users/:id', async (_req: ForgeRequest, res: ForgeResponse) => {
  return res.status(204).json({})
})

// Catch-all — must be last
router.all('/api/*', (_req: ForgeRequest, res: ForgeResponse) => {
  return res.status(404).json({ message: 'Route not found.' })
})
```

### Per-route Middleware

Pass an optional middleware array as the third argument:

```ts
import { RateLimit } from '@boostkit/rate-limit'

const authLimit = RateLimit.perMinute(10).toHandler()

router.post('/api/auth/login', loginHandler, [authLimit])
```

---

## Decorator-based Controllers

Use class decorators for controller-style routing. Controllers must be registered with `router.registerController()`.

```ts
import { Controller, Get, Post, Patch, Delete, Middleware } from '@boostkit/router'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

@Controller('/api/users')
export class UserController {
  @Get('/')
  async index(_req: ForgeRequest, res: ForgeResponse) {
    return res.json({ data: [] })
  }

  @Get('/:id')
  async show(req: ForgeRequest, res: ForgeResponse) {
    return res.json({ id: req.params.id })
  }

  @Post('/')
  async store(req: ForgeRequest, res: ForgeResponse) {
    return res.status(201).json({ data: req.body })
  }

  @Patch('/:id')
  async update(req: ForgeRequest, res: ForgeResponse) {
    return res.json({ id: req.params.id })
  }

  @Delete('/:id')
  async destroy(req: ForgeRequest, res: ForgeResponse) {
    return res.status(204).json({})
  }
}
```

Register the controller in `routes/api.ts`:

```ts
import { router } from '@boostkit/router'
import { UserController } from '../app/Http/Controllers/UserController.ts'

router.registerController(UserController)
```

### Controller-level Middleware

Apply middleware to every route in a controller with `@Middleware` on the class:

```ts
import { Controller, Get, Middleware } from '@boostkit/router'
import { AuthMiddleware } from '../app/Http/Middleware/AuthMiddleware.ts'

@Controller('/api/admin')
@Middleware([new AuthMiddleware().toHandler()])
export class AdminController {
  @Get('/stats')
  async stats(_req: ForgeRequest, res: ForgeResponse) {
    return res.json({ stats: {} })
  }
}
```

### Method-level Middleware

Apply middleware to a single route handler:

```ts
@Controller('/api/users')
export class UserController {
  @Post('/')
  @Middleware([rateLimitHandler])
  async store(req: ForgeRequest, res: ForgeResponse) { ... }
}
```

---

## Router API

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `(path, handler, middleware?)` | Register a GET route |
| `post` | `(path, handler, middleware?)` | Register a POST route |
| `put` | `(path, handler, middleware?)` | Register a PUT route |
| `patch` | `(path, handler, middleware?)` | Register a PATCH route |
| `delete` | `(path, handler, middleware?)` | Register a DELETE route |
| `all` | `(path, handler, middleware?)` | Match any HTTP method |
| `use` | `(middleware)` | Register global middleware (runs on every route) |
| `registerController` | `(ControllerClass)` | Register all routes from a decorator controller |
| `list` | `()` | Return all registered `RouteDefinition[]` |
| `reset` | `()` | Clear all routes and global middleware |

---

## Decorators

| Decorator | Target | Description |
|-----------|--------|-------------|
| `@Controller(prefix)` | Class | Marks a class as a controller; `prefix` is prepended to all route paths |
| `@Get(path)` | Method | Registers a GET route |
| `@Post(path)` | Method | Registers a POST route |
| `@Put(path)` | Method | Registers a PUT route |
| `@Patch(path)` | Method | Registers a PATCH route |
| `@Delete(path)` | Method | Registers a DELETE route |
| `@Options(path)` | Method | Registers an OPTIONS route |
| `@Middleware(handlers)` | Class or Method | Attaches middleware at controller or route level |

---

## Notes

- `@boostkit/router` is a **peer dependency** of `@boostkit/core` — it is loaded at runtime and never causes a circular dependency
- Decorator support requires `experimentalDecorators: true` and `emitDecoratorMetadata: true` in `tsconfig.json`, and `import 'reflect-metadata'` at the app entry point
- Route files (`routes/api.ts`, `routes/web.ts`) are side-effect modules — they call `router.*` for their effect and do not need to export anything
- `router.all()` matches every HTTP method and is typically used as a catch-all for 404 responses — register it last
