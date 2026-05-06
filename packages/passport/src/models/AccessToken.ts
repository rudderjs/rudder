import { Model } from '@rudderjs/orm'

/**
 * Why we don't store hashed access tokens
 * ----------------------------------------
 * Unlike `@rudderjs/sanctum` (which stores SHA-256 hashes of opaque tokens),
 * Passport access tokens are JWTs signed with RS256. The DB row records
 * metadata only (`userId`, `clientId`, `scopes`, `revoked`, `expiresAt`); the
 * JWT itself is never persisted. The signature is the secrecy boundary —
 * anyone holding the JWT can verify it offline against the public key, and
 * the only way to mint a valid one is with the private key.
 *
 * Practical consequences:
 *   - A DB dump does NOT leak usable bearer tokens. It leaks the audit trail
 *     (which user/client owns which token id, when it expires) but not the
 *     credential itself.
 *   - Revocation works by flipping `revoked = true`; bearer middleware checks
 *     the row on every request. JWT-only verification is intentionally not
 *     supported — we want revocation to be authoritative.
 *   - Rotating the signing keypair (`rudder passport:keys --force`) instantly
 *     invalidates every outstanding access token, since their signatures no
 *     longer verify under the new public key. See CLAUDE.md "Pitfalls".
 *
 * This matches Laravel Passport. If you want hashed-token semantics with
 * no JWT verification step, use `@rudderjs/sanctum` instead.
 */
export class AccessToken extends Model {
  static override table = 'oAuthAccessToken'

  static override fillable = ['userId', 'clientId', 'name', 'scopes', 'revoked', 'expiresAt']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /** Rows safe to remove: expired OR revoked. Same predicate as `passport:purge`. */
  static prunable() {
    return this.query()
      .where('expiresAt', '<', new Date())
      .orWhere('revoked', true)
  }

  declare userId: string | null
  declare clientId: string
  declare name: string | null
  declare revoked: boolean
  declare expiresAt: Date

  /** Parsed scopes array. */
  getScopes(): string[] {
    const raw = (this as unknown as Record<string, unknown>)['scopes']
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return (raw as string[]) ?? []
  }

  /** Check if the token has a specific scope. */
  can(scope: string): boolean {
    const scopes = this.getScopes()
    return scopes.includes('*') || scopes.includes(scope)
  }

  /** Check if the token is missing a specific scope. */
  cant(scope: string): boolean {
    return !this.can(scope)
  }

  /** Revoke this token. */
  async revoke(): Promise<void> {
    this.revoked = true
    await (this.constructor as typeof AccessToken).update((this as any).id as string, { revoked: true } as any)
  }

  /** Whether this token has expired. */
  isExpired(): boolean {
    return new Date(this.expiresAt).getTime() <= Date.now()
  }

  /** Whether this token is valid (not revoked and not expired). */
  isValid(): boolean {
    return !this.revoked && !this.isExpired()
  }
}
