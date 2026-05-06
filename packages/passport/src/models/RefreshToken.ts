import { Model } from '@rudderjs/orm'

export class RefreshToken extends Model {
  static override table = 'oAuthRefreshToken'

  // `revoked` is intentionally NOT fillable — see AccessToken.ts for the
  // rationale. Lifecycle flips happen through `revoke()` or `forceFill`.
  static override fillable = ['accessTokenId', 'familyId', 'expiresAt']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /** Rows safe to remove: expired OR revoked. Same predicate as `passport:purge`. */
  static prunable() {
    return this.query()
      .where('expiresAt', '<', new Date())
      .orWhere('revoked', true)
  }

  declare accessTokenId: string
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
