import { Model } from '@rudderjs/orm'

export class AuthCode extends Model {
  static override table = 'oAuthAuthCode'

  // `revoked` is intentionally NOT fillable — see AccessToken.ts for the
  // rationale. Auth codes are revoked atomically through
  // `QueryBuilder.where(...).updateAll(...)` in `exchangeAuthCode` (see M3
  // atomic consumption fix), which bypasses mass-assignment, so removing
  // it from fillable is non-breaking.
  static override fillable = ['userId', 'clientId', 'scopes', 'expiresAt', 'redirectUri', 'codeChallenge', 'codeChallengeMethod']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /**
   * Rows safe to remove: expired only. Auth codes are single-use and revoked
   * on exchange, so a revoked-but-unexpired row is still informative for
   * replay-detection diagnostics; we wait for the natural 10-minute TTL
   * before reaping. Mirrors the `passport:purge` predicate.
   */
  static prunable() {
    return this.query().where('expiresAt', '<', new Date())
  }

  declare id: string
  declare userId: string
  declare clientId: string
  declare revoked: boolean
  declare expiresAt: Date
  declare redirectUri: string | null
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
