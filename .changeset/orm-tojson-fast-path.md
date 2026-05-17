---
'@rudderjs/orm': patch
---

Fast-path `Model.toJSON()` when the model declares no `casts` / `attributes` / `appends` / `hidden` / `visible` and no per-instance visibility overrides — the default state for most app Models. The slow path runs three sequential `Object.entries` / `Object.fromEntries` passes plus per-key cast/accessor/visibility lookups, even when there's nothing to apply. The fast path skips straight to a single `{ ...this }` spread, which `JSON.stringify` would do internally anyway.

Bench (playground, 100 `Post` instances, median of 100 runs of `JSON.stringify`): **160.9 µs → 98.6 µs (-39%)**. Model-vs-plain overhead drops from 85 µs to 21.5 µs — 75% of the per-instance serialization tax goes away. Every API endpoint returning Model instances benefits.

Configured models (anything with casts / accessors / hidden / visible / appends / instance overrides) keep the existing slow-path semantics — verified by 4 new pinning tests plus the existing toJSON suite.
