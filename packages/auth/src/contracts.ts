// ─── Authenticatable Contract ─────────────────────────────

export interface Authenticatable {
  getAuthIdentifier(): string
  getAuthPassword(): string
  getRememberToken(): string | null
  setRememberToken(token: string): void
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
}
