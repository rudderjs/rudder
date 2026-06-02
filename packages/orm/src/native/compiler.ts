// ─── SQL compiler (read path) ──────────────────────────────
//
// PURE: turns a {@link NativeQueryState} into a `{ sql, bindings }` pair via a
// {@link Dialect}. No driver, no `node:`, no I/O — this is the portable half of
// the engine (cross-phase rule 7). Every value is emitted as a bound parameter;
// only identifiers (validated + quoted by the dialect) ever reach the SQL text
// (cross-phase rule 2 — security gate).

import type {
  WhereClause,
  OrderClause,
  RelationExistencePredicate,
  AggregateRequest,
} from '@rudderjs/contracts'
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
  /** Correlated EXISTS / NOT EXISTS predicates from `whereRelationExists`
   *  (`whereHas` / `whereDoesntHave`). AND-merged into the WHERE. */
  relationExists?: RelationExistencePredicate[]
  /** Aggregate subselect requests from `withAggregate` (`withCount`/`withSum`/…).
   *  Each becomes a `(subselect) AS alias` column in the SELECT list. */
  aggregates?: AggregateRequest[]
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
  // The user predicate binds first (positional order), so compile it up front —
  // but we only know whether to parenthesize it after seeing the other
  // top-level AND-ed components (soft-delete, EXISTS).
  const userExpr = compileNodes(state.conditions, dialect, b)

  const others: string[] = []
  const softExpr = compileSoftDelete(state, dialect)
  if (softExpr) others.push(softExpr)
  // whereHas / whereDoesntHave — correlated EXISTS, AND-ed at the top level.
  for (const pred of state.relationExists ?? []) {
    others.push(compileExists(state.table, pred, dialect, b))
  }

  if (!userExpr) return others.join(' AND ')
  if (others.length === 0) return userExpr

  // There's something to AND the user predicate against. Parenthesize it when
  // it has more than one top-level clause so an inner top-level OR can't escape
  // the AND (e.g. `(a OR b) AND deletedAt IS NULL`). A single clause needs no
  // parens.
  const wrapped = state.conditions.length > 1 ? `(${userExpr})` : userExpr
  return [wrapped, ...others].join(' AND ')
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
  const baseSelect = overrides.selectColumns ?? '*'
  const table = dialect.quoteId(state.table)

  // Aggregate subselects (withCount/withSum/…) join the SELECT list. They're
  // compiled BEFORE the WHERE so their bindings land first — matching the SQL
  // text order (SELECT list precedes WHERE).
  const aggParts = (state.aggregates ?? []).map(req => compileAggregateSubselect(state.table, req, dialect, b))
  const selectList = aggParts.length > 0 ? [baseSelect, ...aggParts].join(', ') : baseSelect

  let sql = `SELECT ${selectList} FROM ${table}`

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
  opts: { returning?: boolean; upsert?: { uniqueBy: readonly string[]; update: readonly string[] } } = {},
): CompiledQuery {
  if (rows.length === 0) {
    throw new Error('[RudderJS ORM native] compileInsert called with no rows.')
  }
  const table = dialect.quoteId(state.table)
  // Conflict suffix (before RETURNING) for an upsert. Identifiers only — quoted
  // by the dialect; values stay parameterized in the VALUES tuples.
  const conflict = opts.upsert
    ? ` ${dialect.upsertClause(opts.upsert.uniqueBy, opts.upsert.update)}`
    : ''

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
    let sql = `INSERT INTO ${table} DEFAULT VALUES${conflict}`
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

  let sql = `INSERT INTO ${table} (${quotedCols}) VALUES ${tuples}${conflict}`
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

// ─── Relations + aggregates (Phase 3) ──────────────────────
//
// Correlated EXISTS / NOT EXISTS subqueries (whereHas) and aggregate subselects
// (withCount/Sum/Min/Max/Avg/Exists). Both reference the OUTER query's table via
// a qualified column (`"outer"."parentColumn"`) and qualify every inner column
// with its own table so a column name shared between outer and inner can't go
// ambiguous. Same purity + parameterization rules as the rest of the compiler.

/** Qualified `"table"."column"` — both segments validated + quoted. */
function qcol(table: string, column: string, dialect: Dialect): string {
  return `${dialect.quoteId(table)}.${dialect.quoteId(column)}`
}

/**
 * Render a `WhereClause` with its column qualified by `table`. Mirrors
 * {@link compileClause} (operator map, `IS [NOT] NULL`, `IN`/`NOT IN` expansion)
 * but every column reference is `"table"."col"` — required inside a correlated
 * subquery where an unqualified name could resolve to the outer table.
 */
function compileClauseOn(table: string, clause: WhereClause, dialect: Dialect, b: Bindings): string {
  const col = qcol(table, clause.column, dialect)
  const { operator, value } = clause

  if (operator === 'IN' || operator === 'NOT IN') {
    const arr = Array.isArray(value) ? value : [value]
    if (arr.length === 0) return operator === 'IN' ? '1 = 0' : '1 = 1'
    const list = arr.map(v => b.add(v)).join(', ')
    return `${col} ${operator} (${list})`
  }
  if (value === null && (operator === '=' || operator === '!=')) {
    return `${col} IS ${operator === '=' ? '' : 'NOT '}NULL`
  }
  const op = OPERATOR_SQL[operator]
  if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(operator)}`)
  return `${col} ${op} ${b.add(value)}`
}

/** AND-join non-empty fragments; `'1 = 1'` when there are none (keeps a bare
 *  `WHERE` valid for the rare all-empty case). */
function andAll(fragments: string[]): string {
  const parts = fragments.filter(f => f !== '')
  return parts.length === 0 ? '1 = 1' : parts.join(' AND ')
}

/**
 * Compile a correlated `EXISTS (…)` / `NOT EXISTS (…)` fragment for a
 * {@link RelationExistencePredicate}. Shares the caller's {@link Bindings} so
 * its parameters stay in positional order with the surrounding WHERE.
 *
 * - **Direct** (hasMany/hasOne/belongsTo/morphMany/morphOne): single subquery
 *   joining `related.relatedColumn = outer.parentColumn`, plus `extraEquals`
 *   (morph discriminator) on the related table and the constraint wheres.
 * - **Through-pivot** (belongsToMany/morphToMany/morphedByMany): nested EXISTS —
 *   pivot rows for this parent (+ `extraEquals` on the pivot) whose related row
 *   exists (+ constraint wheres on the related table).
 *
 * Soft-delete scoping is intentionally NOT applied here — it's the constrain
 * callback's responsibility (documented), matching the other adapters.
 */
export function compileExists(
  outerTable: string,
  predicate: RelationExistencePredicate,
  dialect: Dialect,
  b: Bindings,
): string {
  const keyword = predicate.exists ? 'EXISTS' : 'NOT EXISTS'
  const related = predicate.relatedTable

  if (predicate.through) {
    const pivot = predicate.through.pivotTable
    // Compile in SQL-TEXT order so the shared `Bindings` stays positionally
    // aligned: the pivot's `extraEquals` appears in the text BEFORE the nested
    // inner EXISTS, so its parameters must bind first. (Building the inner
    // EXISTS first would swap `taggableType` and the related constraint.)
    const pivotKeyExpr = `${qcol(pivot, predicate.through.foreignPivotKey, dialect)} = ${qcol(outerTable, predicate.parentColumn, dialect)}`
    const extraExprs   = extraEqualsOn(pivot, predicate.extraEquals, dialect, b)

    // Inner: the related row joined to this pivot row, plus constraint wheres.
    const innerExprs = [
      `${qcol(related, predicate.relatedColumn, dialect)} = ${qcol(pivot, predicate.through.relatedPivotKey, dialect)}`,
      ...predicate.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
    ]
    const innerExists = `EXISTS (SELECT 1 FROM ${dialect.quoteId(related)} WHERE ${andAll(innerExprs)})`

    const pivotExprs = [pivotKeyExpr, ...extraExprs, innerExists]
    return `${keyword} (SELECT 1 FROM ${dialect.quoteId(pivot)} WHERE ${andAll(pivotExprs)})`
  }

  // Direct: one correlated subquery on the related table.
  const exprs = [
    `${qcol(related, predicate.relatedColumn, dialect)} = ${qcol(outerTable, predicate.parentColumn, dialect)}`,
    ...extraEqualsOn(related, predicate.extraEquals, dialect, b),
    ...predicate.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
  ]
  return `${keyword} (SELECT 1 FROM ${dialect.quoteId(related)} WHERE ${andAll(exprs)})`
}

/** Render each `extraEquals` entry as a bound `"table"."k" = ?` fragment. */
function extraEqualsOn(
  table: string,
  extraEquals: Record<string, unknown> | undefined,
  dialect: Dialect,
  b: Bindings,
): string[] {
  if (!extraEquals) return []
  return Object.entries(extraEquals).map(([k, v]) => `${qcol(table, k, dialect)} = ${b.add(v)}`)
}

/** The `fn(col)` SQL for an aggregate, with COALESCE on sum so an empty match
 *  set yields 0 not NULL. `count`/`exists` ignore the column. */
function aggregateFnSql(req: AggregateRequest, relatedTable: string, dialect: Dialect): string {
  if (req.fn === 'count' || req.fn === 'exists') return 'COUNT(*)'
  const col = qcol(relatedTable, requireColumn(req.fn, req.column), dialect)
  switch (req.fn) {
    case 'sum': return `COALESCE(SUM(${col}), 0)`
    case 'min': return `MIN(${col})`
    case 'max': return `MAX(${col})`
    case 'avg': return `AVG(${col})`
  }
}

/** Resolve the required column for a numeric aggregate, or throw a clear error.
 *  The Model layer always supplies it for sum/min/max/avg; this guards the
 *  contract boundary instead of a bare `!`. */
function requireColumn(fn: string, column: string | undefined): string {
  if (column === undefined) {
    throw new Error(`[RudderJS ORM native] Aggregate "${fn}" requires a column.`)
  }
  return column
}

/**
 * Compile one aggregate request into a correlated subselect expression, aliased
 * as `(…) AS "alias"`, for injection into the main SELECT list. `exists` wraps
 * the COUNT in `(… ) > 0`. Mirrors the orm-drizzle aggregate-subquery shape.
 */
export function compileAggregateSubselect(
  outerTable: string,
  req: AggregateRequest,
  dialect: Dialect,
  b: Bindings,
): string {
  const js = req.joinShape
  const related = js.relatedTable
  const fnSql = aggregateFnSql(req, related, dialect)
  const alias = dialect.quoteId(req.alias)

  let subquery: string

  if (js.through) {
    const pivot = js.through.pivotTable
    const pivotExprs = [
      `${qcol(pivot, js.through.foreignPivotKey, dialect)} = ${qcol(outerTable, js.parentColumn, dialect)}`,
      ...extraEqualsOn(pivot, js.extraEquals, dialect, b),
    ]
    // A join to the related table is needed only when the aggregate reads a
    // related column, filters on it, or must honor its soft-delete flag.
    const needJoin = req.fn === 'sum' || req.fn === 'min' || req.fn === 'max' || req.fn === 'avg'
      || req.constraintWheres.length > 0
      || js.softDeletes === true

    if (!needJoin) {
      subquery = `(SELECT ${fnSql} FROM ${dialect.quoteId(pivot)} WHERE ${andAll(pivotExprs)})`
    } else {
      const joined = [
        ...pivotExprs,
        ...req.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
        ...softDeleteOn(related, js.softDeletes, dialect),
      ]
      subquery =
        `(SELECT ${fnSql} FROM ${dialect.quoteId(pivot)} ` +
        `INNER JOIN ${dialect.quoteId(related)} ON ${qcol(related, js.relatedColumn, dialect)} = ${qcol(pivot, js.through.relatedPivotKey, dialect)} ` +
        `WHERE ${andAll(joined)})`
    }
  } else {
    const exprs = [
      `${qcol(related, js.relatedColumn, dialect)} = ${qcol(outerTable, js.parentColumn, dialect)}`,
      ...extraEqualsOn(related, js.extraEquals, dialect, b),
      ...req.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
      ...softDeleteOn(related, js.softDeletes, dialect),
    ]
    subquery = `(SELECT ${fnSql} FROM ${dialect.quoteId(related)} WHERE ${andAll(exprs)})`
  }

  const valueExpr = req.fn === 'exists' ? `(${subquery} > 0)` : subquery
  return `${valueExpr} AS ${alias}`
}

/** `["related"."deletedAt" IS NULL]` when the related Model soft-deletes, else `[]`. */
function softDeleteOn(table: string, softDeletes: boolean | undefined, dialect: Dialect): string[] {
  return softDeletes ? [`${qcol(table, 'deletedAt', dialect)} IS NULL`] : []
}

/**
 * Compile a single-scalar aggregate terminal — `SELECT fn(col) AS value FROM
 * table WHERE <wheres>` — for the `_aggregate(fn, column?)` contract method
 * (powers `instance.loadSum`/`loadMin`/etc.). `count`/`exists` ignore the
 * column and use `COUNT(*)`; the builder coerces the scalar afterward.
 */
export function compileScalarAggregate(
  state: NativeQueryState,
  dialect: Dialect,
  fn: AggregateRequest['fn'],
  column: string | undefined,
): CompiledQuery {
  const b = new Bindings(dialect)
  const table = dialect.quoteId(state.table)

  const expr =
    fn === 'count' || fn === 'exists' ? 'COUNT(*)'
    : fn === 'sum'                    ? `COALESCE(SUM(${dialect.quoteId(requireColumn(fn, column))}), 0)`
    :                                   `${fn.toUpperCase()}(${dialect.quoteId(requireColumn(fn, column))})`

  let sql = `SELECT ${expr} AS ${dialect.quoteId('value')} FROM ${table}`
  const where = compileWhere(state, dialect, b)
  if (where) sql += ` WHERE ${where}`
  return { sql, bindings: b.values }
}

/** @internal — exported for the query builder so it can share one `Bindings`
 *  run across the WHERE (clauses + EXISTS fragments) and the SELECT-list
 *  aggregate subselects. Construction is otherwise module-private. */
export function makeBindings(dialect: Dialect): Bindings {
  return new Bindings(dialect)
}

export type { Bindings }
