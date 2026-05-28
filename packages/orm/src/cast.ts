import { VectorDimensionMismatchError } from './vector-errors.js'

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

// ─── Vector cast (#B7 Phase 1) ──────────────────────────────

/**
 * Build a cast for a pgvector column. The returned class implements
 * {@link CastUsing}: on write, validates dimension count + element
 * finiteness and serializes `number[]` → pgvector text format
 * (`'[0.1,0.2,...]'`); on read, parses the text format back to
 * `number[]`.
 *
 * @example
 * ```ts
 * import { Model, vector, type CastDefinition } from '@rudderjs/orm'
 *
 * class Document extends Model {
 *   static casts = {
 *     embedding: vector({ dimensions: 1536 }),
 *   } as const satisfies Record<string, CastDefinition>
 *
 *   embedding!: number[]
 * }
 * ```
 *
 * # Why a factory + class (not a string-keyed built-in cast)
 *
 * The built-in cast string union (`'integer'`, `'json'`, …) can't
 * carry parameters. `vector` needs `dimensions` for write-time
 * validation. A class with the dim baked into its closure is the
 * cleanest fit for the existing `CastDefinition` shape.
 *
 * # Postgres-only
 *
 * The serialization format (`'[1,2,3]'`) is pgvector's. SQLite +
 * MySQL don't have an equivalent; storing the same string in a TEXT
 * column would compile but no vector ops would work. The cast
 * doesn't enforce the adapter — that check lives at query time
 * ({@link VectorStorageUnsupportedError}, raised by the adapter when
 * pgvector isn't installed).
 */
export function vector(opts: { dimensions: number }): new () => CastUsing {
  const dimensions = opts.dimensions
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error(
      `[RudderJS ORM] vector({ dimensions }) requires a positive integer; got ${String(dimensions)}`,
    )
  }

  return class VectorCast implements CastUsing {
    get(key: string, value: unknown): unknown {
      if (value === null || value === undefined) return value
      // Already an array (e.g. roundtrip from cache) — passthrough.
      if (Array.isArray(value)) return value
      // pgvector text format: '[0.1,0.2,0.3]'. JSON.parse handles it
      // since pgvector emits numbers without quotes — same shape as JSON.
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as unknown
          if (!Array.isArray(parsed)) {
            throw new Error(`expected array, got ${typeof parsed}`)
          }
          return parsed as number[]
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(
            `[RudderJS ORM] Vector cast on column "${key}" failed to parse stored value (${msg}). ` +
            `The DB returned "${value.slice(0, 80)}…" which isn't pgvector text format ([1,2,3]). ` +
            `Verify the column type is \`vector(N)\` in your schema.`,
            { cause: err },
          )
        }
      }
      return value
    }

    set(key: string, value: unknown): unknown {
      if (value === null || value === undefined) return value
      if (!Array.isArray(value)) {
        throw new Error(
          `[RudderJS ORM] Vector column "${key}" expected number[], got ${typeof value}. ` +
          `If you have a pgvector text string from a raw query, parse it via JSON.parse() before assignment; ` +
          `otherwise check the cast declaration (\`static casts = { ${key}: vector({ dimensions: N }) }\`).`,
        )
      }
      if (value.length !== dimensions) {
        throw new VectorDimensionMismatchError(key, dimensions, value.length)
      }
      // pgvector rejects NaN / ±Infinity — pre-validate so the throw
      // surfaces the column name + element index instead of a Prisma
      // error 1000 layers deep.
      for (let i = 0; i < value.length; i++) {
        const n = value[i]
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          throw new Error(
            `[RudderJS ORM] Vector column "${key}" element ${i} must be a finite number, got ${String(n)}`,
          )
        }
      }
      // pgvector accepts the same syntax JSON arrays use — comma-separated
      // numbers in square brackets.
      return `[${value.join(',')}]`
    }
  }
}

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
    case 'array':     return typeof value === 'string' ? _parseJson(key, value) : value
    case 'collection':
      // Returns plain array — ModelCollection wrapping done by caller if needed
      return typeof value === 'string' ? _parseJson(key, value) : value
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

// ─── Internal helpers ───────────────────────────────────────

function _parseJson(key: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(
      `[RudderJS ORM] Invalid JSON in cast column "${key}": ${value.slice(0, 80)}… ` +
      `Verify the column stores serialized JSON; if it stores raw strings, change the cast to "string" or remove it.`,
    )
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
  return castType === 'encrypted' ? decrypted : _parseJson('(encrypted)', decrypted)
}
