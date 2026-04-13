import { Model } from '@rudderjs/orm'

export class AccessToken extends Model {
  static override table = 'oAuthAccessToken'

  static override fillable = ['userId', 'clientId', 'name', 'scopes', 'revoked', 'expiresAt']

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
