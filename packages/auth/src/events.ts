import type { Authenticatable } from './contracts.js'

// ─── Auth Lifecycle Events ────────────────────────────────
//
// Mirrors Laravel's `Illuminate\Auth\Events\*` set so apps can hook audit
// logging, welcome emails, device-session clearing, presence broadcasting,
// Telescope/Horizon integration, etc. without monkey-patching the guard.
//
// Dispatched through the @rudderjs/core event bus, which routes by class
// name. Register listeners in `bootstrap/providers.ts`:
//
//   import { Login, Failed, Registered } from '@rudderjs/auth'
//   eventsProvider({
//     Login:      [LogSuccessfulLogin],
//     Failed:     [LogFailedLogin],
//     Registered: [SendWelcomeEmail],
//   })
//
// With no listeners registered, every dispatch is a cheap no-op — the events
// fire unconditionally and cost nothing until an app opts in.

/** Fired by the guard before credentials are checked. */
export class Attempting {
  constructor(
    public readonly credentials: Record<string, unknown>,
    public readonly remember: boolean = false,
  ) {}
}

/** Fired after credentials match a user, before the session is established. */
export class Validated {
  constructor(public readonly user: Authenticatable) {}
}

/** Fired when a user is logged in and the session is established. `remember`
 *  reflects whether a persistent "remember me" cookie was issued. */
export class Login {
  constructor(
    public readonly user: Authenticatable,
    public readonly remember: boolean = false,
  ) {}
}

/** Fired when a credential check fails. `user` is the matched user when the
 *  password was wrong, or `null` when no account matched the credentials. */
export class Failed {
  constructor(
    public readonly credentials: Record<string, unknown>,
    public readonly user: Authenticatable | null = null,
  ) {}
}

/** Fired when a user is logged out. `user` is the previously-authenticated
 *  user, or `null` when none could be resolved from the session. */
export class Logout {
  constructor(public readonly user: Authenticatable | null) {}
}

/** Fired after a new account is created via the auth controller's sign-up. */
export class Registered {
  constructor(public readonly user: Authenticatable) {}
}

/** Fired after a password reset completes successfully. */
export class PasswordReset {
  constructor(public readonly user: Authenticatable) {}
}
