import { Model } from '@rudderjs/orm'

export class RefreshToken extends Model {
  // SQL `@@map` table name (native + Prisma; see OAuthClient.ts). `keyType =
  // 'ulid'` stamps the id on insert (native has no `@default(cuid())`).
  static override table = 'oauth_refresh_tokens'
  static override keyType = 'ulid' as const

  // `revoked` is intentionally NOT fillable — see AccessToken.ts for the
  // rationale. Lifecycle flips happen through `revoke()` or `forceFill`.
  static override fillable = ['accessTokenId', 'tokenHash', 'familyId', 'expiresAt']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /** Rows safe to remove: expired OR revoked. Same predicate as `passport:purge`. */
  static prunable() {
    return this.query()
      .where('expiresAt', '<', new Date())
      .orWhere('revoked', true)
  }

  declare id: string
  declare accessTokenId: string
  /** SHA-256 hex of the plaintext refresh token. See `opaque-token.ts`. */
  declare tokenHash: string
  declare familyId: string | null
  declare revoked: boolean
  declare expiresAt: Date

  /** Revoke this refresh token. */
  async revoke(): Promise<void> {
    this.revoked = true
    await this.save()
  }

  /** Whether this token has expired. */
  isExpired(): boolean {
    return new Date(this.expiresAt).getTime() <= Date.now()
  }
}
