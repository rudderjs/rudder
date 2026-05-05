---
'@rudderjs/router': minor
---

Add Laravel-style `where*()` constraint shortcuts to `RouteBuilder` (Laravel parity #5, PR1 of 3).

**Public API on `RouteBuilder`:**

- `where(param, regex)` — base method; accepts a string pattern or a `RegExp` (uses `.source`).
- `whereNumber(param)` — `[0-9]+`.
- `whereAlpha(param)` — `[A-Za-z]+`.
- `whereAlphaNumeric(param)` — `[A-Za-z0-9]+`.
- `whereUuid(param)` — UUID of any version.
- `whereUlid(param)` — Crockford base32 ULID (26 chars).
- `whereIn(param, values)` — alternation over regex-escaped literal values.

```ts
router.get('/users/:id', handler).whereNumber('id').name('users.show')
// → /users/:id{[0-9]+}, named users.show
router.get('/posts/:status', handler).whereIn('status', ['draft', 'published'])
```

Mutates `definition.path` in place to Hono's `:param{regex}` syntax. Throws when the path has no `:param` segment, or when `whereIn` is given an empty values array. Order-independent against `.name()`: chaining `where*()` after `.name()` still updates the registered named-route path.

**Exported pattern constants** — `ROUTE_PATTERN_NUMBER`, `_ALPHA`, `_ALPHANUM`, `_UUID`, `_ULID` — for apps that need to compose their own Hono constraint strings.

**Internal:** `route()` URL generator and the route-binding param scanner now use a balanced-brace stripper so nested quantifier braces inside constraints (e.g. UUID's `{8}`/`{4}`) don't trip the `:param` regex.

This is PR1 of the router parity sweep. Subdomain routing, `missing()`, `Route::resource`, and `make:controller --resource` follow in PR2/PR3.
