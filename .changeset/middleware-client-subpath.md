---
"@rudderjs/middleware": minor
"@rudderjs/cache": patch
"@rudderjs/auth": patch
---

Add `@rudderjs/middleware/client` subpath export for browser-safe helpers. `getCsrfToken()` now lives at this subpath so it can be imported from view code without dragging `@rudderjs/cache`, `node:crypto`, and the rate-limit machinery into the client bundle.

The main entry still re-exports `getCsrfToken` for backward compatibility, but browser code should import from `@rudderjs/middleware/client`. The four vendored auth views (`Login`, `Register`, `ForgotPassword`, `ResetPassword` under `packages/auth/views/react/`) are updated to use the new subpath — fresh `create-rudder-app` projects will pick up the fix on next install.

Also replaces `randomUUID` from `node:crypto` with `globalThis.crypto.randomUUID()` in `@rudderjs/cache`'s lock implementation. Both Node 18+ and modern browsers expose the Web Crypto API, so the module no longer crashes when transitively pulled into a client bundle. Fixes the `Module "node:crypto" has been externalized for browser compatibility` runtime error on `/login` and other CSRF-protected forms.
