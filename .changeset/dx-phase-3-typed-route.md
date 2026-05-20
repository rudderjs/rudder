---
"@rudderjs/router": minor
---

feat(router): typed `route(name, params)` URL generator

Caps the typed-routes story from #482 + #564. The URL generator's `params` arg now type-checks against the path's `:params` once you declare your named routes in the `RouteRegistry` interface:

```ts
// env.d.ts
declare module '@rudderjs/router' {
  interface RouteRegistry {
    'users.show':    '/users/:id'
    'comments.show': '/posts/:slug/comments/:cid'
  }
}
```

```ts
route('users.show', { id: 1 })                  // ✓
route('users.show', { id: 1, page: 2 })          // ✓ extras → query string
route('comments.show', { slug: 'hi', cid: 7 })   // ✓
route('users.show', {})                          // ✗ TS: missing 'id'
route('users.show', { id: true })                // ✗ TS: id must be string|number
```

**Soft name strictness, hard params strictness.** `name` stays `string` so framework internals + runtime-registered routes keep working. When the name matches a registered key, `params` narrows to the typed shape. Names not in the registry get the loose `Record<string, string | number>` — today's behavior, fully backward compatible. Apps wanting strict name-checks wrap `route()` in a `<N extends keyof RouteRegistry>` helper (documented).

New exports from `@rudderjs/router`:
- `RouteRegistry` — empty interface, augment via declaration merging
- `ParamsForName<N>` — derived params type for a registered name

Phase 3 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Phase 4 (`make:factory` + `make:seeder` scaffolders) still pending.
