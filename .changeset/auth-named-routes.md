---
'@rudderjs/auth': patch
---

`registerAuthRoutes()` now names its routes: `login`, `register`, `password.forgot`, `password.reset`. This enables callers to check `Route.has('login')` (Laravel's `Route::has()` idiom) — useful for rendering nav links conditionally based on whether the auth package registered its routes.
