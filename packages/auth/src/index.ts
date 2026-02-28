// ─── Auth Guard Contract ───────────────────────────────────

export interface AuthGuard {
  /** Check if the current request is authenticated */
  check(): boolean | Promise<boolean>

  /** Return the authenticated user, or null */
  user<T = unknown>(): T | null | Promise<T | null>

  /** Attempt to authenticate with credentials */
  attempt(credentials: Record<string, unknown>): boolean | Promise<boolean>

  /** Log the user out */
  logout(): void | Promise<void>
}

// ─── Auth Config ───────────────────────────────────────────

export interface AuthConfig {
  /** Default guard name */
  default?: string
  /** Guard configurations keyed by name */
  guards?: Record<string, GuardConfig>
}

export interface GuardConfig {
  driver:  'session' | 'jwt'
  secret?: string
  ttl?:    number
}

// ─── Not-yet-implemented notice ────────────────────────────

function notImplemented(): never {
  throw new Error(
    '[Forge] @forge/auth is not yet implemented. ' +
    'Sessions, JWT, and guard support are coming in a future release.'
  )
}

// ─── Factory ───────────────────────────────────────────────

export function auth(_config?: AuthConfig): never {
  notImplemented()
}