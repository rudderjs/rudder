# @rudderjs/contracts

Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters.

```bash
pnpm add @rudderjs/contracts
```

This package contains framework-level contracts and a small set of runtime helpers. All `@rudderjs/*` packages depend on it as the shared type language for HTTP primitives.

---

## Overview

| Export | Kind | Description |
|---|---|---|
| `AppRequest` | Interface | Normalised incoming HTTP request with typed input accessors. |
| `AppResponse` | Interface | Response builder — fluent methods for status, headers, JSON, text, and redirects. |
| `InputTypeError` | Class | Thrown by typed request accessors when coercion fails. |
| `attachInputAccessors` | Function | Attaches typed input methods to a plain request object (used by server adapters). |
| `RouteHandler` | Type alias | `(req: AppRequest, res: AppResponse) => unknown \| Promise<unknown>` |
| `MiddlewareHandler` | Type alias | `(req: AppRequest, res: AppResponse, next: () => Promise<void>) => unknown \| Promise<unknown>` |
| `HttpMethod` | Union type | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'HEAD' \| 'OPTIONS' \| 'ALL'` |
| `RouteDefinition` | Interface | Describes a registered route — `method`, `path`, `handler`, `middleware`. |
| `ServerAdapter` | Interface | Implemented by server adapter packages. |
| `ServerAdapterProvider` | Interface | Used internally by `Application.configure()` to wire a server adapter. |
| `FetchHandler` | Type alias | `(req: Request, env?, ctx?) => Promise<Response>` — WinterCG-compatible handler. |

---

## `AppRequest`

```ts
interface AppRequest {
  method:  string
  url:     string
  path:    string
  params:  Record<string, string>
  query:   Record<string, string>
  headers: Record<string, string>
  body:    unknown
  raw:     unknown

  // Typed input accessors — merge order: params > body > query
  input<T = unknown>(key: string, fallback?: T): T
  string(key: string, fallback?: string): string
  integer(key: string, fallback?: number): number
  float(key: string, fallback?: number): number
  boolean(key: string, fallback?: boolean): boolean
  date(key: string, fallback?: Date): Date
  array(key: string, fallback?: unknown[]): unknown[]
  has(key: string): boolean
  missing(key: string): boolean
  filled(key: string): boolean
}
```

**Fields**

| Field | Description |
|---|---|
| `method` | HTTP method in uppercase (`'GET'`, `'POST'`, etc.). |
| `url` | Full request URL including query string. |
| `path` | URL pathname without query string. |
| `params` | Route parameters (e.g. `/users/:id` → `{ id: '1' }`). |
| `query` | Parsed query string parameters. |
| `headers` | Lowercased request headers. |
| `body` | Parsed request body. JSON bodies are parsed by the server adapter. |
| `raw` | Raw underlying request from the server adapter. Cast to access adapter-specific APIs. |

**Typed input accessors**

Merge order: `params` > `body` > `query`. Route params have the highest priority.

```ts
// In a route handler:
const name   = req.string('name')            // '' if missing
const age    = req.integer('age', 18)        // 18 if missing
const active = req.boolean('active', false)  // 'true'/'1'/'yes' → true
const ids    = req.array('ids', [])          // accepts CSV or JSON array strings
const date   = req.date('created_at')        // parsed Date

req.has('name')      // true if key present in any input source
req.missing('email') // true if absent
req.filled('name')   // true if present AND non-empty
```

| Method | Returns | Throws on bad value |
|---|---|---|
| `input(key, fallback?)` | `unknown` | — |
| `string(key, fallback?)` | `string` | object/array value |
| `integer(key, fallback?)` | `number` | non-numeric string |
| `float(key, fallback?)` | `number` | non-numeric string |
| `boolean(key, fallback?)` | `boolean` | unrecognised string |
| `date(key, fallback?)` | `Date` | unparseable string |
| `array(key, fallback?)` | `unknown[]` | — |

`boolean` truthy values: `'true'`, `'1'`, `'yes'`, `'on'`. Falsy: `'false'`, `'0'`, `'no'`, `'off'`.

### `InputTypeError`

Thrown when a typed accessor cannot coerce the value:

```ts
import { InputTypeError } from '@rudderjs/contracts'

// err.message → 'Input "age" expected integer, got string.'
if (err instanceof InputTypeError) { ... }
```

---

## `AppResponse`

```ts
interface AppResponse {
  status(code: number): AppResponse
  header(key: string, value: string): AppResponse
  json(data: unknown): void
  send(body: string): void
  redirect(url: string, code?: number): void
  raw: unknown
}
```

`status()` and `header()` return `this` for chaining. `json()`, `send()`, and `redirect()` are terminal — they send the response and return `void`.

```ts
res.status(422).header('X-Custom', 'value').json({ error: 'Invalid' })
```

---

## `RouteHandler` and `MiddlewareHandler`

```ts
import type { RouteHandler, MiddlewareHandler } from '@rudderjs/contracts'

const handler: RouteHandler = async (req, res) => {
  res.json({ id: req.params['id'] })
}

const auth: MiddlewareHandler = async (req, res, next) => {
  if (!req.headers['authorization']) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  await next()
}
```

`next` takes no arguments — it advances the middleware pipeline.

---

## `HttpMethod`

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL'
```

`'ALL'` is a RudderJS-specific wildcard used by the router to match any HTTP method.

---

## `ServerAdapter`

Implemented by server adapter packages (e.g. `@rudderjs/server-hono`). Not implemented directly in application code.

```ts
interface ServerAdapter {
  registerRoute(route: RouteDefinition): void
  applyMiddleware(middleware: MiddlewareHandler): void
  listen(port: number, callback?: () => void): void
  getNativeServer(): unknown
}
```

---

## `ServerAdapterProvider`

The shape returned by adapter factory functions like `hono(config)`. Consumed by `Application.configure({ server })`.

```ts
interface ServerAdapterProvider {
  type: string
  create(): ServerAdapter
  createApp(): unknown
  createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<FetchHandler>
}
```

---

## Notes

- No runtime code — `sideEffects: false`, fully tree-shakable.
- All types are re-exported from `@rudderjs/core` — install `@rudderjs/contracts` directly only when building adapters or packages that must not depend on `@rudderjs/core`.
- The `raw` field on both `AppRequest` and `AppResponse` provides escape-hatch access to adapter-specific APIs when needed.
- Module augmentation on `AppRequest` (e.g. adding `session`) is supported — declare it in your package or app alongside the import.
