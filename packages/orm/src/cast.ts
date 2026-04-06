// ─── Cast Types ────────────────────────────────────────────

export type BuiltInCast =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'array'
  | 'collection'
  | 'encrypted'
  | 'encrypted:array'
  | 'encrypted:object'

/** Interface for a custom cast class. */
export interface CastUsing {
  /** Transform a raw DB value to the application type (on read). */
  get(key: string, value: unknown, attributes: Record<string, unknown>): unknown
  /** Transform an application value to a DB-storable type (on write). */
  set(key: string, value: unknown, attributes: Record<string, unknown>): unknown
}

export type CastDefinition = BuiltInCast | (new () => CastUsing)

// ─── Built-in cast helpers ──────────────────────────────────

/** Apply a cast when reading from DB (get side). */
export function castGet(type: string, key: string, value: unknown, attributes: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value

  if (typeof type !== 'string') {
    // custom cast class — type is a constructor
    const instance = new (type as unknown as new () => CastUsing)()
    return instance.get(key, value, attributes)
  }

  switch (type) {
    case 'string':    return String(value)
    case 'integer':   return parseInt(String(value), 10)
    case 'float':     return parseFloat(String(value))
    case 'boolean':   return value === 1 || value === '1' || value === true || value === 'true'
    case 'date':      return new Date(String(value))
    case 'datetime':  return new Date(String(value))
    case 'json':
    case 'array':     return typeof value === 'string' ? JSON.parse(value) as unknown : value
    case 'collection':
      // Returns plain array — ModelCollection wrapping done by caller if needed
      return typeof value === 'string' ? JSON.parse(value) as unknown : value
    case 'encrypted':
    case 'encrypted:array':
    case 'encrypted:object':
      return _decrypt(type, value)
    default:          return value
  }
}

/** Apply a cast when writing to DB (set side). */
export function castSet(type: string, key: string, value: unknown, attributes: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value

  if (typeof type !== 'string') {
    const instance = new (type as unknown as new () => CastUsing)()
    return instance.set(key, value, attributes)
  }

  switch (type) {
    case 'string':    return String(value)
    case 'integer':   return parseInt(String(value), 10)
    case 'float':     return parseFloat(String(value))
    case 'boolean':   return value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0
    case 'date':      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
    case 'datetime':  return value instanceof Date ? value.toISOString() : String(value)
    case 'json':
    case 'array':
    case 'collection':
      return typeof value === 'object' ? JSON.stringify(value) : value
    case 'encrypted':
    case 'encrypted:array':
    case 'encrypted:object':
      return _encrypt(type, value)
    default:          return value
  }
}

// ─── Encryption stubs ───────────────────────────────────────
// Uses @rudderjs/crypt if available, otherwise throws clearly.

function _getCrypt(): { encrypt(v: string): string; decrypt(v: string): string } | null {
  try {
    // Dynamic require — only works if @rudderjs/crypt is installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@rudderjs/crypt') as { encrypt(v: string): string; decrypt(v: string): string }
  } catch {
    return null
  }
}

function _encrypt(castType: string, value: unknown): string {
  const crypt = _getCrypt()
  if (!crypt) {
    throw new Error(
      `[RudderJS ORM] Cast type "${castType}" requires @rudderjs/crypt. Run: pnpm add @rudderjs/crypt`
    )
  }
  const serialized = castType === 'encrypted' ? String(value) : JSON.stringify(value)
  return crypt.encrypt(serialized)
}

function _decrypt(castType: string, value: unknown): unknown {
  const crypt = _getCrypt()
  if (!crypt) {
    throw new Error(
      `[RudderJS ORM] Cast type "${castType}" requires @rudderjs/crypt. Run: pnpm add @rudderjs/crypt`
    )
  }
  const decrypted = crypt.decrypt(String(value))
  return castType === 'encrypted' ? decrypted : JSON.parse(decrypted) as unknown
}
