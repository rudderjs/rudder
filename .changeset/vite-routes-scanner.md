---
"@rudderjs/vite": minor
---

Add a routes scanner that auto-populates `@rudderjs/router`'s `RouteRegistry` interface from `.name('foo')` calls in `routes/*.ts`.

```ts
// routes/web.ts
Route.get('/users/:id', usersShow).name('users.show')

// Anywhere:
route('users.show', { id: 1 })          // ✓ types-check
route('users.show', {})                  // ✗ TS: missing 'id'
route('users.shwo', { id: 1 })           // ✗ TS: unknown route name
```

Mechanism: the new `routesScannerPlugin` (auto-registered by `rudderjs()`) walks `routes/*.ts` (and nested subdirs), regex-extracts `(verb, path, name)` triples from chains like `Route.<verb>('path', ...).name('foo')`, and emits `pages/__view/routes.d.ts` augmenting the `RouteRegistry` interface. Watches the routes directory for changes and re-emits incrementally.

**Picks up**: literal-path AND literal-name chains on the same expression. Multi-line tolerant. Negative-lookahead in the regex ensures a chain without `.name()` followed later by a different chain that DOES name a route can't silently bridge.

**Does not pick up** (intentional, documented):

- Variable paths (`router.get(loginPath, ...).name('login')`)
- Variable names (`.name(LOGIN_ROUTE_NAME)`)
- Routes registered inside helper functions (e.g. `registerAuthRoutes(router)`) — those live in package source and run at boot time. Apps that need them in `RouteRegistry` hand-augment the interface manually; the scanner's emit merges with manual augmentations via declaration merging.

Also adds a `routes:sync` CLI command (`pnpm rudder routes:sync`) for one-shot regeneration outside of Vite — useful in CI (typecheck-before-build) and on fresh clones before the first `pnpm dev`. Skip-boot, so it works before `@prisma/client` etc. exist.
