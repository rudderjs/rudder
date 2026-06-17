---
"@rudderjs/auth": minor
---

Add `loginUsingId()`, `once()`, and `onceUsingId()` to the `Guard` contract and `SessionGuard` (Laravel parity for stateless / single-request auth).

- `loginUsingId(id, remember?)`: look up by primary key and log in (writes the session). Exposed on the `Auth` facade / `AuthManager` too, since it persists.
- `once(credentials)` / `onceUsingId(id)`: authenticate for the current request only, setting the user on the guard instance without writing the session. They preserve the anti-enumeration dummy-verify on the no-user branch. These are deliberately NOT on the `Auth` facade: `guard()` returns a fresh instance each call, so a facade-level `once()` would set state on an immediately-discarded guard. Use `const g = auth().guard(); if (await g.once(creds)) await g.user()` and keep the reference.
