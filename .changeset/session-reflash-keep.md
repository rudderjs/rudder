---
"@rudderjs/session": minor
---

Add `reflash()` and `keep(keys)` to `SessionInstance` and the `Session` facade, matching Laravel's `Session::reflash()` / `Session::keep([...])`. Flash data is consumed on the request that reads it, so a multi-step redirect chain (`POST /login` → `/intended` → `/dashboard`) previously lost it on the first hop. `reflash()` re-flashes all incoming flash data for one more request; `keep(keys)` re-flashes only the named keys (prototype-member keys are never promoted).
