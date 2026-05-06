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

    /**
     * Get the **personal access** tokens for this user.
     *
     * Filters on both `userId` AND `clientId === personalAccessClient.id`,
     * so OAuth-app session tokens (issued by third-party clients on this
     * user's behalf) are excluded. The previous implementation returned
     * every access-token row owned by the user — a UI listing personal
     * tokens would surface unrelated third-party authorizations and a
     * "log out all my dev tokens" button would have revoked them.
     *
     * Returns AccessToken Model instances. `AccessToken.toJSON()` hides
     * `userId` and `clientId` by default, so exposing the result over an
     * API leaks only `id`, `name`, `scopes`, `revoked`, `expiresAt`. If
     * you need ownership info on a privileged route, opt in via
     * `t.makeVisible(['userId', 'clientId'])` per token.
     *
     * Consumers MUST keep this method scoped to the authenticated user —
     * exposing other users' tokens via this same accessor (e.g. an admin
     * endpoint that takes a `userId` parameter) bypasses the per-user scope
     * implicit in the mixin.
     */
    async tokens(): Promise<AccessToken[]> {
      const userId = (this as any).id as string
      const AccessTokenCls = await Passport.tokenModel()
      const personalClientId = await getPersonalAccessClientId()
      return AccessTokenCls
        .where('userId', userId)
        .where('clientId', personalClientId)
        .get() as Promise<AccessToken[]>
    }

    /**
     * Revoke this user's **personal access** tokens.
     *
     * Filters on the personal-access client (same scope as `tokens()`), so
     * third-party OAuth app authorizations are not collateral. Returns the
     * count of rows that flipped `revoked = true` — already-revoked rows
     * are skipped by the inner `.where('revoked', false)` predicate.
     */
    async revokeAllTokens(): Promise<number> {
      // Single bulk QueryBuilder.updateAll() — bypasses mass-assignment
      // (`revoked` is no longer in `fillable`) and replaces the prior
      // read-then-N+1-update loop with one round-trip.
      const userId = (this as any).id as string
      const AccessTokenCls = await Passport.tokenModel()
      const personalClientId = await getPersonalAccessClientId()
      return AccessTokenCls
        .where('userId', userId)
        .where('clientId', personalClientId)
        .where('revoked', false)
        .updateAll({ revoked: true } as Record<string, unknown>)
    }

    /**
     * Check if this user's current token has a specific scope.
     * Only works inside a request that went through BearerMiddleware —
     * `__passport_token` is stamped onto the resolved user model and
     * propagates onto `req.user` via the plain-copy step.
     */
    tokenCan(scope: string): boolean {
      const token = (this as any).__passport_token as AccessToken | undefined
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
