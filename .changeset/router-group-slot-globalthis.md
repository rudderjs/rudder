---
'@rudderjs/router': patch
---

Hoist the `runWithGroup` / `currentGroup` "current group" slot to `globalThis`
so it survives bundle duplication. Vite-built SSR apps can load
`@rudderjs/router` twice: once via `@rudderjs/core`'s
`await import('@rudderjs/router')` in `_taggedLoader` (resolves to the linked
workspace dist) and once via the SSR chunk that the user's `routes/web.ts`
statically imports (resolves to a vite-bundled copy). With a plain
module-level `let _currentGroup`, `runWithGroup('web', loader)` wrote to one
copy's slot and `currentGroup()` (called by `_rb` / `registerController` from
the other copy) read `undefined` — every route silently got `group:
undefined`, and all web-group middleware (Session / Auth / RateLimit / Csrf)
no-op'd for every request. Caught by the Phase 4 scaffolder auth-flow E2E:
`POST /auth/sign-up/email` reached its handler without `AuthMiddleware` ever
running, so `Auth.login()` → `currentAuth()` threw "No auth context" on a
request that LOOKED routed correctly. Same pattern as #498/#500–#507/#516.
