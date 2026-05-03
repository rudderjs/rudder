---
'@rudderjs/view':          patch
'@rudderjs/localization':  patch
'@rudderjs/concurrency':   patch
---

test: fill coverage gaps

- `@rudderjs/view`: `view()` with no props defaults to `{}`, `isViewResponse(undefined)` returns `false`, `SafeString.toString()` returns the raw value.
- `@rudderjs/localization`: `trans()` caching round-trip, `{0}` plural-branch resolution for `count = 0`, simple two-part pluralize fallback.
- `@rudderjs/concurrency`: `defer()` swallows AND logs errors, `restore()` after `fake()` recreates the worker driver.

No behavior changes — coverage only.
