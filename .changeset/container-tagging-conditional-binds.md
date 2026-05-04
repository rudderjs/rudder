---
'@rudderjs/core': minor
---

Add container tagging and conditional binding helpers (Laravel parity #7, PR1).

- `container.tag(tokens, tags)` — group bindings under one or more tag names. Both args accept either single values or arrays. Additive; tagging the same token twice is a no-op. Tagging an unbound token is allowed.
- `container.tagged<T>(tag)` — resolve every token under a tag via `make()`. Returns `[]` for unknown tags. Insertion order. Singletons stay singletons across calls.
- `container.bindIf` / `singletonIf` / `scopedIf` — bind only if the token is currently unbound. Lets framework providers register defaults that app providers can override by binding first.
- `reset()` clears tags.

Pure additions; existing API unchanged. Decorator (`@Tag`) + `extend` + `rebinding` ship in the next PR.