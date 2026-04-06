# @rudderjs/contracts

Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters.

This package is **type-only** — it contains no runtime code. All `@rudderjs/*` packages depend on it as the shared type language for HTTP primitives.

## Installation

```bash
pnpm add @rudderjs/contracts
```

Prefer `import type` in application code to guarantee zero runtime cost.

---

## `AppRequest`

Normalised incoming HTTP request passed to route handlers and middleware.

```ts
import type { AppRequest } from '@rudderjs/contracts'
```

**Fields**

| Field | Type | Description |
|---|---|---|
| `method` | `string` | HTTP method in uppercase (`'GET'`, `'POST'`, etc.). |
| `url` | `string` | Full request URL including query string. |
| `path` | `string` | URL pathname without query string. |
| `params` | `Record<string, string>` | Route parameters (e.g. `/users/:id` → `{ id: '1' }`). |
| `query` | `Record<string, string>` | Parsed query string parameters. |
| `headers` | `Record<string, string>` | Lowercased request headers. |
| `body` | `unknown` | Parsed request body. JSON bodies are parsed by the server adapter. |
| `raw` | `unknown` | The raw underlying request object from the server adapter. Cast as needed. |

**Typed input accessors**

Merge order: `params` > `body` > `query` (route params win).

```ts
const name   = req.string('name')            // string ('' if missing)
const age    = req.integer('age', 0)         // number
const price  = req.float('price', 0.0)       // number
const active = req.boolean('active', false)  // boolean
const date   = req.date('created_at')        // Date
const ids    = req.array('ids', [])          // unknown[]
const raw    = req.input('key')              // unknown

req.has('name')      // true if present in any source
req.missing('name')  // true if absent
req.filled('name')   // true if present AND non-empty
```

| Method | Returns | Throws |
|---|---|---|
| `input(key, fallback?)` | `unknown` | — |
| `string(key, fallback?)` | `string` | `InputTypeError` if value is object/array |
| `integer(key, fallback?)` | `number` | `InputTypeError` if not parseable |
| `float(key, fallback?)` | `number` | `InputTypeError` if not parseable |
| `boolean(key, fallback?)` | `boolean` | `InputTypeError` for unrecognised strings |
| `date(key, fallback?)` | `Date` | `InputTypeError` if not parseable |
| `array(key, fallback?)` | `unknown[]` | — (accepts arrays, CSV strings, JSON arrays) |

`boolean` truthy: `'true'`, `'1'`, `'yes'`, `'on'` — falsy: `'false'`, `'0'`, `'no'`, `'off'`.

### `InputTypeError`

Thrown when a value cannot be coerced to the requested type.

```ts
import { InputTypeError } from '@rudderjs/contracts'

if (err instanceof InputTypeError) { /* err.message: 'Input "age" expected integer, got string.' */ }
```

### `attachInputAccessors`

Attaches typed input methods to a plain request object. Called automatically by `@rudderjs/server-hono`. Only needed when building a custom server adapter.

```ts
import { attachInputAccessors } from '@rudderjs/contracts'
attachInputAccessors(req)
```

---

## `AppResponse`

Response builder passed alongside `AppRequest`.

```ts
import type { AppResponse } from '@rudderjs/contracts'
```

| Method | Signature | Description |
|---|---|---|
| `status` | `(code: number) => AppResponse` | Sets the HTTP status code. Returns `this` for chaining. |
| `header` | `(key: string, value: string) => AppResponse` | Appends a response header. Returns `this` for chaining. |
| `json` | `(data: unknown) => void` | Serialises `data` as JSON and sends the response. |
| `send` | `(body: string) => void` | Sends a plain text response. |
| `redirect` | `(url: string, code?: number) => void` | Issues an HTTP redirect. Defaults to `302`. |
| `raw` | `unknown` | The raw underlying response object from the server adapter. |

---

## `RouteHandler` and `MiddlewareHandler`

```ts
import type { RouteHandler, MiddlewareHandler } from '@rudderjs/contracts'

// Route handler — receives req and res
const handler: RouteHandler = async (req, res) => {
  res.json({ id: req.params['id'] })
}

// Middleware — receives req, res, and next
const auth: MiddlewareHandler = async (req, res, next) => {
  if (!req.headers['authorization']) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  await next()
}
```

```ts
type RouteHandler = (
  req: AppRequest,
  res: AppResponse,
) => unknown | Promise<unknown>

type MiddlewareHandler = (
  req: AppRequest,
  res: AppResponse,
  next: () => Promise<void>,
) => unknown | Promise<unknown>
```

---

## `HttpMethod`

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL'
```

`'ALL'` is a RudderJS-specific wildcard used by the router to match any HTTP method.

---

## `RouteDefinition`

```ts
interface RouteDefinition {
  method:     HttpMethod
  path:       string
  handler:    RouteHandler
  middleware: MiddlewareHandler[]
}
```

---

## `ServerAdapter` and `ServerAdapterProvider`

Implemented by server adapter packages (e.g. `@rudderjs/server-hono`). You do not implement these directly in application code.

```ts
interface ServerAdapter {
  registerRoute(route: RouteDefinition): void
  applyMiddleware(middleware: MiddlewareHandler): void
  listen(port: number, callback?: () => void): void
  getNativeServer(): unknown
}

interface ServerAdapterProvider {
  type: string
  create(): ServerAdapter
  createApp(): unknown
  createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<FetchHandler>
}

type FetchHandler = (
  request: Request,
  env?:    unknown,
  ctx?:    unknown,
) => Promise<Response>
```

---

## Notes

- No runtime code — `sideEffects: false`, fully tree-shakable.
- All types are re-exported from `@rudderjs/core` for convenience.
- Server adapters map their native request/response objects to `AppRequest`/`AppResponse`. The `raw` field provides escape-hatch access to adapter-specific APIs.
