---
'@rudderjs/vite': major
---

Graduate to 1.0.0.

The `rudderjs()` Vite plugin is now stable. Calling it returns the full plugin bundle that powers every RudderJS app:

- `rudderjs:config` — SSR externals for server-only packages, `@/` and `App/` path aliases
- `rudderjs:ip` — dev-only `x-real-ip` header injection from the Node socket
- `rudderjs:ws` — WebSocket upgrade handler shared by `@rudderjs/broadcast` and `@rudderjs/sync`
- `rudderjs:routes` — HMR watcher that invalidates SSR modules and clears framework singletons when `routes/`, `bootstrap/`, or `app/` changes
- `rudderjs:views` — view scanner that discovers `app/Views/**` and generates Vike pages under `pages/__view/`, with auto-detection for `vike-react` / `vike-vue` / `vike-solid` / vanilla HTML-string mode

Every playground build and every scaffolded app has exercised this plugin daily — the API has been frozen-in-practice for some time. 1.0 just makes that contract explicit.
