---
"@rudderjs/auth": minor
---

feat(auth): dispatch auth lifecycle events (`Attempting`, `Validated`, `Login`, `Failed`, `Logout`, `Registered`, `PasswordReset`)

Mirrors Laravel's `Illuminate\Auth\Events\*` set. The guard and auth controller now fire typed events at every lifecycle transition through the `@rudderjs/core` event bus, so apps can hook audit logging, welcome emails, device-session clearing, presence broadcasting, or Telescope/Horizon integration without monkey-patching `SessionGuard`.

Register listeners in `bootstrap/providers.ts`:

```ts
import { Login, Failed, Registered } from '@rudderjs/auth'

eventsProvider({
  Login:      [LogSuccessfulLogin],
  Failed:     [LogFailedLogin],
  Registered: [SendWelcomeEmail],
})
```

`SessionGuard.attempt()` fires `Attempting` → `Validated` → `Login` on success, and `Attempting` → `Failed` (carrying the matched user when the password was wrong, `null` when no account matched) on failure. `login()`/`loginViaRememberCookie()` fire `Login`, `logout()` fires `Logout`, and `once()` fires `Attempting`/`Validated`/`Failed` but never `Login` (it writes no session). `BaseAuthController.signUp` fires `Registered`, and `PasswordBroker.reset()` fires `PasswordReset` on success. With no listeners registered, every dispatch is a cheap no-op.
