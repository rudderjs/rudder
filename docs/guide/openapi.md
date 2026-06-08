# OpenAPI

`@rudderjs/openapi` generates an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) spec from your route table — no hand-written YAML. It reads the same typed declarations you already write (`:param` segments, `.query(schema)`, `.body(schema)`, and `.responds(schema)`) and emits paths, parameters, request bodies, and responses. Code-first REST docs, in the spirit of FastAPI and Scribe.

It's an **opt-in package** — never pulled into the kernel, and auto-discovery is off. Install it, and nothing changes until you ask for a spec or mount the docs route.

```bash
pnpm add @rudderjs/openapi
```

## Declaring responses — `.responds()`

The input side of a route is already typed ([path params](/guide/typed-routes), `.query()`, `.body()`). `.responds()` completes the picture by declaring what the route *returns* — the half OpenAPI needs to document the output:

```ts
import { Route } from '@rudderjs/router'
import { z } from 'zod'

Route.get('/api/users/:id', show)
  .name('users.show')
  .whereNumber('id')
  .responds(z.object({ id: z.number(), name: z.string() }))      // 200 by default
  .responds(404, z.object({ error: z.string() }))                 // explicit status
```

- `.responds(schema)` declares a `200` response.
- `.responds(status, schema)` declares any status code; call it multiple times for different codes.
- `.responds(status, schema, { description })` adds a human-readable description to the OpenAPI response object.
- A `z.union(...)` schema documents same-status variant shapes (emitted as `oneOf`).

`.responds()` is a **contract declaration**, not a runtime validator — it does not force the handler to return the declared shape (v1, same as OpenAPI everywhere). See [Typed Routes](/guide/typed-routes#typed-responses) for how it threads the response type onto the handler.

## Generating a spec

```bash
pnpm rudder openapi:generate                  # → openapi.json
pnpm rudder openapi:generate --yaml           # → openapi.yaml
pnpm rudder openapi:generate --out=public/api-spec.json
```

The command boots the app, walks `router.list()`, and writes the spec. The default output is `openapi.json` (or `openapi.yaml` with `--yaml`).

Programmatically:

```ts
import { generateOpenApiDocument } from '@rudderjs/openapi'
import { router } from '@rudderjs/router'

const doc = generateOpenApiDocument(router, {
  title:   'My API',
  version: '1.0.0',
  servers: [{ url: 'https://api.example.com' }],
})
```

### What the emitter reads from each route

| Route declaration | OpenAPI output |
|---|---|
| `:param` path segments | path parameters (`:id` → `{id}` templating) |
| `.whereNumber('id')` | path parameter typed as `integer` |
| `.name('users.show')` | `operationId` |
| `.query(schema)` | query parameters (one per top-level key) |
| `.body(schema)` | `requestBody` |
| `.responds(status, schema)` | `responses[status]` |

Routes with no declared response get a generic `200`. A named route's `.name()` becomes its `operationId`; unnamed routes get one auto-derived from the method + path. `operationId`s are de-duplicated across the document, and a single `all()` route fans out to one operation per method.

## Serving Swagger UI

`registerOpenApiRoutes()` mounts two GET routes — the spec JSON and an interactive Swagger UI page that loads it:

```ts
// routes/api.ts
import { router } from '@rudderjs/router'
import { registerOpenApiRoutes } from '@rudderjs/openapi'

registerOpenApiRoutes(router)
// → GET /docs           (Swagger UI)
// → GET /openapi.json   (the spec)

registerOpenApiRoutes(router, {
  path:     '/api-docs',
  specPath: '/api-docs/spec.json',
  info:     { title: 'My API', version: '2.0.0' },
})
```

The two routes exclude themselves from the generated spec, so `/docs` doesn't document `/docs`. When `info` is omitted, the title/version/servers come from `config('openapi')`.

::: warning Gate `/docs` in production
`registerOpenApiRoutes()` is opt-in by design and is **never** mounted automatically — an open `/docs` exposes your entire API surface. In production, register it inside an authenticated middleware group, or skip it entirely and ship the generated `openapi.json` artifact instead.
:::

## Configuration

Add a `config/openapi.ts` and the `OpenApiProvider` reads it for document defaults:

```ts
// config/openapi.ts
export default {
  title:    'My API',
  version:  '1.0.0',
  description: 'The public REST API.',
  servers:  [{ url: 'https://api.example.com', description: 'production' }],
  docsPath: '/docs',
  specPath: '/openapi.json',
}
```

```ts
// bootstrap/providers.ts — opt-in, so add it explicitly (auto-discovery is off)
import { OpenApiProvider } from '@rudderjs/openapi'

export default [
  ...(await defaultProviders()),
  OpenApiProvider,
]
```

The provider only binds the config — it deliberately does **not** serve `/docs` (that stays an explicit `registerOpenApiRoutes()` call, for the security reason above). If you only use `openapi:generate`, you don't need the provider at all.

| `config('openapi')` key | Default | Purpose |
|---|---|---|
| `title` | `'API'` | Document title |
| `version` | `'1.0.0'` | Document version |
| `description` | — | Document description |
| `servers` | — | `servers[]` block |
| `docsPath` | `'/docs'` | Swagger UI path |
| `specPath` | `'/openapi.json'` | Spec JSON path |

## Validator-agnostic (Standard Schema)

The emitter accepts any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType) for *typing*, but a spec needs JSON Schema, which Standard Schema doesn't standardize. So conversion runs through a small pluggable registry. Zod 4's native `z.toJSONSchema()` is registered by default (via the shared `@rudderjs/json-schema` package — the same converter `@rudderjs/ai` and `@rudderjs/mcp` use). For another validator, register its converter:

```ts
import { registerSchemaConverter } from '@rudderjs/openapi'
import { toJsonSchema } from '@valibot/to-json-schema'

registerSchemaConverter('valibot', (schema) => toJsonSchema(schema as never))
```

The emitter dispatches on the schema's `~standard` vendor tag. A route whose validator has **no** registered converter is warned about and that one schema is omitted — the rest of the document stays valid (the emitter never throws on a bad schema). A few Zod types are unrepresentable in JSON Schema (`z.date()`, `z.bigint()`) and degrade to an open schema with a warning rather than producing an invalid spec.

## Pitfalls

- **`.responds()` doesn't validate.** It documents the contract; it doesn't enforce that the handler returns the declared shape. Dev-mode response validation is a deferred follow-up.
- **An open `/docs` leaks your API.** `registerOpenApiRoutes()` is opt-in and unauthenticated by default — gate it behind auth in production or ship the static spec.
- **Unsupported schema nodes are dropped, not errored.** Watch the generation warnings — a `z.date()` field won't appear in the spec. Model dates as `z.string().datetime()` if you need them documented.
- **GraphQL is out of scope.** Rudder is SSR-first — `view()` already hands pages exactly their data, so REST is the core. A GraphQL layer, if ever, would be a separate opt-in package.
