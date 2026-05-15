---
'@rudderjs/router': minor
'@rudderjs/contracts': minor
'@rudderjs/core': patch
---

Typed routes: `Route.get('/users/:id', handler)` now types the handler's `req.params` from the `:param` segments in the literal path — pure TypeScript template-literal types, no codegen, no scanner. Reading `req.params.userId` on a route with `:id` is now a compile error. Optional segments (`:name?`) produce optional keys; regex constraints (`:id{[0-9]+}`) are stripped from the captured name; paths with no params type as `{}`. Plus a new opts form on every shorthand verb — `Route.get('/users/:id', { query: zodSchema }, handler)` — installs a Zod validator middleware AND types the handler's `req.query` as `z.infer<typeof schema>`. The parsed result replaces `req.query` in place at request time so `z.coerce.number()` works end-to-end. The `.query(schema)` chain method is available too for runtime-only validation when type narrowing isn't needed. `ValidationError` moved from `@rudderjs/core` to `@rudderjs/contracts` so `@rudderjs/router` can throw it without a circular dependency; `@rudderjs/core` re-exports the class so existing imports keep working. Existing routes compile unchanged — all generics default to today's shapes.
