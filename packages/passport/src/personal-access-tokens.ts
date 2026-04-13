import { Passport } from './Passport.js'
import { AccessToken } from './models/AccessToken.js'
import { createToken } from './token.js'

// ─── Types ────────────────────────────────────────────────

export interface NewPersonalAccessToken {
  /** The persisted token record. */
  token: AccessToken
  /** The plain-text JWT — shown once, never stored. */
  plainTextToken: string
}

// ─── HasApiTokens Mixin ──────────────────────────────────

/**
 * Mixin that adds personal access token methods to a user model.
 *
 * @example
 * import { Model } from '@rudderjs/orm'
 * import { HasApiTokens } from '@rudderjs/passport'
 *
 * class User extends HasApiTokens(Model) {
 *   // ...
 * }
 *
 * const { plainTextToken } = await user.createToken('my-app', ['read', 'write'])
 */
export function HasApiTokens<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base {
    /**
     * Create a personal access token for this user.
     * Returns the JWT (shown once) and the persisted record.
     */
    async createToken(name: string, scopes: string[] = ['*'], expiresInMs?: number): Promise<NewPersonalAccessToken> {
      const userId = (this as any).id as string
      const lifetime = expiresInMs ?? Passport.personalTokenLifetime()
      const expiresAt = new Date(Date.now() + lifetime)

      // Find or use a dedicated "personal access" client
      const clientId = await getPersonalAccessClientId()

      const tokenRecord = await AccessToken.create({
        userId,
        clientId,
        name,
        scopes:    JSON.stringify(scopes),
        revoked:   false,
        expiresAt,
      } as Record<string, unknown>) as AccessToken

      const tokenId = (tokenRecord as any).id as string

      const jwt = await createToken({
        tokenId,
        userId,
        clientId,
        scopes,
        expiresAt,
      })

      return { token: tokenRecord, plainTextToken: jwt }
    }

    /** Get all personal access tokens for this user. */
    async tokens(): Promise<AccessToken[]> {
      const userId = (this as any).id as string
      return AccessToken.where('userId', userId).get() as Promise<AccessToken[]>
    }

    /** Revoke all personal access tokens for this user. */
    async revokeAllTokens(): Promise<number> {
      const tokens = await this.tokens()
      for (const t of tokens) {
        await t.revoke()
      }
      return tokens.length
    }

    /**
     * Check if this user's current token has a specific scope.
     * Only works inside a request that went through BearerMiddleware.
     */
    tokenCan(scope: string): boolean {
      const token = (this as any).__currentToken as AccessToken | undefined
      if (!token) return false
      return token.can(scope)
    }
  }
}

// ─── Personal Access Client ───────────────────────────────

let _personalClientId: string | null = null

/**
 * Get (or create) the internal "Personal Access" OAuth client.
 * This is a non-confidential client used solely for personal access tokens.
 */
async function getPersonalAccessClientId(): Promise<string> {
  if (_personalClientId) return _personalClientId

  const { OAuthClient } = await import('./models/OAuthClient.js')

  // Look for existing personal access client
  const existing = await OAuthClient.where('name', '__personal_access__').first() as import('./models/OAuthClient.js').OAuthClient | null
  if (existing) {
    _personalClientId = (existing as any).id as string
    return _personalClientId
  }

  // Create one
  const client = await OAuthClient.create({
    name:         '__personal_access__',
    secret:       null,
    redirectUris: JSON.stringify([]),
    grantTypes:   JSON.stringify(['personal_access']),
    scopes:       JSON.stringify([]),
    confidential: false,
  } as Record<string, unknown>) as import('./models/OAuthClient.js').OAuthClient

  _personalClientId = (client as any).id as string
  return _personalClientId
}

/** @internal — reset cached client ID (for testing). */
export function resetPersonalAccessClient(): void {
  _personalClientId = null
}
