---
"@rudderjs/auth": patch
---

Close login/password-reset user-enumeration timing oracles.

`SessionGuard.attempt()` returned immediately when no user matched the credentials, while a wrong password ran the deliberately-expensive bcrypt/argon verify — so an attacker could distinguish registered from unregistered identifiers by response latency. The no-user branch now runs a constant-cost dummy verify (`EloquentUserProvider.fakeValidateCredentials`) against a throwaway hash computed with the app's own hasher, equalizing the timing. `PasswordBroker.sendResetLink()` similarly performs the same early token-store round-trip and token-hash work on the unknown-email branch before returning, flattening the obvious early-return gap behind the already-constant `{ status: 'sent' }` response. (Queue the reset mail so the response doesn't block on delivery to fully close the remaining mail-send gap.)
