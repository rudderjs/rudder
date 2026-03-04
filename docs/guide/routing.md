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
| `router.get(path, handler)` | GET |
| `router.post(path, handler)` | POST |
| `router.put(path, handler)` | PUT |
| `router.patch(path, handler)` | PATCH |
| `router.delete(path, handler)` | DELETE |
| `router.options(path, handler)` | OPTIONS |
| `router.all(path, handler)` | Any method |

## Decorator-Based Routing

For larger apps, group related routes into controller classes:

```ts
import { Controller, Get, Post, Put, Delete, Middleware } from '@boostkit/router'
import { Injectable } from '@boostkit/di'
import type { AppRequest, AppResponse } from '@boostkit/contracts'
import { AuthMiddleware } from '../Http/Middleware/AuthMiddleware.js'
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
  @Middleware([AuthMiddleware])
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
    return res.status(204).json({})
  }
}

// Register the controller — call this in routes/api.ts
router.registerController(UserController)
```

### Available Decorators

| Decorator | Description |
|-----------|-------------|
| `@Controller(prefix)` | Marks a class as a controller with a route prefix |
| `@Get(path)` | GET method |
| `@Post(path)` | POST method |
| `@Put(path)` | PUT method |
| `@Patch(path)` | PATCH method |
| `@Delete(path)` | DELETE method |
| `@Options(path)` | OPTIONS method |
| `@Middleware([...classes])` | Applies middleware to a route |

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

## Middleware on Routes

Apply middleware to specific routes using the fluent builder (coming soon) or the `@Middleware` decorator:

```ts
import { fromClass } from '@boostkit/middleware'
import { AuthMiddleware } from '../Http/Middleware/AuthMiddleware.js'

// Decorator style
@Get('/protected')
@Middleware([AuthMiddleware])
async protected(req, res) { ... }
```

See the [Middleware guide](/guide/middleware) for details on writing middleware classes.

## Notes

- Routes are matched in registration order — put catch-alls last
- `router.all('/api/*', ...)` should be the last route in your API file
- Decorator controllers require `reflect-metadata` at the entry point
- Controllers must be registered with `router.registerController(ControllerClass)`
