---
'@rudderjs/core': minor
---

Add container `extend` / `rebinding` / `@Tag` decorator + `tagToken` (Laravel parity #7, PR2).

- `container.extend<T>(token, fn)` — wrap the value resolved for `token`. Chains in registration order, applied eagerly to any cached singleton/instance so existing consumers see the wrap on the next `make()`. Singletons cache the wrapped form; transient bindings re-wrap per `make()`; scoped bindings re-wrap per scope.
- `container.rebinding<T>(token, fn)` — register a listener that fires whenever an existing binding is replaced via `bind` / `singleton` / `scoped` / `instance`. Listeners receive the freshly-resolved value (not the stale singleton cache). Does not fire on the initial bind. Useful for test hot-swaps and `app->refresh()` parity.
- `@Tag(name)` parameter decorator — inject the array of bindings tagged with `name` directly into a constructor parameter. Constructor-only (esbuild drops `design:paramtypes` on method decorators).
- `tagToken(name)` — stable `Symbol.for`-backed sentinel for `when().needs(tagToken('group')).give(...)` contextual bindings.
- `bind` / `singleton` / `scoped` now drop any cached singleton instance when overwriting an existing binding (previously the stale instance survived the rebind).
- `reset()` clears extenders and rebinders.

Pure additions; existing API unchanged.
