import type { Authenticatable, UserProvider } from './contracts.js'

// ─── Eloquent Provider ────────────────────────────────────

type ModelClass = {
  query(): { where(col: string, val: unknown): { first(): Promise<Record<string, unknown> | null> } }
  find(id: string | number): Promise<Record<string, unknown> | null>
}

export class EloquentUserProvider implements UserProvider {
  constructor(
    private readonly model: ModelClass,
    private readonly hashCheck: (plain: string, hashed: string) => Promise<boolean>,
  ) {}

  async retrieveById(id: string): Promise<Authenticatable | null> {
    const record = await this.model.find(id)
    return record ? toAuthenticatable(record) : null
  }

  async retrieveByCredentials(credentials: Record<string, unknown>): Promise<Authenticatable | null> {
    const query = { ...credentials }
    delete query['password']
    if (Object.keys(query).length === 0) return null

    let q: unknown = this.model.query()
    for (const [col, val] of Object.entries(query)) {
      q = (q as { where(c: string, v: unknown): unknown }).where(col, val)
    }
    const record = await (q as { first(): Promise<Record<string, unknown> | null> }).first()
    return record ? toAuthenticatable(record) : null
  }

  async validateCredentials(user: Authenticatable, credentials: Record<string, unknown>): Promise<boolean> {
    const plain = credentials['password']
    if (typeof plain !== 'string') return false
    return this.hashCheck(plain, user.getAuthPassword())
  }
}

// ─── Helpers ──────────────────────────────────────────────

export function toAuthenticatable(record: Record<string, unknown>): Authenticatable & Record<string, unknown> {
  return {
    ...record,
    getAuthIdentifier: () => String(record['id'] ?? ''),
    getAuthPassword:   () => String(record['password'] ?? ''),
    getRememberToken:  () => (record['rememberToken'] as string | null) ?? null,
    setRememberToken:  (token: string) => { record['rememberToken'] = token },
  }
}
