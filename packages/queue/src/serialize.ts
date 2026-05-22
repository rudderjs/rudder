// ─── Typed Payload Serializer ──────────────────────────────
//
// Job payloads travel through `JSON.stringify` on every driver. Plain JSON
// silently mangles common JS values: `Date` becomes an ISO string, `BigInt`
// throws, `Map`/`Set` collapse to `{}` / `[]`, `Buffer` becomes a `{type,data}`
// shell, `undefined` keys disappear. By the time the worker calls
// `Object.assign(new Job(), payload)`, the job sees the wrong types.
//
// `encodePayload` walks the value once and replaces non-JSON-safe types with
// a tagged envelope `{ __rj: '<tag>', value: ... }` that JSON survives.
// `decodePayload` reverses the wrapping back into the original instance.
//
// Drivers MUST call `encodePayload` before they hand the payload to the
// transport, and `decodePayload` before `Object.assign` on the worker side.

const TAG = '__rj'

type Tagged =
  | { [TAG]: 'date';   value: string }
  | { [TAG]: 'bigint'; value: string }
  | { [TAG]: 'buffer'; value: string }    // base64
  | { [TAG]: 'map';    value: Array<[unknown, unknown]> }
  | { [TAG]: 'set';    value: unknown[] }

// Called only by `decodePayload`, which has already filtered null/undefined,
// arrays, and non-object primitives — so the parameter is a non-null object.
function isTagged(v: object): v is Tagged {
  return TAG in v
}

/**
 * Encode `value` into a JSON-safe shape that round-trips through
 * `JSON.stringify` without losing type information for `Date`, `BigInt`,
 * `Buffer`, `Map`, `Set`. Objects and arrays are walked structurally; plain
 * JSON primitives pass through unchanged.
 *
 * Returns `unknown` rather than the input type because the result is no
 * longer the original shape — drivers should treat it as opaque transport
 * data and call `decodePayload` on the receiving side.
 */
export function encodePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  if (t === 'bigint') return { [TAG]: 'bigint', value: (value as bigint).toString() }
  if (value instanceof Date) return { [TAG]: 'date', value: value.toISOString() }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { [TAG]: 'buffer', value: value.toString('base64') }
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([k, v]) => [encodePayload(k), encodePayload(v)] as [unknown, unknown])
    return { [TAG]: 'map', value: entries }
  }
  if (value instanceof Set) {
    return { [TAG]: 'set', value: Array.from(value, encodePayload) }
  }
  if (Array.isArray(value)) return value.map(encodePayload)
  if (t === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodePayload(v)
    }
    return out
  }
  // Functions, symbols — drop. JSON.stringify would also drop these.
  return undefined
}

/**
 * Decode a tagged payload produced by `encodePayload` back into its original
 * JS shape. Values without a tag are returned as-is.
 */
export function decodePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(decodePayload)
  if (typeof value !== 'object') return value
  if (isTagged(value)) {
    switch (value[TAG]) {
      case 'date':   return new Date(value.value)
      case 'bigint': return BigInt(value.value)
      case 'buffer': return Buffer.from(value.value, 'base64')
      case 'map':    return new Map(value.value.map(([k, v]) => [decodePayload(k), decodePayload(v)] as [unknown, unknown]))
      case 'set':    return new Set(value.value.map(decodePayload))
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = decodePayload(v)
  }
  return out
}
