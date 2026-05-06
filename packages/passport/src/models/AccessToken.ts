import { Model, Hidden } from '@rudderjs/orm'

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

  // `revoked` is intentionally NOT fillable — flipping it is a privileged
  // lifecycle operation that should only happen through `revoke()` (instance
  // method) or `forceFill({ revoked: true })`. Allowing mass-assignment here
  // would let any caller-controlled payload pre-mark a token as revoked
  // before it ever sees real traffic. Defense-in-depth — no current route
  // exposes this surface today.
  static override fillable = ['userId', 'clientId', 'name', 'scopes', 'expiresAt']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /** Rows safe to remove: expired OR revoked. Same predicate as `passport:purge`. */
  static prunable() {
    return this.query()
      .where('expiresAt', '<', new Date())
      .orWhere('revoked', true)
  }

  declare id: string

  // `userId` and `clientId` are hidden from `toJSON()` so a downstream API
  // route that surfaces `user.tokens()` doesn't accidentally leak ownership
  // links — the JWT itself isn't stored, but mapping a token id back to a
  // user/client is still privileged audit info. Routes that explicitly need
  // them can opt in via `instance.makeVisible(['userId', 'clientId'])`.
  @Hidden
  declare userId: string | null

  @Hidden
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
    // Direct property assignment + save() bypasses the mass-assignment filter
    // (`revoked` is no longer in `fillable`). Cleaner than the prior static
    // `Model.update(id, ...)` pattern: observers fire normally, the in-memory
    // instance reflects the new state without a re-read, and there's no
    // `(this as any).id` cast that future refactors might silently break.
    this.revoked = true
    await this.save()
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
