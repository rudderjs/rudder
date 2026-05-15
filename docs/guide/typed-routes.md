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

## Adopting incrementally

There's no migration. Existing routes keep compiling unchanged — the new generic signatures default `req.params` to a derived shape (often `{}` for routes with no `:params`), and `req.query` stays `Record<string, string>` until you opt into `{ query: schema }`.

You can adopt the convention one route at a time:

- Add a `:param` to a path — `req.params.<name>` becomes typed.
- Wrap a handler in the opts form — `req.query` becomes typed against the schema.
- Switch to `FormRequest` if you need rich validation (custom rules, lifecycle hooks, separate authorize/messages). Typed routes are the lightweight path; `FormRequest` is the heavyweight one. Both can coexist in the same app.

## How it works

`@rudderjs/router` makes the shorthand methods (`get/post/put/patch/delete/all`) generic over the literal path type `P extends string`. A small set of template-literal types (`ExtractParams<P>`) walks the path at compile time and produces the params object shape:

```ts
type T1 = ExtractParams<'/users/:id'>                // { id: string }
type T2 = ExtractParams<'/users/:id/posts/:postId'>  // { id: string; postId: string }
type T3 = ExtractParams<'/files/:name?'>             // { name?: string }
```

The handler argument is `TypedRequest<ExtractParams<P>, Q>` — same as `AppRequest` but with `params` and `query` overridden to the inferred shapes. Module-augmented fields (`req.user`, `req.session`, `req.token`, anything custom) come along automatically via `Omit + extend`.

For the opts form, the second overload captures the Zod schema's type parameter and threads `z.infer<S>` into the handler's `TypedRequest`. At runtime, the validator middleware is installed first in the per-route chain.

## Comparison

This is RudderJS's equivalent of:

- **Hono's typed `c.req.param()`** — same idea, packaged as `req.params.<name>` to match Express/Laravel ergonomics.
- **tRPC input validators** — same Zod-inferred-handler pattern, scoped to HTTP routes instead of RPC procedures.
- **Next.js typed routes** — Next types the *call site* (`<Link href>`). RudderJS types the *handler*. Different ends of the same problem.

## Limitations

- **Closure typing requires the opts form.** `Route.get(path, handler).query(schema)` validates at runtime but does *not* re-type the handler's closure. Use `Route.get(path, { query: schema }, handler)` when you want both.
- **Decorator-based controllers don't get typed params today.** `@Get('/users/:id')` loses the literal type through the decorator metadata pipeline. Use the fluent API for typed params; the decorator API still works without types.
- **Template-literal recursion is bounded.** TypeScript permits ~50 recursive template-literal expansions. A path with more than ~50 `:params` would hit the limit, but that's not a realistic case.
- **`exactOptionalPropertyTypes`** is enabled in the base tsconfig. An optional param `:name?` types as `{ name?: string }` — passing `{ name: undefined }` explicitly to anything reading the shape is rejected. Omit the key instead.
