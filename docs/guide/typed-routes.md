# Typed Routes

`Route.get('/users/:id', handler)` type-checks the handler's `req.params` against the `:param` segments in the path. Reading a parameter that isn't in the path is a TS error, not a runtime surprise.

```ts
// routes/web.ts
Route.get('/users/:id', (req) => {
  return req.params.id      // typed `string` ✓
  // return req.params.userId  // tsc: Property 'userId' does not exist
})
```

No codegen, no scanner, no `pnpm rudder routes:sync` to remember. The literal path *is* the type — TypeScript's template-literal types extract the params at the call site.

## Path-param extraction

```ts
Route.get('/users/:id/posts/:postId', (req) => {
  const id:     string = req.params.id      // typed
  const postId: string = req.params.postId  // typed
  return { id, postId }
})

Route.get('/files/:name?', (req) => {
  // Optional `:name?` produces an optional key
  const name: string | undefined = req.params.name
  return name
})
```

What's covered:

| Path                          | `req.params` shape          |
| ----------------------------- | --------------------------- |
| `/users/:id`                  | `{ id: string }`            |
| `/users/:id/posts/:postId`    | `{ id: string; postId: string }` |
| `/files/:name?`               | `{ name?: string }`         |
| `/users/:id{[0-9]+}`          | `{ id: string }` (regex constraint stripped from the name) |
| `/health`                     | `{}` (no params)            |
| `*`                           | `{}` (catch-all wildcard isn't a named param) |

::: tip `whereNumber` doesn't coerce
Path constraints (`whereNumber`, `whereUuid`, `whereIn`, `where`) restrict what the router *matches* — they don't coerce the captured value. `req.params.id` is always `string`, even with `.whereNumber('id')`. Use `.query(z.coerce.number())` (or `parseInt`) if you need a number.
:::

## Typed query — opts form

To type `req.query`, pass `{ query: zodSchema }` as the second argument:

```ts
import { z } from 'zod'

Route.get(
  '/users/:id',
  { query: z.object({ page: z.coerce.number().default(1), q: z.string().optional() }) },
  (req, res) => {
    const id:    string             = req.params.id    // from the path
    const page:  number             = req.query.page   // from the schema
    const q:     string | undefined = req.query.q
    return res.json({ id, page, q })
  },
)
```

What the opts form does:

1. **Types the handler.** `req.query` is inferred as `z.infer<typeof schema>` — `page` becomes `number` (after `z.coerce`), `q` is `string | undefined`, etc.
2. **Installs validation middleware.** At request time, the schema validates `req.query`. The parsed result *replaces* `req.query` in place, so `z.coerce.number()` actually gets you a number — not just at the type level, but at runtime too.
3. **Throws on failure.** Invalid query parameters surface as `ValidationError`, which the framework's exception handler renders as `422 Unprocessable Entity` with a JSON body of `{ message, errors }` — the same shape `FormRequest` produces.

## Runtime-only `.query()` chain

If you only want runtime validation and don't need the typed handler — for example, when the handler is in a separate file or you're chaining other builder methods — use the `.query()` chain:

```ts
Route.get('/users/:id', handler)
  .name('users.show')
  .whereNumber('id')
  .query(z.object({ page: z.coerce.number() }))  // runtime parse, no type narrowing
```

The validator runs at request time exactly like the opts form. The handler's closure type is *not* re-narrowed, though, because TypeScript can't go back and re-type a closure that was already passed. For type-safe query at the closure, use the opts form above.

## Typed body — opts form

`{ body: zodSchema }` types `req.body` the same way `{ query }` types `req.query`:

```ts
Route.post(
  '/posts',
  { body: z.object({ title: z.string(), tags: z.array(z.string()).default([]) }) },
  (req, res) => {
    const title: string   = req.body.title    // typed
    const tags:  string[] = req.body.tags     // typed (schema default applied)
    return res.json({ title, tags })
  },
)
```

What it does:

1. **Types the handler.** `req.body` is `z.infer<typeof schema>` — narrower than the default `unknown`.
2. **Installs validation middleware** that parses the *already-parsed* `req.body` (the server adapter populates `req.body` from JSON or form-encoded payloads before middleware runs). Parsed result replaces `req.body` in place, so `z.coerce.*`, `z.transform()`, and `.default()` are visible at the handler.
3. **Throws on failure.** Same `ValidationError` → `422` path as the query validator. Errors are keyed by Zod path: `{ "title": ["..."], "tags.0": ["..."] }`.

You can also combine both:

```ts
Route.put(
  '/posts/:id',
  {
    query: z.object({ draft: z.coerce.boolean().default(false) }),
    body:  z.object({ title: z.string(), body: z.string() }),
  },
  (req) => {
    const id:    string  = req.params.id   // from the path
    const draft: boolean = req.query.draft // from query schema
    const title: string  = req.body.title  // from body schema
    return { id, draft, title }
  },
)
```

### Runtime-only `.body()` chain

Mirrors `.query()` — runtime parsing, no closure re-typing:

```ts
Route.post('/posts', handler)
  .name('posts.store')
  .body(z.object({ title: z.string() }))
```

### Note on GET bodies

The opts form accepts `body` on every verb, including `GET` / `DELETE`. HTTP allows bodies on those methods but they're rarely used — the validator will simply find an empty `req.body` and fail (or pass, depending on whether the schema permits it). Prefer `{ query }` for `GET` / `DELETE` parameters.

## Typed `route()` URL generator

The `route(name, params)` URL helper can type-check its params against the path's `:params` once you declare your named routes in the `RouteRegistry` interface. The declaration is hand-written — there's no scanner, no codegen, no sync command. Put it in `env.d.ts` (or any `.d.ts` your tsconfig picks up):

```ts
// env.d.ts
declare module '@rudderjs/router' {
  interface RouteRegistry {
    'users.show':    '/users/:id'
    'comments.show': '/posts/:slug/comments/:cid'
    'files.show':    '/files/:name?'
  }
}
```

Now `route()` calls are type-checked:

```ts
route('users.show', { id: 1 })                  // ✓
route('users.show', { id: 1, page: 2 })          // ✓ extras → query string
route('comments.show', { slug: 'hi', cid: 7 })   // ✓
route('files.show', {})                          // ✓ name is optional

route('users.show', {})                          // ✗ TS: missing 'id'
route('comments.show', { slug: 'x' })            // ✗ TS: missing 'cid'
route('users.show', { id: true })                // ✗ TS: id must be string|number
```

`route()`'s **name** parameter stays `string` regardless of the registry — that keeps framework-internal callers and runtime-registered routes (`router.get(path).name(dynamicName)`) working without forcing every name into the type registry. Names not in the registry get the loose `Record<string, string | number>` params type (today's behavior). Typos in registered names fall through to that loose path and surface at runtime instead of compile time — `getNamedRoute(name)` returns `undefined` on unknown names and `route()` throws on the miss, so the failure is loud at first use.

If you want stricter compile-time name checking in your own code, wrap `route()` in a helper:

```ts
import { route, type RouteRegistry } from '@rudderjs/router'

export function namedRoute<N extends keyof RouteRegistry>(name: N, params: Parameters<typeof route<N>>[1]): string {
  return route(name, params)
}
```

Now `namedRoute('users.shwo', { id: 1 })` is a TS error (`users.shwo` isn't `keyof RouteRegistry`), while plain `route()` keeps its loose-name semantics for the framework.

## Adopting incrementally

There's no migration. Existing routes keep compiling unchanged — the new generic signatures default `req.params` to a derived shape (often `{}` for routes with no `:params`), `req.query` stays `Record<string, string>`, and `req.body` stays `unknown` until you opt into the relevant schema.

You can adopt the convention one route at a time:

- Add a `:param` to a path — `req.params.<name>` becomes typed.
- Wrap a handler in the opts form with `{ query: schema }` — `req.query` becomes typed.
- Wrap with `{ body: schema }` — `req.body` becomes typed.
- Combine both `{ query, body }` — both fields typed at the same call site.
- Declare your named routes in `RouteRegistry` — `route(name, params)` calls type-check.
- Switch to `FormRequest` if you need rich validation (custom rules, lifecycle hooks, separate authorize/messages). Typed routes are the lightweight path; `FormRequest` is the heavyweight one. Both can coexist in the same app.

## How it works

`@rudderjs/router` makes the shorthand methods (`get/post/put/patch/delete/all`) generic over the literal path type `P extends string`. A small set of template-literal types (`ExtractParams<P>`) walks the path at compile time and produces the params object shape:

```ts
type T1 = ExtractParams<'/users/:id'>                // { id: string }
type T2 = ExtractParams<'/users/:id/posts/:postId'>  // { id: string; postId: string }
type T3 = ExtractParams<'/files/:name?'>             // { name?: string }
```

The handler argument is `TypedRequest<ExtractParams<P>, Q, B>` — same as `AppRequest` but with `params`, `query`, and `body` overridden to the inferred shapes. Module-augmented fields (`req.user`, `req.session`, `req.token`, anything custom) come along automatically via `Omit + extend`.

For the opts form, each verb has four overloads ordered most-specific to least-specific: bare, `{ query, body }`, `{ query }`, `{ body }`. TypeScript picks the first matching one — the `{ query, body }` form must come before the single-schema forms or it would be shadowed. Validators install in order `query → body → user middleware` so the handler sees both fields parsed.

For `route(name, params)`, the `name` arg is `N extends string`. When `N` lands in `keyof RouteRegistry`, the `params` type narrows via `ParamsForName<N>` — `ExtractParams` walks the registered path string and produces `{ [K in :param]: string | number }` intersected with `Record<string, string | number>` so extras pass through to the query string.

## Comparison

This is Rudder's equivalent of:

- **Hono's typed `c.req.param()`** — same idea, packaged as `req.params.<name>` to match Express/Laravel ergonomics.
- **tRPC input validators** — same Zod-inferred-handler pattern, scoped to HTTP routes instead of RPC procedures.
- **Next.js typed routes** — Next types the *call site* (`<Link href>`). Rudder types the *handler*. Different ends of the same problem.

## Limitations

- **Closure typing requires the opts form.** `Route.get(path, handler).query(schema)` validates at runtime but does *not* re-type the handler's closure. Use `Route.get(path, { query: schema }, handler)` when you want both.
- **Decorator-based controllers don't get typed params today.** `@Get('/users/:id')` loses the literal type through the decorator metadata pipeline. Use the fluent API for typed params; the decorator API still works without types.
- **`route()` name strictness is soft, params strictness is hard.** Typos in registered names (`route('users.shwo', ...)`) fall through to the loose params type and surface at runtime — `getNamedRoute(name)` returns `undefined` and `route()` throws on the miss. Wrap `route()` in a helper that constrains `N extends keyof RouteRegistry` if you want compile-time name checking. See "Typed `route()` URL generator" above for the rationale (framework internals + runtime-registered routes).
- **Template-literal recursion is bounded.** TypeScript permits ~50 recursive template-literal expansions. A path with more than ~50 `:params` would hit the limit, but that's not a realistic case.
- **`exactOptionalPropertyTypes`** is enabled in the base tsconfig. An optional param `:name?` types as `{ name?: string }` — passing `{ name: undefined }` explicitly to anything reading the shape is rejected. Omit the key instead.
