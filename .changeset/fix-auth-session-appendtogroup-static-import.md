---
'@rudderjs/auth': patch
'@rudderjs/session': patch
---

Fix `appendToGroup` auto-install in WebContainer / restrictive runtimes

Both `AuthProvider.boot()` and `SessionProvider.boot()` previously used a
dynamic `await import('@rudderjs/core')` wrapped in a silent `try/catch` to
grab `appendToGroup`. The dynamic import was unnecessary — both files
already statically import other symbols from `@rudderjs/core` — and the
catch swallowed any module-resolution error without logging.

In WebContainer (StackBlitz) the dynamic import fails for reasons related
to pnpm symlink resolution under WASI-Node, so the catch silently dropped
the auto-install. Apps ended up booting without `SessionMiddleware` and
`AuthMiddleware` on the `web` group, causing `auth().user()` to throw
"No auth context" on any web route.

Use the static import. No catch.
