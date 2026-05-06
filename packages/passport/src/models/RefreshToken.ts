import { Model } from '@rudderjs/orm'

export class RefreshToken extends Model {
  static override table = 'oAuthRefreshToken'

  static override fillable = ['accessTokenId', 'familyId', 'revoked', 'expiresAt']

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
    await (this.constructor as typeof RefreshToken).update((this as any).id as string, { revoked: true } as any)
  }

  /** Whether this token has expired. */
  isExpired(): boolean {
    return new Date(this.expiresAt).getTime() <= Date.now()
  }
}
