# @boostkit/middleware

## 0.0.6

### Patch Changes

- @boostkit/cache@0.0.5

## 0.0.5

### Patch Changes

- @boostkit/cache@0.0.4

## 0.0.4

### Patch Changes

- Quality pass: bug fixes, expanded tests, and docs improvements across core packages.

  - `@boostkit/support`: fix `ConfigRepository.get()` returning fallback for falsy values (`0`, `false`, `''`); add prototype pollution protection to `set()`; fix `Collection.toJSON()` returning `T[]` not a string; fix `Env.getBool()` to be case-insensitive; fix `isObject()` to correctly return `false` for `Date`, `Map`, `RegExp`, etc.
  - `@boostkit/contracts`: fix `MiddlewareHandler` return type (`void` → `unknown | Promise<unknown>`)
  - `@boostkit/middleware`: add array constructor to `Pipeline` — `new Pipeline([...handlers])` now works
  - `create-boostkit-app`: remove deprecated `.toHandler()` from `RateLimit` in scaffolded templates; remove nonexistent `.withExceptions()` call

- Updated dependencies
  - @boostkit/contracts@0.0.2
  - @boostkit/cache@0.0.3
