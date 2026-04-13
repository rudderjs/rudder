import { Model } from '@rudderjs/orm'

export class DeviceCode extends Model {
  static override table = 'oAuthDeviceCode'

  static override fillable = ['clientId', 'userCode', 'deviceCode', 'scopes', 'userId', 'approved', 'expiresAt', 'lastPolledAt']

  declare clientId: string
  declare userCode: string
  declare deviceCode: string
  declare userId: string | null
  declare approved: boolean | null
  declare expiresAt: Date
  declare lastPolledAt: Date | null

  /** Parsed scopes array. */
  getScopes(): string[] {
    const raw = (this as unknown as Record<string, unknown>)['scopes']
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return (raw as string[]) ?? []
  }

  /** Whether this device code has expired. */
  isExpired(): boolean {
    return new Date(this.expiresAt).getTime() <= Date.now()
  }

  /** Whether the user has approved this device. */
  isApproved(): boolean {
    return this.approved === true
  }

  /** Whether the user has denied this device. */
  isDenied(): boolean {
    return this.approved === false
  }

  /** Whether the user hasn't responded yet. */
  isPending(): boolean {
    return this.approved === null
  }
}
