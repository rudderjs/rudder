---
"@rudderjs/vite": minor
---

Dev HMR: add a `watch` option to hot-reload linked/workspace packages, and fix a routes-loss regression in the scoped invalidation.

**`rudderjs({ watch: ['@scope/pkg'] })`** — watch extra packages (or absolute dirs) for dev HMR. Editing a watched package's source now re-bootstraps the app like an `app/` edit, with no server restart — for packages that register routes, views, or config in a service provider's `boot()`. Package-name entries are also added to `ssr.noExternal` **in dev only**, so Vite owns them in the SSR module graph and re-evaluates them on change (Node's ESM import cache can't be evicted, so an externalized package would otherwise keep re-reading its stale source). Resolution is exports-agnostic — it finds the package directory without tripping `ERR_PACKAGE_PATH_NOT_EXPORTED` on ESM-only packages — and resolves through pnpm/workspace symlinks to the realpath.

**Fix (regression from the scoped-invalidation change):** the dev re-boot calls `router.reset()` and re-runs the route loaders, which re-import `routes/*.ts`. After scoped invalidation, a backend edit that didn't touch a route's import chain (a `bootstrap/`, `config/`, or unrelated `app/` file) left those route modules cached, so they never re-ran their registration and every loader-registered route 404'd until a route file was edited or the server restarted. The route loader modules are now always re-evaluated on a re-boot.
