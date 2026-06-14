import type { Authenticatable, UserProvider } from './contracts.js'
import { safeStringEqual } from './remember.js'

// ─── Eloquent Provider ────────────────────────────────────

type ModelClass = {
  query(): { where(col: string, val: unknown): { first(): Promise<Record<string, unknown> | null> } }
  find(id: string | number): Promise<Record<string, unknown> | null>
  update?(id: string | number, data: Record<string, unknown>): Promise<unknown>
}

// A real bcrypt hash of a throwaway string. Used as the dummy-verify target
// when no `make` fn was passed (test/stub construction) so the no-user branch
// still feeds the configured `check` a well-formed digest. In production the
// manager threads `hashMake`, so the dummy is computed in the app's own
// algorithm (bcrypt OR argon2) — see `dummyHashFor`.
const FALLBACK_DUMMY_HASH = '$2a$10$RfVjvydv7Dzo0vs.E/ARheQhK9irIOkOwCo2ygy/8UNo3G9ecRPSK'

// One dummy hash per hasher, computed lazily and cached for the process. Keyed
// by the `make` fn so distinct hashers (e.g. across tests) never share a hash.
const _dummyHashCache = new WeakMap<object, Promise<string>>()

function dummyHashFor(hashMake: (plain: string) => Promise<string>): Promise<string> {
  let p = _dummyHashCache.get(hashMake)
  if (!p) {
    p = hashMake('rudderjs/auth dummy password for timing equalization')
    _dummyHashCache.set(hashMake, p)
  }
  return p
}

export class EloquentUserProvider implements UserProvider {
  constructor(
    private readonly model: ModelClass,
    private readonly hashCheck: (plain: string, hashed: string) => Promise<boolean>,
    private readonly hashMake?: (plain: string) => Promise<string>,
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

  /**
   * Run a password verify against a throwaway hash and discard the result.
   * Called when no user matched the credentials, so that the "no such account"
   * path costs the same as the "wrong password" path — otherwise an attacker
   * can distinguish registered from unregistered identifiers by timing (the
   * real path pays the deliberately-expensive bcrypt/argon verify; the missing
   * path used to return instantly).
   */
  async fakeValidateCredentials(credentials: Record<string, unknown>): Promise<void> {
    const plain     = credentials['password']
    const candidate = typeof plain === 'string' ? plain : ''
    const hashed    = this.hashMake ? await dummyHashFor(this.hashMake) : FALLBACK_DUMMY_HASH
    await this.hashCheck(candidate, hashed)
  }

  /**
   * Resolve a user by id and validate a "remember me" token against the stored
   * one in constant time. Returns null when the user is gone, has no stored
   * token (remember-me was never enabled / was cycled by logout), or the token
   * doesn't match — so a stolen-then-revoked cookie stops working immediately.
   */
  async retrieveByToken(userId: string, token: string): Promise<Authenticatable | null> {
    const record = await this.model.find(userId)
    if (!record) return null
    const user   = toAuthenticatable(record)
    const stored = user.getRememberToken()
    if (!stored || !safeStringEqual(stored, token)) return null
    return user
  }

  /** Persist a new remember token on the user's row (null clears it). */
  async updateRememberToken(userId: string, token: string | null): Promise<void> {
    await this.model.update?.(userId, { rememberToken: token })
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
