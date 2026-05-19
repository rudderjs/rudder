---
'@rudderjs/auth': patch
---

Route the request-scoped `AuthManager` `AsyncLocalStorage` through `globalThis`
so duplicate bundles of `@rudderjs/auth` share one ALS instance. Vite/Rollup
will sometimes inline `auth-manager.js` into more than one SSR chunk (one
reached via `AuthMiddleware` from the Provider, one reached via the user's
`import { auth } from '@rudderjs/auth'`). Without this hoist, AuthMiddleware
writes the manager into one ALS while `auth().user()` reads from another, and
the handler sees `[RudderJS Auth] No auth context. Use AuthMiddleware.` even
on requests that did pass through the middleware. Caught by the new Phase 3
scaffolder render-check matrix. Same pattern as the static-state singleton
audit (#498/#500–#507/#516).
