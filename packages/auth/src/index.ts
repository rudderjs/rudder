// ─── Shared Auth Types ─────────────────────────────────────

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string
  createdAt: Date
  updatedAt: Date
}

export interface AuthSession {
  id: string
  userId: string
  token: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  updatedAt: Date
}

export interface AuthResult {
  user: AuthUser
  session: AuthSession
}
