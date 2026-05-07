import { Model } from '@rudderjs/orm'

export class DeviceCode extends Model {
  static override table = 'oAuthDeviceCode'

  static override fillable = ['clientId', 'userCode', 'deviceCode', 'scopes', 'userId', 'approved', 'expiresAt', 'lastPolledAt', 'interval']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /** Rows safe to remove: expired only. Mirrors the `passport:purge` predicate. */
  static prunable() {
    return this.query().where('expiresAt', '<', new Date())
  }

  declare id: string
  declare clientId: string
  /** SHA-256 hex of the user-displayed userCode. See `grants/device-code-hash.ts`. */
  declare userCode: string
  /** SHA-256 hex of the device_code returned to the polling client. */
  declare deviceCode: string
  declare userId: string | null
  declare approved: boolean | null
  declare expiresAt: Date
  declare lastPolledAt: Date | null
  /** RFC 8628 §3.5 polling interval (seconds). Bumps by 5 on each `slow_down`. */
  declare interval: number

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
