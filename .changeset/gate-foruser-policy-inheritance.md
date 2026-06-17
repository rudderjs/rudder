---
"@rudderjs/auth": patch
---

fix(auth): `Gate.forUser(user)` now resolves base-class policies for subclass instances

`GateForUser._check` only did a direct constructor lookup for a model's policy, so `Gate.forUser(user).allows('edit', subclassInstance)` silently denied when the policy was registered against a base class — even though the static `Gate.allows()` path resolved it correctly via its `instanceof` walk. The `findPolicy` (direct match + prototype-chain walk) and `callPolicy` logic is now shared by both paths, removing the divergence.
