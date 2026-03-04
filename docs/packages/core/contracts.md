# @boostkit/contracts

Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters.

```bash
pnpm add @boostkit/contracts
```

---

## Overview

`@boostkit/contracts` is a type-only package. It contains no runtime code — only TypeScript interfaces and type aliases. All other `@boostkit/*` packages depend on it as the shared language for HTTP primitives. Use `import type` when consuming these types in application code.

---

## Usage

```ts
import type {
  AppRequest,
  AppResponse,
  MiddlewareHandler,
  RouteDefinition,
  ServerAdapter,
  FetchHandler,
} from '@boostkit/contracts'

// Type a route handler
const handler = async (req: AppRequest, res: AppResponse) => {
  const { id } = req.params
  return res.json({ id })
}

// Type a middleware
const auth: MiddlewareHandler = async (req, res, next) => {
  const token = req.headers['authorization']
  if (!token) return res.status(401).json({ message: 'Unauthorized' })
  return next(req, res)
}

// Type a server adapter factory
const myAdapter: ServerAdapterFactory = (config) => ({
  createServer: (handler) => { /* ... */ },
})
```

---

## API Reference

| Type | Kind | Description |
|---|---|---|
| `AppRequest` | Interface | Normalised incoming HTTP request passed to route handlers and middleware. |
| `AppResponse` | Interface | Response builder passed alongside `AppRequest` — fluent methods for JSON, status, headers, and redirects. |
| `RouteHandler` | Type alias | `(req: AppRequest, res: AppResponse) => unknown \| Promise<unknown>` |
| `MiddlewareHandler` | Type alias | `(req: AppRequest, res: AppResponse, next: NextFn) => unknown \| Promise<unknown>` |
| `HttpMethod` | Union type | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'HEAD' \| 'OPTIONS'` |
| `RouteDefinition` | Interface | Describes a registered route — `method`, `path`, `handler`, optional `middleware`. |
| `ServerAdapter` | Interface | Runtime server adapter returned by an adapter factory — `createServer(handler)`, `listen(port)`, `close()`. |
| `ServerAdapterFactory` | Type alias | `(config: unknown) => ServerAdapter` — the shape of `hono()`, `express()`, etc. |
| `ServerAdapterProvider` | Interface | Used internally by `Application.configure()` to wire the adapter into the bootstrap. |
| `FetchHandler` | Type alias | `(req: Request) => Promise<Response>` — WinterCG-compatible fetch handler, used by `BoostKit.handleRequest`. |

---

## AppRequest Fields

| Field | Type | Description |
|---|---|---|
| `method` | `HttpMethod` | HTTP method in uppercase. |
| `path` | `string` | URL pathname, without query string. |
| `params` | `Record<string, string>` | Route parameters extracted from the path pattern (e.g. `/users/:id` → `{ id: '1' }`). |
| `query` | `Record<string, string>` | Parsed query string parameters. |
| `body` | `unknown` | Parsed request body. JSON bodies are parsed automatically by the server adapter. |
| `headers` | `Record<string, string>` | Lowercased request headers. |
| `raw` | `unknown` | The raw underlying request object from the server adapter (e.g. Hono `Context`). Cast as needed. |

---

## AppResponse Methods

| Method | Signature | Description |
|---|---|---|
| `json` | `(data: unknown) => Response` | Serialises `data` as JSON and sets `Content-Type: application/json`. |
| `status` | `(code: number) => AppResponse` | Sets the HTTP status code. Returns `this` for chaining. |
| `send` | `(body: string) => Response` | Sends a plain text response. |
| `redirect` | `(url: string, code?: number) => Response` | Issues an HTTP redirect. Defaults to `302`. |
| `header` | `(key: string, value: string) => AppResponse` | Appends a response header. Returns `this` for chaining. |

---

## Notes

- This package contains no runtime code. Bundlers with `sideEffects: false` support will tree-shake it completely.
- Prefer `import type` in application-level files to guarantee zero runtime cost.
- Server adapters (e.g. `@boostkit/server-hono`) are responsible for mapping their native request/response objects to `AppRequest` / `AppResponse`.
- The `raw` field on `AppRequest` gives escape-hatch access to adapter-specific APIs when needed (e.g. reading cookies from the Hono context).
