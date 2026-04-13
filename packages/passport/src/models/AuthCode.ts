import { Model } from '@rudderjs/orm'

export class AuthCode extends Model {
  static override table = 'oAuthAuthCode'

  static override fillable = ['userId', 'clientId', 'scopes', 'revoked', 'expiresAt', 'codeChallenge', 'codeChallengeMethod']

  declare userId: string
  declare clientId: string
  declare revoked: boolean
  declare expiresAt: Date
  declare codeChallenge: string | null
  declare codeChallengeMethod: string | null

  /** Parsed scopes array. */
  getScopes(): string[] {
    const raw = (this as unknown as Record<string, unknown>)['scopes']
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return (raw as string[]) ?? []
  }

  /** Whether this auth code has expired. */
  isExpired(): boolean {
    return new Date(this.expiresAt).getTime() <= Date.now()
  }

  /** Whether PKCE was used. */
  isPkce(): boolean {
    return this.codeChallenge !== null
  }
}
