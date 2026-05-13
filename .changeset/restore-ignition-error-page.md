---
'@rudderjs/core': patch
---

fix(core): restore Ignition-style dev error page on unhandled exceptions

Re-throw unhandled errors from `buildHandler()` when `app.debug` is true AND
the client wants HTML, so the adapter's rich dev error page (server-hono's
Ignition-style `renderErrorPage` with stack frames + source context) fires
instead of the plain card-style fallback.

The card page in `exceptions.ts::htmlPage()` was always meant to be a
production-safe last resort. From 2026-04-06 (when the central error
pipeline landed) until now, every unhandled 500 went through it — even in
dev with `APP_DEBUG=true` — because step 6 of the pipeline returned a
`Response` instead of bubbling. The adapter's dev page was effectively
dead code.

Prod (`debug === false`) and JSON-accepting clients (regardless of debug)
keep their current behavior: prod uses the safe card page (no source
leak), JSON clients get a structured 500. Recognized exception types
(`HttpException`, `ValidationError`, custom renderers via
`.withExceptions((e) => e.render(...))`) bypass step 6 entirely and are
unaffected.

`wantsJson` is now exported from `@rudderjs/core/exceptions` with an
`@internal` tag so the pipeline can route on it. Not part of the public
API surface — adapter authors and userland should not depend on it.
