import { Model } from '@rudderjs/orm'

export class RefreshToken extends Model {
  static override table = 'oAuthRefreshToken'

  static override fillable = ['accessTokenId', 'revoked', 'expiresAt']

  declare accessTokenId: string
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
