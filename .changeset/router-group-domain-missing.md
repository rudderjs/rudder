---
'@rudderjs/router': minor
'@rudderjs/contracts': minor
'@rudderjs/server-hono': patch
---

Add Laravel-style `router.group()`, subdomain routing, and `.missing()` 404 customisation (Laravel parity #5, PR2 of 3).

**`router.group(opts, fn)`** — apply a `prefix`, `domain`, or `middleware` stack to every route registered in the callback. Nested groups concatenate prefixes and middleware; the innermost defined `domain` wins.

```ts
router.group({ prefix: '/admin', middleware: [adminAuth] }, () => {
  router.get('/users', listUsers)            // GET /admin/users (with adminAuth)
})

router.group({ domain: ':tenant.example.com', prefix: '/api' }, () => {
  router.get('/me', me)                      // GET :tenant.example.com/api/me
})
```

Distinct from `runWithGroup('web' | 'api', …)` — that tags routes with their middleware-group label, this is the user-facing scoping primitive. Both can be active at the same time.

**`RouteBuilder.domain(template)`** — restrict a route to a host. Templates accept `:param` segments that capture into `req.params` alongside path params. Mismatched hosts return 404. Per-route `.domain()` overrides any `domain` set by an active group.

```ts
router.get('/users', listUsers).domain('api.example.com')
router.get('/me', me).domain(':tenant.example.com')   // req.params.tenant
```

**`RouteBuilder.missing(fn)`** — custom response when an explicit `router.bind('user', User)` resolves to `null`. Receives `(req, err)` and returns any value a route handler may return: `Response`, plain object → JSON, string → body, or `undefined` (callback wrote to `res` directly). Optional bindings do NOT trigger `.missing()`.

```ts
router.get('/users/:user', show)
  .missing((_req, err) => Response.json({ error: err.message }, { status: 404 }))
```

**Contract additions (`@rudderjs/contracts`)** — `RouteDefinition` gains two optional fields: `host?: string` and `missing?: (req, err) => unknown | Promise<unknown>`. The `err` is duck-typed (`httpStatus`, `param`, `value`, `model`) so contracts stays free of `@rudderjs/router`.

**`@rudderjs/server-hono`** — pre-handler host gate (`matchHost()`) returns 404 on host mismatch and stashes captured subdomain `:param` segments on the Hono context. `normalizeRequest()` merges them into `req.params`; path params win on collision.

This is PR2 of the router parity sweep. `Route::resource` / `apiResource` / `singleton` and `make:controller --resource` follow in PR3.
