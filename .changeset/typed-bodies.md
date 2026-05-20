---
"@rudderjs/router": minor
---

feat: typed request bodies — `.body(zodSchema)` and `{ body: zodSchema }` opts form

Completes the typed-routes story. Path params, query, AND body are now end-to-end typed from a single Zod schema declaration.

```ts
Route.post(
  '/posts/:slug',
  { body: z.object({ title: z.string(), views: z.coerce.number() }) },
  (req) => {
    const slug:  string = req.params.slug   // from the path
    const title: string = req.body.title    // from the body schema
    const views: number = req.body.views    // coerced
    return { slug, title, views }
  },
)
```

The opts form now supports three new shapes per verb:

- `{ body: schema }` — types `req.body`, leaves `req.query` as `Record<string, string>`
- `{ query: schema, body: schema }` — both typed
- `.body(schema)` chainable — runtime validation only (closure already typed)

Validators install in order `query → body → user middleware`. Parsed result replaces `req.body` in place so `z.coerce.*`, `z.transform()`, and `.default()` are visible at the handler. Validation failure surfaces as the same `ValidationError` → `422` path as `{ query }` and `FormRequest`, with errors keyed by Zod path.

`TypedRequest<P, Q, B>` and `TypedHandler<P, Q, B>` gain a third generic `B = unknown` (defaulted for backward compatibility — bare-form routes keep their current `req.body: unknown` typing).
