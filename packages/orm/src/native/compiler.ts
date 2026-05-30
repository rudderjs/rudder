// ─── SQL compiler (read path) ──────────────────────────────
//
// PURE: turns a {@link NativeQueryState} into a `{ sql, bindings }` pair via a
// {@link Dialect}. No driver, no `node:`, no I/O — this is the portable half of
// the engine (cross-phase rule 7). Every value is emitted as a bound parameter;
// only identifiers (validated + quoted by the dialect) ever reach the SQL text
// (cross-phase rule 2 — security gate).

import type { WhereClause, OrderClause } from '@rudderjs/contracts'
import type { Dialect } from './dialect.js'

/**
 * A node in the WHERE condition tree.
 *
 * - `clause` — a single `column <op> value` predicate.
 * - `group`  — a parenthesized sub-tree with its own boolean roots, produced by
 *   `whereGroup` / `orWhereGroup`. Nesting is unbounded.
 *
 * Each node carries `boolean: 'AND' | 'OR'` recording how it joins to the
 * predicate *before* it at the same level. The first node's boolean is ignored.
 */
export type ConditionNode =
  | { kind: 'clause'; boolean: 'AND' | 'OR'; clause: WhereClause }
  | { kind: 'group';  boolean: 'AND' | 'OR'; children: ConditionNode[] }

/**
 * Everything the read compiler needs from a query. The `NativeQueryBuilder`
 * accumulates this; the compiler is otherwise stateless.
 */
export interface NativeQueryState {
  table:      string
  primaryKey: string
  conditions: ConditionNode[]
  orders:     OrderClause[]
  limitN:     number | null
  offsetN:    number | null
  /** Soft-delete scoping resolved by the builder from the Model + with/onlyTrashed. */
  softDelete: 'exclude' | 'only' | 'with'
  /** Column the soft-delete filter targets. Default `deletedAt`. */
  deletedAtColumn: string
}

/** A compiled statement: parameterized SQL + the positional bindings. */
export interface CompiledQuery {
  sql:      string
  bindings: unknown[]
}

/** SQL text for each {@link WhereOperator}. `IN`/`NOT IN` are handled
 *  separately (they expand to a placeholder list), as are null comparisons. */
const OPERATOR_SQL: Record<string, string> = {
  '=':        '=',
  '!=':       '!=',
  '>':        '>',
  '>=':       '>=',
  '<':        '<',
  '<=':       '<=',
  'LIKE':     'LIKE',
  'NOT LIKE': 'NOT LIKE',
}

/**
 * Accumulates positional bindings and hands out the matching placeholder. One
 * instance per compile so `$n` indices (Postgres, later) stay correct across
 * the whole statement, not per-fragment.
 */
class Bindings {
  readonly values: unknown[] = []
  constructor(private readonly dialect: Dialect) {}
  add(value: unknown): string {
    const ph = this.dialect.placeholder(this.values.length)
    this.values.push(value)
    return ph
  }
}

/**
 * Render one `WhereClause` to SQL. Null values route through `IS NULL` /
 * `IS NOT NULL` (a `= NULL` never matches in SQL); `IN`/`NOT IN` expand to a
 * parenthesized placeholder list (empty list → constant false/true).
 */
function compileClause(clause: WhereClause, dialect: Dialect, b: Bindings): string {
  const col = dialect.quoteId(clause.column)
  const { operator, value } = clause

  if (operator === 'IN' || operator === 'NOT IN') {
    const arr = Array.isArray(value) ? value : [value]
    if (arr.length === 0) {
      // `x IN ()` is a syntax error in SQLite; emit the equivalent constant.
      return operator === 'IN' ? '1 = 0' : '1 = 1'
    }
    const list = arr.map(v => b.add(v)).join(', ')
    return `${col} ${operator} (${list})`
  }

  // Null equality/inequality must use IS [NOT] NULL semantics.
  if (value === null && (operator === '=' || operator === '!=')) {
    return `${col} IS ${operator === '=' ? '' : 'NOT '}NULL`
  }

  const op = OPERATOR_SQL[operator]
  if (!op) {
    // Unreachable for a well-typed WhereOperator; guard keeps the compiler
    // honest if the contract grows an operator the native engine hasn't mapped.
    throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(operator)}`)
  }
  return `${col} ${op} ${b.add(value)}`
}

/**
 * Render a list of sibling condition nodes into a single boolean expression,
 * inserting each node's `boolean` connector between siblings. Returns `''` for
 * an empty list (caller omits the WHERE/parens).
 */
function compileNodes(nodes: ConditionNode[], dialect: Dialect, b: Bindings): string {
  const parts: string[] = []
  for (const node of nodes) {
    let frag: string
    if (node.kind === 'clause') {
      frag = compileClause(node.clause, dialect, b)
    } else {
      const inner = compileNodes(node.children, dialect, b)
      // An empty group contributes nothing — skip it entirely so it doesn't
      // emit dangling `AND ()`. The connector is keyed off whether anything has
      // been emitted yet (parts.length), not the source index, so a leading
      // skipped group never leaves a dangling `AND`/`OR`.
      if (inner === '') continue
      frag = `(${inner})`
    }
    parts.push(parts.length === 0 ? frag : `${node.boolean} ${frag}`)
  }
  return parts.join(' ')
}

/**
 * Build the WHERE expression for a query, folding in the soft-delete filter.
 * The soft-delete predicate is AND-ed at the top level — Laravel scopes it
 * around the whole user predicate, matching orm-drizzle/orm-prisma.
 */
function compileWhere(state: NativeQueryState, dialect: Dialect, b: Bindings): string {
  const userExpr = compileNodes(state.conditions, dialect, b)
  const softExpr = compileSoftDelete(state, dialect)

  if (userExpr && softExpr) {
    // Parenthesize the user predicate so an inner top-level OR doesn't escape
    // the soft-delete AND (e.g. `(a OR b) AND deletedAt IS NULL`).
    const wrapped = state.conditions.length > 1 ? `(${userExpr})` : userExpr
    return `${wrapped} AND ${softExpr}`
  }
  return userExpr || softExpr
}

/** The `deletedAt IS [NOT] NULL` fragment, or `''` when not scoping. */
function compileSoftDelete(state: NativeQueryState, dialect: Dialect): string {
  if (state.softDelete === 'with') return ''
  const col = dialect.quoteId(state.deletedAtColumn)
  return state.softDelete === 'only' ? `${col} IS NOT NULL` : `${col} IS NULL`
}

/** ORDER BY fragment (without the keyword), or `''` when no orders. */
function compileOrderBy(orders: OrderClause[], dialect: Dialect): string {
  return orders
    .map(o => `${dialect.quoteId(o.column)} ${o.direction === 'DESC' ? 'DESC' : 'ASC'}`)
    .join(', ')
}

/**
 * Compile a SELECT for the read terminals (`get`/`all`/`first`/`find`).
 *
 * `overrides` lets terminals tweak the shape without mutating state:
 * - `limit`         — force a LIMIT (e.g. `first()` → 1), overriding `state.limitN`.
 * - `selectColumns` — projection list; defaults to `*`.
 * - `extraConditions` — additional clauses AND-ed in (e.g. `find(id)` → PK match),
 *   applied at the top level *outside* the user predicate parens.
 */
export function compileSelect(
  state: NativeQueryState,
  dialect: Dialect,
  overrides: {
    limit?: number | null
    selectColumns?: string
    extraConditions?: ConditionNode[]
  } = {},
): CompiledQuery {
  const b = new Bindings(dialect)
  const select = overrides.selectColumns ?? '*'
  const table = dialect.quoteId(state.table)

  let sql = `SELECT ${select} FROM ${table}`

  const where = compileWhereWithExtra(state, dialect, b, overrides.extraConditions)
  if (where) sql += ` WHERE ${where}`

  const orderBy = compileOrderBy(state.orders, dialect)
  if (orderBy) sql += ` ORDER BY ${orderBy}`

  const limit = overrides.limit !== undefined ? overrides.limit : state.limitN
  if (limit !== null && limit !== undefined) sql += ` LIMIT ${asInt(limit)}`

  if (state.offsetN !== null) {
    // SQLite requires a LIMIT before OFFSET; supply -1 (unbounded) when the
    // caller set an offset without a limit.
    if (limit === null || limit === undefined) sql += ` LIMIT -1`
    sql += ` OFFSET ${asInt(state.offsetN)}`
  }

  return { sql, bindings: b.values }
}

/** Compile `SELECT COUNT(*) AS count FROM ... WHERE ...` for `count()` /
 *  `paginate()` totals. Orders/limit/offset are irrelevant to a count. */
export function compileCount(state: NativeQueryState, dialect: Dialect): CompiledQuery {
  const b = new Bindings(dialect)
  const table = dialect.quoteId(state.table)
  let sql = `SELECT COUNT(*) AS ${dialect.quoteId('count')} FROM ${table}`
  const where = compileWhere(state, dialect, b)
  if (where) sql += ` WHERE ${where}`
  return { sql, bindings: b.values }
}

// ─── Write path (Phase 2) ──────────────────────────────────
//
// INSERT / UPDATE / DELETE compilation. Same rules as the read path: every
// value is a bound parameter, every identifier is validated + quoted via the
// dialect. Affected-row counts come from `RETURNING *` (rows.length) so the
// `Driver` result shape stays `Row[]` — the engine never reads driver-specific
// `changes`/`lastInsertRowid` metadata.

/** Shared options for write compilers. */
interface WriteOpts {
  /** Clauses AND-ed onto the WHERE (e.g. the primary-key match for by-id writes). */
  extraConditions?: ConditionNode[]
  /** Append `RETURNING *` so the executor returns the affected rows. */
  returning?: boolean
}

/** Drop keys whose value is `undefined` — better-sqlite3 rejects `undefined`
 *  bindings, and an absent column should fall to its DB default, not error.
 *  `null` is kept (it's a real SQL value). Mirrors the Model layer's
 *  `_toData()` undefined-filtering for the `query().create()` bypass path. */
function definedEntries(data: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(data).filter(([, v]) => v !== undefined)
}

/**
 * Compile an INSERT for one or more rows. Single-row (`create`) and multi-row
 * (`insertMany`) share this. The column list is the first-seen union of every
 * row's defined keys; a row missing a union column binds `null`. With
 * `returning`, appends `RETURNING *` (single-row `create` reads the inserted
 * row back). Throws on an empty `rows` array — callers guard the no-op.
 */
export function compileInsert(
  state: NativeQueryState,
  dialect: Dialect,
  rows: Array<Record<string, unknown>>,
  opts: { returning?: boolean } = {},
): CompiledQuery {
  if (rows.length === 0) {
    throw new Error('[RudderJS ORM native] compileInsert called with no rows.')
  }
  const table = dialect.quoteId(state.table)

  // First-seen union of defined columns across all rows.
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (v !== undefined && !seen.has(k)) { seen.add(k); columns.push(k) }
    }
  }

  // No columns at all → rely entirely on DB defaults.
  if (columns.length === 0) {
    let sql = `INSERT INTO ${table} DEFAULT VALUES`
    if (opts.returning) sql += ` RETURNING *`
    return { sql, bindings: [] }
  }

  const b = new Bindings(dialect)
  const quotedCols = columns.map(c => dialect.quoteId(c)).join(', ')
  const tuples = rows.map(row => {
    const placeholders = columns.map(c => {
      const v = row[c]
      return b.add(v === undefined ? null : v)
    })
    return `(${placeholders.join(', ')})`
  }).join(', ')

  let sql = `INSERT INTO ${table} (${quotedCols}) VALUES ${tuples}`
  if (opts.returning) sql += ` RETURNING *`
  return { sql, bindings: b.values }
}

/**
 * Compile `UPDATE <table> SET col = ? [, …] [WHERE …] [RETURNING *]`.
 *
 * SET bindings are emitted before WHERE bindings, matching positional `?`
 * order. `undefined`-valued columns are dropped (see {@link definedEntries}).
 * Throws when there's nothing to set.
 */
export function compileUpdate(
  state: NativeQueryState,
  dialect: Dialect,
  data: Record<string, unknown>,
  opts: WriteOpts = {},
): CompiledQuery {
  const entries = definedEntries(data)
  if (entries.length === 0) {
    throw new Error('[RudderJS ORM native] compileUpdate called with no columns to set.')
  }
  const b = new Bindings(dialect)
  const table = dialect.quoteId(state.table)
  const setClause = entries.map(([col, v]) => `${dialect.quoteId(col)} = ${b.add(v)}`).join(', ')

  let sql = `UPDATE ${table} SET ${setClause}`
  const where = compileWhereWithExtra(state, dialect, b, opts.extraConditions)
  if (where) sql += ` WHERE ${where}`
  if (opts.returning) sql += ` RETURNING *`
  return { sql, bindings: b.values }
}

/**
 * Compile an atomic counter update: `UPDATE <table> SET col = col + ? [, extra = ?]
 * [WHERE …] [RETURNING *]`. `delta` is the signed amount (decrement passes a
 * negative). `extra` columns are written in the same statement. Pure SQL —
 * `col = col + ?` reads and writes atomically at the DB, safe under concurrency.
 */
export function compileIncrement(
  state: NativeQueryState,
  dialect: Dialect,
  column: string,
  delta: number,
  extra: Record<string, unknown>,
  opts: WriteOpts = {},
): CompiledQuery {
  const b = new Bindings(dialect)
  const table = dialect.quoteId(state.table)
  const col = dialect.quoteId(column)

  const assignments = [`${col} = ${col} + ${b.add(delta)}`]
  for (const [k, v] of definedEntries(extra)) {
    assignments.push(`${dialect.quoteId(k)} = ${b.add(v)}`)
  }

  let sql = `UPDATE ${table} SET ${assignments.join(', ')}`
  const where = compileWhereWithExtra(state, dialect, b, opts.extraConditions)
  if (where) sql += ` WHERE ${where}`
  if (opts.returning) sql += ` RETURNING *`
  return { sql, bindings: b.values }
}

/** Compile `DELETE FROM <table> [WHERE …] [RETURNING *]`. With `returning`,
 *  the executor returns the deleted rows so the caller can take `rows.length`
 *  as the affected count (no driver `changes` metadata needed). */
export function compileDelete(
  state: NativeQueryState,
  dialect: Dialect,
  opts: WriteOpts = {},
): CompiledQuery {
  const b = new Bindings(dialect)
  const table = dialect.quoteId(state.table)
  let sql = `DELETE FROM ${table}`
  const where = compileWhereWithExtra(state, dialect, b, opts.extraConditions)
  if (where) sql += ` WHERE ${where}`
  if (opts.returning) sql += ` RETURNING *`
  return { sql, bindings: b.values }
}

/**
 * WHERE builder that also folds in terminal-supplied `extraConditions` (e.g.
 * the primary-key match for `find(id)`). The extras are AND-ed at the top
 * level, *outside* the parenthesized user predicate, so `find` composes with
 * an existing `where('tenantId', t)` without crossing tenants.
 */
function compileWhereWithExtra(
  state: NativeQueryState,
  dialect: Dialect,
  b: Bindings,
  extra?: ConditionNode[],
): string {
  const base = compileWhere(state, dialect, b)
  if (!extra || extra.length === 0) return base
  const extraExpr = compileNodes(extra, dialect, b)
  if (!extraExpr) return base
  if (!base) return extraExpr
  // base may itself be `userPred AND deletedAt IS NULL`; AND the extra on.
  return `${base} AND ${extraExpr}`
}

/** Coerce a limit/offset to a safe non-negative integer for inlining. LIMIT/
 *  OFFSET take integer literals (not all SQLite builds bind them cleanly), so
 *  we inline — but only after `Number.isInteger` + clamp, never user strings. */
function asInt(n: number): number {
  if (!Number.isInteger(n) || n < -1) {
    throw new Error(`[RudderJS ORM native] LIMIT/OFFSET must be a non-negative integer, got ${String(n)}.`)
  }
  return n
}
