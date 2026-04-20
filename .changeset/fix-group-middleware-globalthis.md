---
'@rudderjs/core': patch
---

Move the provider group-middleware store from module scope to `globalThis`.

`appendToGroup()` and `resetGroupMiddleware()` in `@rudderjs/core` used to
persist middleware in a module-level `const` — which silently broke any time
the consumer app loaded two `@rudderjs/core` instances (e.g. pnpm-linked
workspace package + installed npm copy of any framework package). Each core
instance had its own private store: provider `boot()` wrote to store A, the
server read store B, middleware silently vanished. The user-visible symptom
was `No auth context. Use AuthMiddleware.` when linking a workspace auth
package into a consumer app that had the rest of `@rudderjs/*` from npm.

The store is now pinned on `globalThis.__rudderjs_group_middleware__` so
every `@rudderjs/core` instance shares one object — same pattern the
`ai/mcp/http/gate/live` observer registries already use. Zero API change.
Added three tests covering the new invariant + existing reset semantics.
