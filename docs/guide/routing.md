# Routing

BoostKit supports two routing styles: **fluent** (Laravel-style) and **decorator-based** (NestJS-style). Both use the same global `router` singleton from `@boostkit/router`.

## Route Files

Routes are registered in side-effect files — they run for their side effects and export nothing. They are loaded lazily the first time the app handles an HTTP request:

```ts
// bootstrap/app.ts
Application.configure({ ... })
  .withRouting({
    api: () => import('../routes/api.js'),
  })
```

## Fluent Routing

### Basic Routes

```ts
// routes/api.ts
import { router } from '@boostkit/router'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

router.post('/api/users', async (req: AppRequest, res: AppResponse) => {
  const { name, email } = req.body as { name: string; email: string }
  // ... create user
  return res.status(201).json({ data: user })
})

router.put('/api/users/:id', async (req, res) => {
  const { id } = req.params
  // ...
})

router.delete('/api/users/:id', async (req, res) => {
  // ...
})
```

### Route Parameters

Access route parameters via `req.params`:

```ts
router.get('/api/posts/:slug', async (req, res) => {
  const { slug } = req.params
  // ...
})
```

### Query Strings

Access query string values via `req.query`:

```ts
// GET /api/users?role=admin&page=2
router.get('/api/users', async (req, res) => {
  const { role, page } = req.query
  // ...
})
```

### Wildcard Catch-All

Use `router.all()` to match any HTTP method:

```ts
// Catch all unmatched API routes
router.all('/api/*', (_req, res) => {
  return res.status(404).json({ message: 'Route not found.' })
})
```

### Available Methods

| Method | Description |
|--------|-------------|
| `router.get(path, handler, mw?)` | GET |
| `router.post(path, handler, mw?)` | POST |
| `router.put(path, handler, mw?)` | PUT |
| `router.patch(path, handler, mw?)` | PATCH |
| `router.delete(path, handler, mw?)` | DELETE |
| `router.all(path, handler, mw?)` | Any method |
| `router.add(method, path, handler, mw?)` | Explicit method string |

### Middleware on Fluent Routes

Pass middleware as the third argument:

```ts
router.get('/protected', handler, [authMiddleware])
router.post('/admin', handler, [authMiddleware, adminMiddleware])
```

## Decorator-Based Routing

For larger apps, group related routes into controller classes:

```ts
import { Controller, Get, Post, Put, Delete, Middleware, router } from '@boostkit/router'
import { Injectable } from '@boostkit/core'
import type { AppRequest, AppResponse } from '@boostkit/contracts'
import { authMiddleware } from '../Http/Middleware/auth.js'
import { UserService } from '../Services/UserService.js'

@Controller('/api/users')
@Injectable()
class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/')
  async index(_req: AppRequest, res: AppResponse) {
    const users = await this.userService.all()
    return res.json({ data: users })
  }

  @Get('/:id')
  @Middleware([authMiddleware])
  async show(req: AppRequest, res: AppResponse) {
    const user = await this.userService.find(req.params.id as string)
    if (!user) return res.status(404).json({ message: 'Not found' })
    return res.json({ data: user })
  }

  @Post('/')
  async store(req: AppRequest, res: AppResponse) {
    const user = await this.userService.create(req.body as any)
    return res.status(201).json({ data: user })
  }

  @Put('/:id')
  async update(req: AppRequest, res: AppResponse) {
    const user = await this.userService.update(req.params.id as string, req.body as any)
    return res.json({ data: user })
  }

  @Delete('/:id')
  async destroy(req: AppRequest, res: AppResponse) {
    await this.userService.delete(req.params.id as string)
    return res.status(204).send('')
  }
}

// Register the controller — call this in routes/api.ts
router.registerController(UserController)
```

### Available Decorators

| Decorator | Target | Description |
|-----------|--------|-------------|
| `@Controller(prefix?)` | class | Marks a class as a controller with a route prefix |
| `@Get(path)` | method | GET route |
| `@Post(path)` | method | POST route |
| `@Put(path)` | method | PUT route |
| `@Patch(path)` | method | PATCH route |
| `@Delete(path)` | method | DELETE route |
| `@Options(path)` | method | OPTIONS route |
| `@Middleware([...handlers])` | class or method | Apply middleware handlers |

### Middleware Ordering

When `@Middleware` is used on both the class and a method, class middleware runs first:

```ts
@Controller('/api')
@Middleware([logMiddleware])        // runs first for every route
class Ctrl {
  @Get('/private')
  @Middleware([authMiddleware])     // runs second, only for this route
  private() {}
}
```

## `AppRequest` and `AppResponse`

### `AppRequest`

| Property | Type | Description |
|----------|------|-------------|
| `method` | `string` | HTTP method |
| `path` | `string` | Request path |
| `params` | `Record<string, string \| string[]>` | Route parameters |
| `query` | `Record<string, string \| string[]>` | Query string |
| `body` | `unknown` | Parsed request body |
| `headers` | `Record<string, string>` | Request headers |
| `raw` | `unknown` | Adapter-specific raw request |

### `AppResponse`

| Method | Description |
|--------|-------------|
| `res.json(data)` | JSON response (200) |
| `res.status(code)` | Set status code (chainable) |
| `res.send(body)` | Plain text response |
| `res.redirect(url, code?)` | Redirect response |
| `res.header(key, value)` | Set a response header (chainable) |

## Notes

- Routes are matched in registration order — put catch-alls last
- `router.all('/api/*', ...)` should be the last route in your API file
- `router` and `Route` are the same global singleton
- Decorator controllers require `reflect-metadata` at the entry point
- Double slashes in composed paths are normalised: `/api` + `/users` → `/api/users`
- Controllers must be registered with `router.registerController(ControllerClass)`
