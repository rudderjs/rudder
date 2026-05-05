---
'@rudderjs/auth': patch
---

Fix two observability inconsistencies in `Gate`:

- `_getGateObservers()` no longer caches `null`. The previous lazy accessor cached the global lookup on first call; if `Gate.allows()` ran before `gate-observers.ts` was imported, the cache trapped `null` permanently and downstream subscribers (e.g. Telescope's `GateCollector`) never received events even after they subscribed. The lookup is one property read, so dropping the cache costs nothing measurable.
- `Gate.forUser(user).allows(ability, model)` now reports `resolvedVia: 'policy'` (with the policy name) when the policy is registered but the ability method is missing — matching the static `Gate.allows()` path. The previous `resolvedVia: 'default'` contradicted the static path and miscategorised the event in Telescope.
