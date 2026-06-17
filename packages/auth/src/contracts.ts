// ─── Authenticatable Contract ─────────────────────────────

export interface Authenticatable {
  getAuthIdentifier(): string
  /**
   * The stored password hash, or `null` when the account has no usable
   * password (OAuth-only / SSO / invited-not-yet-set rows where the column is
   * NULL). Returns `null` — never the empty string — so "no password set"
   * stays distinguishable from "password is the empty string" and a caller
   * can't feed an empty hash to the verifier and fail open.
   */
  getAuthPassword(): string | null
  getRememberToken(): string | null
  setRememberToken(token: string): void
  /**
   * Optional list of column names to omit from the serialized `req.user`
   * payload. Mirrors Laravel's `$hidden` array on Eloquent models. The
   * framework always strips `password` and `remember_token` (both naming
   * conventions); `getHidden()` extends that list for app-specific
   * sensitive columns like `two_factor_secret` or `email_verification_token`.
   */
  getHidden?(): string[]
}

// ─── Auth Types ───────────────────────────────────────────

export interface AuthUser {
  id: string
  name: string
  email: string
  [key: string]: unknown
}

// ─── User Provider Contract ───────────────────────────────

export interface UserProvider {
  retrieveById(id: string): Promise<Authenticatable | null>
  retrieveByCredentials(credentials: Record<string, unknown>): Promise<Authenticatable | null>
  validateCredentials(user: Authenticatable, credentials: Record<string, unknown>): Promise<boolean>
  /**
   * Optional: perform a constant-cost dummy password verify when no user
   * matched, to keep the failed-login timing independent of whether the
   * account exists (anti-enumeration). Callers should invoke it on the
   * no-user branch when present.
   */
  fakeValidateCredentials?(credentials: Record<string, unknown>): Promise<void>
  /** Optional: resolve a user by id and constant-time-validate a "remember me"
   *  token. Required for persistent-login support. */
  retrieveByToken?(userId: string, token: string): Promise<Authenticatable | null>
  /** Optional: persist a new "remember me" token on the user (null clears it). */
  updateRememberToken?(userId: string, token: string | null): Promise<void>
}

// ─── Guard Contract ───────────────────────────────────────

export interface Guard {
  user(): Promise<Authenticatable | null>
  id(): Promise<string | null>
  check(): Promise<boolean>
  guest(): Promise<boolean>
  attempt(credentials: Record<string, unknown>, remember?: boolean): Promise<boolean>
  login(user: Authenticatable, remember?: boolean): Promise<void>
  logout(): Promise<void>
  /** Look up a user by primary key and log them in. Returns false when not found. */
  loginUsingId(id: string | number, remember?: boolean): Promise<boolean>
  /** Validate credentials and authenticate for this request only — no session write. */
  once(credentials: Record<string, unknown>): Promise<boolean>
  /** Look up a user by primary key and authenticate for this request only — no session write. */
  onceUsingId(id: string | number): Promise<boolean>
}
