import { Passport } from './Passport.js'
import type { AccessToken } from './models/AccessToken.js'
import type { OAuthClient } from './models/OAuthClient.js'
import { accessTokenHelpers } from './models/helpers.js'
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
export interface HasApiTokensInstance {
  createToken(name: string, scopes?: string[], expiresInMs?: number): Promise<NewPersonalAccessToken>
  tokens(): Promise<AccessToken[]>
  revokeAllTokens(): Promise<number>
  tokenCan(scope: string): boolean
}

export function HasApiTokens<T extends abstract new (...args: any[]) => any>(
  Base: T,
): T & (new (...args: any[]) => HasApiTokensInstance) {
  abstract class _HasApiTokens extends Base {
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

      const AccessTokenCls = await Passport.tokenModel()
      const tokenRecord = await AccessTokenCls.create({
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
      const AccessTokenCls = await Passport.tokenModel()
      return AccessTokenCls.where('userId', userId).get() as Promise<AccessToken[]>
    }

    /** Revoke all personal access tokens for this user. */
    async revokeAllTokens(): Promise<number> {
      const AccessTokenCls = await Passport.tokenModel()
      const tokens = await this.tokens()
      for (const t of tokens) {
        await AccessTokenCls.update((t as any).id, { revoked: true } as any)
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
      return accessTokenHelpers.can(token as any, scope)
    }
  }

  return _HasApiTokens as unknown as T & (new (...args: any[]) => HasApiTokensInstance)
}

// ─── Personal Access Client ───────────────────────────────

let _personalClientId: string | null = null

/**
 * Get (or create) the internal "Personal Access" OAuth client.
 * This is a non-confidential client used solely for personal access tokens.
 */
async function getPersonalAccessClientId(): Promise<string> {
  if (_personalClientId) return _personalClientId

  const ClientCls = await Passport.clientModel()

  // Look for existing personal access client
  const existing = await ClientCls.where('name', '__personal_access__').first() as OAuthClient | null
  if (existing) {
    _personalClientId = (existing as any).id as string
    return _personalClientId
  }

  // Create one
  const client = await ClientCls.create({
    name:         '__personal_access__',
    secret:       null,
    redirectUris: JSON.stringify([]),
    grantTypes:   JSON.stringify(['personal_access']),
    scopes:       JSON.stringify([]),
    confidential: false,
  } as Record<string, unknown>) as OAuthClient

  _personalClientId = (client as any).id as string
  return _personalClientId
}

/** @internal — reset cached client ID (for testing). */
export function resetPersonalAccessClient(): void {
  _personalClientId = null
}
