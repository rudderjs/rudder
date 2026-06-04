import type { BuiltInCast } from '@rudderjs/contracts'
import { VectorDimensionMismatchError } from './vector-errors.js'

// ─── Cast Types ────────────────────────────────────────────

// `BuiltInCast` is owned by `@rudderjs/contracts` (it's also consumed by the
// native engine's schema→TS type generator, which must not import
// `@rudderjs/orm` — a `database → orm` edge, even type-only, would cycle the
// package graph). Re-exported here so every existing `./cast.js` /
// `@rudderjs/orm` import keeps working.
export type { BuiltInCast } from '@rudderjs/contracts'

/** Interface for a custom cast class. */
export interface CastUsing {
  /** Transform a raw DB value to the application type (on read). */
  get(key: string, value: unknown, attributes: Record<string, unknown>): unknown
  /** Transform an application value to a DB-storable type (on write). */
  set(key: string, value: unknown, attributes: Record<string, unknown>): unknown
}

/**
 * A TypeScript `enum` (or a plain const object) used directly as a cast — maps a
 * column to a closed set of primitive values. On read/write the value is
 * validated against the enum's members; an unknown value throws.
 *
 * ```ts
 * enum Status { Active = 'active', Archived = 'archived' }
 * class Post extends Model {
 *   static casts = { status: Status } as const satisfies Record<string, CastDefinition>
 * }
 * ```
 */
export type EnumLike = Record<string, string | number>

export type CastDefinition = BuiltInCast | (new () => CastUsing) | EnumLike

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
    // Non-string cast: either a custom cast class (CastUsing) or an enum.
    if (_isCastUsingCtor(type)) {
      const instance = new (type as unknown as new () => CastUsing)()
      return instance.get(key, value, attributes)
    }
    return _enumCast(key, type as unknown as EnumLike, value)
  }

  if (type.startsWith('decimal:')) return _decimalCast(type, key, value)

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
    // `hashed` is one-way — on read the stored hash is returned verbatim.
    case 'hashed':    return value
    default:          return value
  }
}

/** Apply a cast when writing to DB (set side). */
export function castSet(type: string, key: string, value: unknown, attributes: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value

  if (typeof type !== 'string') {
    if (_isCastUsingCtor(type)) {
      const instance = new (type as unknown as new () => CastUsing)()
      return instance.set(key, value, attributes)
    }
    return _enumCast(key, type as unknown as EnumLike, value)
  }

  if (type.startsWith('decimal:')) return _decimalCast(type, key, value)

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
    case 'hashed':    return _hash(key, value)
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

// ─── decimal:N ──────────────────────────────────────────────

/**
 * Fixed-precision decimal. Both read and write normalize to a string with N
 * fractional digits (`'9.99'`) — strings avoid the float-rounding drift you'd
 * get round-tripping money through a JS `number`. N is parsed from the cast
 * key (`'decimal:2'`).
 */
function _decimalCast(type: string, key: string, value: unknown): string {
  const places = parseInt(type.slice('decimal:'.length), 10)
  if (!Number.isInteger(places) || places < 0) {
    throw new Error(`[RudderJS ORM] Invalid decimal cast "${type}" on column "${key}" — expected \`decimal:N\` with N a non-negative integer.`)
  }
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    throw new Error(`[RudderJS ORM] decimal cast on column "${key}" got a non-numeric value (${String(value)}).`)
  }
  return num.toFixed(places)
}

// ─── enum cast ──────────────────────────────────────────────

/** A custom cast class has `get`/`set` on its prototype; an enum object does not. */
function _isCastUsingCtor(type: unknown): boolean {
  if (typeof type !== 'function') return false
  const proto = (type as { prototype?: { get?: unknown; set?: unknown } }).prototype
  return typeof proto?.get === 'function' && typeof proto?.set === 'function'
}

/**
 * Allowed primitive values of an enum object. TypeScript numeric enums emit a
 * reverse mapping (`{ 0: 'Active', Active: 0 }`) — the numeric-string keys are
 * the reverse entries, so we skip them and keep only the forward values.
 */
function _enumValues(enumObj: EnumLike): Set<string | number> {
  const out = new Set<string | number>()
  for (const [k, v] of Object.entries(enumObj)) {
    if (/^\d+$/.test(k)) continue
    out.add(v)
  }
  return out
}

/**
 * Validate a value against an enum's members and pass it through. For a TS enum
 * the member *is* its primitive value (`Status.Active === 'active'`), so the
 * same check serves both the read and write sides.
 */
function _enumCast(key: string, enumObj: EnumLike, value: unknown): string | number {
  const values = _enumValues(enumObj)
  if (!values.has(value as string | number)) {
    const allowed = [...values].map(v => JSON.stringify(v)).join(', ')
    throw new Error(`[RudderJS ORM] Invalid enum value for column "${key}": ${JSON.stringify(value)}. Allowed: ${allowed}.`)
  }
  return value as string | number
}

// ─── hashed ─────────────────────────────────────────────────

/** Minimal sync slice of `@rudderjs/hash`'s registered driver (read via the shared registry). */
interface SyncHashDriver {
  makeSync?(value: string): string
  isHashed?(value: string): boolean
}

/**
 * Read the registered hash driver from `@rudderjs/hash`'s globalThis-shared
 * registry. We don't import `@rudderjs/hash` here — it's a node-only package and
 * `cast.ts` must stay client-bundle safe — so we reach the singleton store
 * directly (the same store the `Hash` facade reads/writes). Returns `null` when
 * no driver is registered (hash not installed / not booted).
 */
function _getHashDriver(): SyncHashDriver | null {
  const store = (globalThis as Record<string, unknown>)['__rudderjs_hash_registry__'] as { driver?: SyncHashDriver | null } | undefined
  return store?.driver ?? null
}

const _HASHED_RE = /^\$(2[aby]?|argon2(id|i|d))\$/

/**
 * One-way hash on write. Re-hashing an already-hashed value is a no-op
 * (Laravel's behavior) so resaving a loaded row doesn't double-hash. Uses the
 * registered driver's synchronous `makeSync` — bcrypt supports it; argon2
 * doesn't (its `makeSync` throws a clear message).
 */
function _hash(key: string, value: unknown): string {
  const driver = _getHashDriver()
  if (!driver) {
    throw new Error(`[RudderJS ORM] The "hashed" cast on column "${key}" requires @rudderjs/hash. Install it and register a hash driver (add hash() to your providers).`)
  }
  const str = String(value)
  const already = typeof driver.isHashed === 'function' ? driver.isHashed(str) : _HASHED_RE.test(str)
  if (already) return str
  if (typeof driver.makeSync !== 'function') {
    throw new Error(`[RudderJS ORM] The registered hash driver has no synchronous hashing API (e.g. argon2), which the "hashed" cast on column "${key}" needs. Use the bcrypt driver, or hash via an async mutator instead.`)
  }
  return driver.makeSync(str)
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
