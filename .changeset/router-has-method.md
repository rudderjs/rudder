---
'@rudderjs/router': minor
---

Add `Router.has(name): boolean` — convenience alias for `getNamedRoute(name) !== undefined`. Matches Laravel's `Route::has('login')` idiom for rendering nav links conditionally on whether the route is registered.
