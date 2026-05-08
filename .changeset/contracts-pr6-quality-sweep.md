---
"@rudderjs/contracts": minor
---

Add `ip?`, `user?`, `session?`, `token?` fields to `AppRequest` (all were set by server adapters and middleware but absent from the contract). Fix README "type-only" claim (`InputTypeError` and `attachInputAccessors` are runtime exports). Create `boost/guidelines.md`. Add `boost` to npm `files`.
