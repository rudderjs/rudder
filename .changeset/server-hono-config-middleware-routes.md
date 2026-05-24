---
"@rudderjs/server-hono": minor
---

feat(server-hono): mount Vike config-declared middlewares as direct routes

`createFetchHandler` now passes Vike's config middlewares (https://vike.dev/middleware)
to `vike(app, …)`, so they mount as their own routes ahead of the SSR catch-all
instead of only being dispatched from inside the catch-all's `renderPageServer`.

This is load-bearing for React Server Components: `vike-react-rsc` declares a
`/_rsc` middleware that itself calls `renderPageServer`. Reached only via the
catch-all, that became a re-entrant `renderPageServer` (catch-all renders, then
dispatches `/_rsc`, which renders again) — which tripped Vike's dev request
logger and 500'd `"use server"` actions. A direct route renders `/_rsc` once.

No-op for renderers without config middlewares (e.g. `vike-react`): `vike(app, [])`
is identical to `vike(app)`. Resolution is best-effort — if Vike's global context
isn't ready at setup time, the catch-all (which still dispatches config
middlewares internally) is used as before.
