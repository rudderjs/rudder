---
"@rudderjs/router": minor
---

feat(router): add Url.resetKey() and Url.getKey() for the signed-URL signing key

`Url.setKey()` mutates process-wide module state with no way to undo or inspect
it, so a `setKey()` in a test's `beforeEach` without matching teardown silently
poisons every later test in the same worker (signatures verify against the
wrong key and fail with an opaque 403). Adds `Url.resetKey()` (restores the
`APP_KEY` fallback) and `Url.getKey()` (reads the current override), and
documents the global-mutation behavior on `setKey()`.
