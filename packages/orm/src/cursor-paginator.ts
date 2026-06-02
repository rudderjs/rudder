// Keyset (cursor) pagination — pure Model-layer machinery built on the
// existing `where` / `orderBy` / `limit` / `get` / `whereGroup` primitives. No
// adapter, contract, or native-engine support is required: Laravel's keyset
// paginator is likewise pure query-builder.
//
// This file is reachable from the client bundle (`@rudderjs/orm`), so it must be
// pure JS — no `node:*` imports and no top-level `process.env`. Base64 is done
// via `Buffer` when present (Node) and `btoa`/`atob` otherwise (browser), so the
// Client Bundle Smoke gate stays green.

/** One resolved order term, normalized to lowercase direction. */
export interface CursorOrder {
  column:    string
  direction: 'asc' | 'desc'
}

/**
 * A page of keyset-paginated results. Mirrors Laravel's `CursorPaginator`
 * surface where it maps cleanly: `data` + `perPage` + opaque `nextCursor` /
 * `prevCursor` strings + a `hasMore` flag.
 *
 * v1 is forward-only — `nextCursor` advances; `prevCursor` is always `null`
 * (backward navigation is deferred). Consumers doing infinite scroll keep
 * passing `nextCursor` back in until it comes back `null`.
 */
export class CursorPaginator<T> {
  constructor(
    public readonly data:       T[],
    public readonly perPage:    number,
    public readonly nextCursor: string | null,
    public readonly prevCursor: string | null,
    public readonly hasMore:    boolean,
  ) {}

  toJSON(): {
    data:       T[]
    perPage:    number
    nextCursor: string | null
    prevCursor: string | null
    hasMore:    boolean
  } {
    return {
      data:       this.data,
      perPage:    this.perPage,
      nextCursor: this.nextCursor,
      prevCursor: this.prevCursor,
      hasMore:    this.hasMore,
    }
  }
}

// ─── base64url (portable) ──────────────────────────────────

function toBase64Url(s: string): string {
  let b64: string
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(s, 'utf8').toString('base64')
  } else {
    // btoa works on a binary string — round-trip UTF-8 through char codes.
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    for (const byte of bytes) bin += String.fromCharCode(byte)
    b64 = btoa(bin)
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8')
  }
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Encode the boundary row's order-column values into an opaque cursor. */
export function encodeCursor(values: Record<string, unknown>): string {
  return toBase64Url(JSON.stringify(values))
}

/** Decode an opaque cursor back into its order-column values. Throws a clear
 *  error on anything that isn't a base64-encoded JSON object. */
export function decodeCursor(cursor: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(cursor))
  } catch {
    throw new Error(
      '[RudderJS ORM] cursorPaginate(): malformed cursor — expected a base64-encoded JSON object produced by a previous cursorPaginate() call.',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      '[RudderJS ORM] cursorPaginate(): malformed cursor — decoded value is not an object.',
    )
  }
  return parsed as Record<string, unknown>
}

// ─── keyset WHERE construction ─────────────────────────────

/** Minimal builder surface the keyset filter composes on — kept structural so
 *  this file doesn't depend on the full `QueryBuilder` type (or its runtime). */
export interface KeysetBuilder {
  where(column: string, operator: '>' | '<' | '=', value: unknown): unknown
  whereGroup(fn: (q: KeysetBuilder) => void): unknown
  orWhereGroup(fn: (q: KeysetBuilder) => void): unknown
}

/**
 * Resolve the effective order set for a keyset page: a copy of the recorded
 * orders with the primary key appended as an ASC tiebreaker when it isn't
 * already an order column (a stable total order is required, otherwise rows
 * with equal sort values page non-deterministically).
 *
 * Throws when no order has been recorded — keyset pagination is undefined
 * without a deterministic sort.
 *
 * Returns `{ orders, appendedPrimaryKey }` so the caller knows whether it must
 * also forward an `orderBy(primaryKey)` to the underlying query.
 */
export function resolveCursorOrders(
  recorded:   readonly CursorOrder[],
  primaryKey: string,
): { orders: CursorOrder[]; appendedPrimaryKey: boolean } {
  if (recorded.length === 0) {
    throw new Error(
      '[RudderJS ORM] cursorPaginate() requires at least one orderBy() — keyset pagination needs a deterministic sort. Add e.g. .orderBy(\'id\') before cursorPaginate().',
    )
  }
  const orders = recorded.map((o) => ({ ...o }))
  const hasPk  = orders.some((o) => o.column === primaryKey)
  if (!hasPk) orders.push({ column: primaryKey, direction: 'asc' })
  return { orders, appendedPrimaryKey: !hasPk }
}

/** Pick the order-column values off a (raw) record into a cursor payload. */
export function cursorValuesFor(
  row:    Record<string, unknown>,
  orders: readonly CursorOrder[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const o of orders) out[o.column] = row[o.column]
  return out
}

/**
 * Apply the "rows strictly after this cursor" predicate for a (possibly
 * compound) order. The whole predicate is wrapped in a single `whereGroup` so
 * it composes via AND with any pre-existing `where()` clauses on the query
 * rather than leaking an OR out to the top level.
 *
 * For orders `(c1 d1, c2 d2, …)` and boundary `(v1, v2, …)` the predicate is the
 * lexicographic expansion:
 *
 *   (c1 OP1 v1)
 *     OR (c1 = v1 AND c2 OP2 v2)
 *     OR (c1 = v1 AND c2 = v2 AND c3 OP3 v3) …
 *
 * where `OPi` is `>` for an ASC term and `<` for a DESC term.
 *
 * `boundary` must carry a value for every order column — the caller validates
 * this and throws a clear error otherwise.
 */
export function applyKeysetFilter(
  qb:       KeysetBuilder,
  orders:   readonly CursorOrder[],
  boundary: Record<string, unknown>,
): void {
  qb.whereGroup((outer) => {
    orders.forEach((order, i) => {
      const build = (g: KeysetBuilder): void => {
        // Equality on every column before this one in the order.
        for (const prev of orders.slice(0, i)) {
          g.where(prev.column, '=', boundary[prev.column])
        }
        // Strict comparison on the i-th column, direction-aware.
        const op = order.direction === 'desc' ? '<' : '>'
        g.where(order.column, op, boundary[order.column])
      }
      if (i === 0) outer.whereGroup(build)
      else         outer.orWhereGroup(build)
    })
  })
}
