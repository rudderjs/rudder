# @rudderjs/contracts

Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters.

```bash
pnpm add @rudderjs/contracts
```

This package is **type-only** — it contains no runtime code. All `@rudderjs/*` packages depend on it as the shared type language for HTTP primitives. Prefer `import type` in application code.

---

## Overview

| Type | Kind | Description |
|---|---|---|
| `AppRequest` | Interface | Normalised incoming HTTP request passed to route handlers and middleware. |
| `AppResponse` | Interface | Response builder — fluent methods for status, headers, JSON, text, and redirects. |
| `RouteHandler` | Type alias | `(req: AppRequest, res: AppResponse) => unknown \| Promise<unknown>` |
| `MiddlewareHandler` | Type alias | `(req: AppRequest, res: AppResponse, next: () => Promise<void>) => unknown \| Promise<unknown>` |
| `HttpMethod` | Union type | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'HEAD' \| 'OPTIONS' \| 'ALL'` |
| `RouteDefinition` | Interface | Describes a registered route — `method`, `path`, `handler`, `middleware`. |
| `ServerAdapter` | Interface | Implemented by server adapter packages — `registerRoute`, `applyMiddleware`, `listen`, `getNativeServer`. |
| `ServerAdapterProvider` | Interface | Used internally by `Application.configure()` to wire a server adapter into bootstrap. |
| `ServerAdapterFactory` | Type alias | `<TConfig>(config?: TConfig) => ServerAdapterProvider` — shape of `hono()`, etc. |
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
}
```

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
