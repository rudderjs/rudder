---
"@rudderjs/pennant": patch
---

Fix three feature-flag correctness bugs. (1) A resolver returning `undefined` was never memoized: drivers key absence on `undefined` (a `Map.get` can't distinguish a stored `undefined` from a missing key), so the resolver re-ran on every `active()`/`value()` call, defeating per-scope caching and re-rolling a Lottery each time. Resolved `undefined` is now normalized to `null` before storing. (2) A gradual-rollout `Lottery` returned from a resolver in a second bundled copy of the package failed the `instanceof Lottery` check (nominal, copy-specific), so the object was stored raw and `Boolean(object)` made the flag always-on. The check now uses a registered-symbol brand that holds across copies. (3) The numeric scope `1` and the string scope `"1"` stringified to the same key and shared one flag value; scope keys are now type-prefixed so distinct scopes never collide.
