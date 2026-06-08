import { Model } from '@rudderjs/orm'

export class DeviceCode extends Model {
  // SQL `@@map` table name (native + Prisma; see OAuthClient.ts). `keyType =
  // 'ulid'` stamps the id on insert (native has no `@default(cuid())`).
  static override table = 'oauth_device_codes'
  static override keyType = 'ulid' as const

  static override fillable = ['clientId', 'userCodeHash', 'deviceCodeHash', 'scopes', 'userId', 'approved', 'interval', 'expiresAt', 'lastPolledAt']

  /** `MassPrunable` — bulk `deleteAll()` per chunk; mirrors `passport:purge`. */
  static pruneMode = 'mass' as const

  /** Rows safe to remove: expired only. Mirrors the `passport:purge` predicate. */
  static prunable() {
    return this.query().where('expiresAt', '<', new Date())
  }

  declare id: string
  declare clientId: string
  // SHA-256 hashes of the plaintext codes (M4). The plaintext is generated
  // and returned once in the `/oauth/device/code` response body; only the
  // hash is persisted. Lookups in `pollDeviceCode` / `approveDeviceCode`
  // hash the input first and query against these columns.
  declare userCodeHash: string
  declare deviceCodeHash: string
  declare userId: string | null
  declare approved: boolean | null
  /** Current polling interval in seconds (RFC 8628 §3.5). Escalates on slow_down. */
  declare interval: number
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
