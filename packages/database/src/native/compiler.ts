// ─── SQL compiler (read path) ──────────────────────────────
//
// PURE: turns a {@link NativeQueryState} into a `{ sql, bindings }` pair via a
// {@link Dialect}. No driver, no `node:`, no I/O — this is the portable half of
// the engine (cross-phase rule 7). Every value is emitted as a bound parameter;
// only identifiers (validated + quoted by the dialect) ever reach the SQL text
// (cross-phase rule 2 — security gate).

import type {
  WhereClause,
  WhereOperator,
  OrderClause,
  RelationExistencePredicate,
  AggregateRequest,
  LockOptions,
} from '@rudderjs/contracts'
import { Expression } from '@rudderjs/contracts'
import { parseJsonPath, type Dialect, type DatePart, type JsonPathSegment, type JsonPathWrite } from './dialect.js'
import { NativeOrmError } from './errors.js'

/** A raw SQL fragment + its `?`-placeholder bindings, threaded through a clause. */
export interface RawFragment {
  sql:      string
  bindings: readonly unknown[]
}

/**
 * A node in the WHERE condition tree.
 *
 * - `clause` — a single `column <op> value` predicate.
 * - `group`  — a parenthesized sub-tree with its own boolean roots, produced by
 *   `whereGroup` / `orWhereGroup`. Nesting is unbounded. `negated: true`
 *   (from `whereNot` / `orWhereNot`) wraps the parenthesized tree in `NOT`.
 * - `date`   — a date-component predicate (`whereDate`/`whereTime`/`whereDay`/
 *   `whereMonth`/`whereYear`): the column runs through the dialect's
 *   `dateExtract` seam, the value binds.
 * - `json`   — a JSON-path comparison (`where('meta->prefs->lang', …)`): the
 *   column + validated segments run through the dialect's `jsonExtract` seam,
 *   the value binds (booleans normalized via `jsonBoolean`).
 * - `jsonContains` / `jsonLength` — `whereJsonContains` / `whereJsonLength`
 *   predicates through the matching dialect seams.
 *
 * Each node carries `boolean: 'AND' | 'OR'` recording how it joins to the
 * predicate *before* it at the same level. The first node's boolean is ignored.
 */
export type ConditionNode =
  | { kind: 'clause'; boolean: 'AND' | 'OR'; clause: WhereClause }
  | { kind: 'group';  boolean: 'AND' | 'OR'; children: ConditionNode[]; negated?: boolean }
  | { kind: 'raw';    boolean: 'AND' | 'OR'; raw: RawFragment }
  | { kind: 'column'; boolean: 'AND' | 'OR'; left: string; operator: WhereOperator; right: string }
  | { kind: 'date';   boolean: 'AND' | 'OR'; part: DatePart; column: string; operator: WhereOperator; value: unknown }
  | { kind: 'json';         boolean: 'AND' | 'OR'; column: string; segments: readonly JsonPathSegment[]; operator: WhereOperator; value: unknown }
  | { kind: 'jsonContains'; boolean: 'AND' | 'OR'; column: string; segments: readonly JsonPathSegment[]; value: unknown; negated: boolean }
  | { kind: 'jsonLength';   boolean: 'AND' | 'OR'; column: string; segments: readonly JsonPathSegment[]; operator: WhereOperator; value: number }
  | { kind: 'exists';       boolean: 'AND' | 'OR'; negated: boolean; body: SubqueryBody }

/**
 * A subquery body — another native query's captured state (`Model.query()` /
 * `adapter.query(...)` chains) or a raw SQL fragment. Shared by CTE bodies
 * ({@link CteNode}) and `whereExists` predicates. Builder-backed bodies keep
 * their own UNION members but drop ORDER BY / LIMIT (same rule as `union()`).
 */
export type SubqueryBody =
  | { kind: 'state'; state: NativeQueryState }
  | { kind: 'raw'; raw: RawFragment }

/**
 * A single ORDER BY entry — either a structured `column direction` clause or a
 * raw SQL fragment from `orderByRaw` / `orderBy(raw(...))`.
 */
export type OrderItem =
  | OrderClause
  | { kind: 'raw'; raw: RawFragment }

/**
 * One common table expression from `withExpression` / `withRecursiveExpression`.
 * The body is either another native query's state (`Model.query()` /
 * `adapter.query(...)` chains, captured like a UNION member) or a raw SQL
 * fragment — recursive bodies are usually raw, because they reference the CTE's
 * own name (`… UNION ALL SELECT … FROM cte_name …`), which a table-rooted
 * builder can't express. `columns` (optional) emits the explicit column list
 * (`name (col1, col2)`) most useful on recursive CTEs.
 */
export interface CteNode {
  name:      string
  recursive: boolean
  columns?:  readonly string[]
  body:      SubqueryBody
}

/** The four join flavors. `cross` carries no ON conditions. */
export type JoinType = 'inner' | 'left' | 'right' | 'cross'

/**
 * One condition inside a join's ON clause.
 * - `on`    — column-vs-column (`"posts"."userId" = "users"."id"`); nothing binds.
 * - `where` — column-vs-value (`"posts"."active" = ?`); the value binds.
 */
export type JoinCondition =
  | { kind: 'on';    boolean: 'AND' | 'OR'; left: string; operator: WhereOperator; right: string }
  | { kind: 'where'; boolean: 'AND' | 'OR'; clause: WhereClause }

/** A single JOIN: type + table + its ON condition list (empty for `cross`). */
export interface JoinNode {
  type:       JoinType
  table:      string
  conditions: JoinCondition[]
}

/** Window functions `selectWindow` accepts. The map to SQL names lives in
 *  {@link WINDOW_FUNCTION_SQL} — like the isolation-level map, the closed set
 *  IS the injection gate (the function name is spliced, never bound). All five
 *  are zero-argument ranking functions with identical syntax on SQLite ≥3.25,
 *  Postgres, and MySQL 8 — no dialect seam needed. */
export type WindowFunction = 'rowNumber' | 'rank' | 'denseRank' | 'percentRank' | 'cumeDist'

const WINDOW_FUNCTION_SQL: Record<WindowFunction, string> = {
  rowNumber:   'ROW_NUMBER',
  rank:        'RANK',
  denseRank:   'DENSE_RANK',
  percentRank: 'PERCENT_RANK',
  cumeDist:    'CUME_DIST',
}

/** Runtime membership check for {@link WindowFunction} — the builder's
 *  injection gate for the spliced function name (JS callers bypass the TS
 *  union). */
export function isWindowFunction(fn: string): fn is WindowFunction {
  return Object.prototype.hasOwnProperty.call(WINDOW_FUNCTION_SQL, fn)
}

/** One `fn() OVER (PARTITION BY … ORDER BY …) AS alias` projection entry from
 *  `selectWindow`. Identifiers quote at compile time; directions are validated
 *  to `asc`/`desc` by the builder. No bindings — the whole entry is identifiers
 *  + keywords. */
export interface WindowSelect {
  fn:          WindowFunction
  as:          string
  partitionBy: string[]
  orderBy:     Array<{ column: string; direction: 'asc' | 'desc' }>
}

/**
 * One entry in a HAVING clause.
 * - `clause` — `column <op> value` (the value binds); the column may be a
 *   SELECT alias (`having('post_count', '>', 3)`).
 * - `raw`    — a raw fragment, e.g. `havingRaw('COUNT(*) > ?', [3])` (the
 *   portable way to filter on an aggregate — Postgres won't accept an alias here).
 */
export type HavingNode =
  | { kind: 'clause'; boolean: 'AND' | 'OR'; clause: WhereClause }
  | { kind: 'raw';    boolean: 'AND' | 'OR'; raw: RawFragment }

/**
 * Everything the read compiler needs from a query. The `NativeQueryBuilder`
 * accumulates this; the compiler is otherwise stateless.
 */
export interface NativeQueryState {
  table:      string
  primaryKey: string
  conditions: ConditionNode[]
  orders:     OrderItem[]
  limitN:     number | null
  offsetN:    number | null
  /** Structured projection columns from `select(...)`. When present (with or
   *  without `rawSelects`) they REPLACE the default `*`. Each is identifier-
   *  quoted (qualified `table.col` supported); raw aliasing goes via `selectRaw`. */
  selects?:   string[]
  /** Raw projection fragments from `selectRaw`. When present they REPLACE the
   *  default `*` (Laravel semantics — `selectRaw` is a projection, not additive).
   *  Combined with `selects` in call order (structured first, then raw). */
  rawSelects?: RawFragment[]
  /** JOIN clauses from `join`/`leftJoin`/`rightJoin`/`crossJoin`, emitted
   *  between FROM and WHERE in declaration order. */
  joins?:     JoinNode[]
  /** `GROUP BY` columns from `groupBy(...)`, emitted after WHERE. Quoted
   *  (qualified `table.col` supported); no bindings. */
  groupBy?:   string[]
  /** `HAVING` predicates from `having`/`havingRaw`, emitted after GROUP BY.
   *  Their bound values follow the WHERE's and precede ORDER BY's. */
  having?:    HavingNode[]
  /** `UNION` / `UNION ALL` members from `union(...)`/`unionAll(...)`. Each member's
   *  own ORDER BY / LIMIT / OFFSET / lock are ignored — the BASE query's apply to
   *  the whole combined result. Member bindings follow the base body's in order. */
  unions?:    Array<{ all: boolean; state: NativeQueryState }>
  /** Common table expressions from `withExpression(...)`/`withRecursiveExpression(...)`.
   *  Emitted as a `WITH [RECURSIVE] name [(cols)] AS (body), …` prefix on reads
   *  (`compileSelect` + `compileCount`); their bindings come FIRST (SQL text
   *  order — the WITH clause precedes the main SELECT). */
  ctes?:      CteNode[]
  /** `SELECT DISTINCT` from `distinct()` — de-duplicates the projected rows. */
  distinct?:  boolean
  /** Window-function projections from `selectWindow(...)`. ADDITIVE — appended
   *  to the projection (after structured/raw selects, or after the default `*`
   *  when none replace it), unlike `selectRaw`'s REPLACE semantics: a ranking
   *  column is almost always wanted *alongside* the row. */
  windows?:   WindowSelect[]
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
  /** Pessimistic row lock from `lockForUpdate()` / `sharedLock()`. Emitted as
   *  the dialect's `FOR UPDATE` / `FOR SHARE` suffix after ORDER BY / LIMIT
   *  (no-op on SQLite). `null`/absent = no lock. */
  lock?: 'update' | 'shared' | null
  /** Wait behavior for the lock (`SKIP LOCKED` / `NOWAIT` on pg/mysql) —
   *  already validated mutually exclusive by the QueryBuilder. Only consulted
   *  when `lock` is set. `null`/absent = default blocking wait. */
  lockOptions?: LockOptions | null
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
    this.values.push(normalizeBindingValue(value))
    return ph
  }
}

/**
 * Serialize plain-object and array bindings to JSON text at the binding
 * funnel. A single SQL placeholder has no structural representation for a JS
 * object — JSON text is the only meaningful encoding, and it is exactly what
 * every dialect's `t.json()` column stores/parses. Without this, an object
 * payload on a json column (declaring `static casts = { col: 'json' }` is
 * easy to omit) failed per driver in three different ways: better-sqlite3
 * threw the opaque "named parameters in two different objects" TypeError,
 * mysql2 silently expanded the object into `` `key` = 'val' `` SQL pairs, and
 * porsager survived only when the server described the param as json/jsonb.
 * Stringifying once here makes all three dialects store identical JSON text,
 * which round-trips with the `json` cast's read path and with pg/mysql's
 * native JSON column parsing. Values a cast already serialized are strings by
 * the time they reach the funnel and pass through untouched; `IN` lists and
 * the dialect json seams (`jsonContains`/`jsonSet`) bind element-/pre-
 * stringified values, so no structural binding is ever meant to stay raw.
 *
 * Deliberately PLAIN objects only (`Object.prototype` or null prototype) plus
 * arrays: `Date`/`Buffer` keep their driver-level handling (porsager binds
 * Dates natively), and an accidentally-bound class instance (e.g. a Model)
 * should surface the driver's error rather than be silently stored as JSON.
 */
function normalizeBindingValue(value: unknown): unknown {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'object' && value !== null) {
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto === Object.prototype || proto === null) return JSON.stringify(value)
  }
  return value
}

/**
 * Splice a raw SQL fragment, rebinding its `?` placeholders to the dialect's
 * form via the shared {@link Bindings} (so `$n` indices stay correct on
 * Postgres and the values land in positional order across the whole statement).
 * The fragment's identifiers are NOT quoted — raw means raw, the caller owns it.
 * `?` count must equal `bindings.length` or we throw (a silent off-by-one would
 * misalign every subsequent placeholder).
 */
function compileRaw(frag: RawFragment, b: Bindings): string {
  const parts = frag.sql.split('?')
  const holes = parts.length - 1
  if (holes !== frag.bindings.length) {
    throw new Error(
      `[RudderJS ORM native] Raw SQL expects ${holes} binding(s) for its '?' placeholders but got ${frag.bindings.length}: ${frag.sql}`,
    )
  }
  let out = parts[0] ?? ''
  for (let i = 0; i < holes; i++) {
    out += b.add(frag.bindings[i]) + (parts[i + 1] ?? '')
  }
  return out
}

/**
 * Render one `WhereClause` to SQL. Null values route through `IS NULL` /
 * `IS NOT NULL` (a `= NULL` never matches in SQL); `IN`/`NOT IN` expand to a
 * parenthesized placeholder list (empty list → constant false/true).
 */
function compileClause(clause: WhereClause, dialect: Dialect, b: Bindings): string {
  return compileComparison(dialect.quoteId(clause.column), clause.operator, clause.value, b)
}

/**
 * Render `<lhs> <op> <value>` for an already-built left-hand expression — the
 * shared comparison tail of `compileClause` and the `json` condition kind.
 * Handles the `Expression` splice, `IN`/`NOT IN` list expansion, and
 * `IS [NOT] NULL` semantics; everything else binds positionally.
 */
function compileComparison(lhs: string, operator: WhereOperator, value: unknown, b: Bindings): string {
  // `where(col, op, raw('NOW()'))` — splice the expression verbatim, no binding.
  if (value instanceof Expression) {
    const op = OPERATOR_SQL[operator]
    if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(operator)}`)
    return `${lhs} ${op} ${value.getValue()}`
  }

  if (operator === 'IN' || operator === 'NOT IN') {
    const arr = Array.isArray(value) ? value : [value]
    if (arr.length === 0) {
      // `x IN ()` is a syntax error in SQLite; emit the equivalent constant.
      return operator === 'IN' ? '1 = 0' : '1 = 1'
    }
    // Splice raw Expression elements verbatim (mirrors the scalar branch above);
    // everything else binds positionally. JSON-boolean comparisons on MySQL feed
    // `raw('true')`/`raw('false')` through here, and `whereIn(col, [raw(...)])` is
    // a public-API form that must not bind the Expression object as a parameter.
    const list = arr.map(v => v instanceof Expression ? v.getValue() : b.add(v)).join(', ')
    return `${lhs} ${operator} (${list})`
  }

  // Null equality/inequality must use IS [NOT] NULL semantics.
  if (value === null && (operator === '=' || operator === '!=')) {
    return `${lhs} IS ${operator === '=' ? '' : 'NOT '}NULL`
  }

  const op = OPERATOR_SQL[operator]
  if (!op) {
    // Unreachable for a well-typed WhereOperator; guard keeps the compiler
    // honest if the contract grows an operator the native engine hasn't mapped.
    throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(operator)}`)
  }
  return `${lhs} ${op} ${b.add(value)}`
}

/**
 * Render a JSON arrow-path comparison for an already-quoted column expression —
 * the shared body of the `json` condition kind and arrow-path constraint wheres
 * inside `compileExists`. The value's JS type picks the extraction shape (pg
 * casts; mysql booleans skip UNQUOTE), and booleans normalize per dialect via
 * the jsonBoolean seam. `IN` probes its first element so a list of numbers
 * compares against the typed extraction. Null equality routes through the
 * {@link Dialect.jsonNullComparison} seam (mysql needs Laravel's
 * IS NULL OR JSON_TYPE = 'NULL' shape — a missing key and an explicit json
 * null both count as null on every dialect). Other comparison semantics
 * (Expression / IN) ride the shared {@link compileComparison} tail.
 */
function compileJsonComparison(
  columnExpr: string,
  segments:   readonly JsonPathSegment[],
  operator:   WhereOperator,
  value:      unknown,
  dialect:    Dialect,
  b:          Bindings,
): string {
  if (value === null && (operator === '=' || operator === '!=')) {
    return dialect.jsonNullComparison(columnExpr, segments, operator === '!=')
  }
  const probe = (operator === 'IN' || operator === 'NOT IN') && Array.isArray(value)
    ? value[0]
    : value
  const valueKind = typeof probe === 'number' ? 'number' : typeof probe === 'boolean' ? 'boolean' : 'text'
  const norm = (v: unknown): unknown => (typeof v === 'boolean' ? dialect.jsonBoolean(v) : v)
  const normalized = Array.isArray(value) ? value.map(norm) : norm(value)
  const expr = dialect.jsonExtract(columnExpr, segments, valueKind)
  return compileComparison(expr, operator, normalized, b)
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
    } else if (node.kind === 'raw') {
      frag = compileRaw(node.raw, b)
    } else if (node.kind === 'column') {
      // Column-vs-column (`whereColumn`) — both sides are identifiers, quoted
      // per dialect; nothing is bound. This is exactly why whereColumn can't
      // ride on whereRaw, which leaves identifiers un-quoted.
      const op = OPERATOR_SQL[node.operator]
      if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(node.operator)}`)
      frag = `${dialect.quoteId(node.left)} ${op} ${dialect.quoteId(node.right)}`
    } else if (node.kind === 'date') {
      // Date-component predicate (`whereDate`/`whereTime`/`whereDay`/…) — the
      // column is quoted then run through the dialect's extraction seam; the
      // value binds through the shared positional Bindings like any clause.
      const op = OPERATOR_SQL[node.operator]
      if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(node.operator)}`)
      frag = `${dialect.dateExtract(node.part, dialect.quoteId(node.column))} ${op} ${b.add(node.value)}`
    } else if (node.kind === 'json') {
      // JSON arrow-path comparison (`where('meta->prefs->lang', …)`) — shared
      // body in compileJsonComparison (also serves arrow-path constraint
      // wheres inside compileExists).
      frag = compileJsonComparison(dialect.quoteId(node.column), node.segments, node.operator, node.value, dialect, b)
    } else if (node.kind === 'jsonContains') {
      // whereJsonContains / whereJsonDoesntContain — the dialect seam owns the
      // whole predicate (pg @>, mysql JSON_CONTAINS, sqlite json_each EXISTS)
      // and binds through the shared Bindings via the callback.
      const expr = dialect.jsonContains(dialect.quoteId(node.column), node.segments, node.value, v => b.add(v))
      frag = node.negated ? `NOT (${expr})` : expr
    } else if (node.kind === 'jsonLength') {
      // whereJsonLength — array length via the dialect seam, the count binds.
      const op = OPERATOR_SQL[node.operator]
      if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(node.operator)}`)
      frag = `${dialect.jsonLength(dialect.quoteId(node.column), node.segments)} ${op} ${b.add(node.value)}`
    } else if (node.kind === 'exists') {
      // whereExists / whereNotExists — an arbitrary [NOT] EXISTS subquery.
      // Builder-backed bodies correlate to the outer query via qualified
      // whereColumn refs ('orders.userId' = 'users.id'); raw bodies rebind
      // their ? placeholders through the shared Bindings (text order — the
      // subquery sits exactly here in the WHERE).
      frag = `${node.negated ? 'NOT ' : ''}EXISTS (${compileSubqueryBody(node.body, dialect, b)})`
    } else {
      const inner = compileNodes(node.children, dialect, b)
      // An empty group contributes nothing — skip it entirely so it doesn't
      // emit dangling `AND ()` (or a constant `NOT ()`). The connector is keyed
      // off whether anything has been emitted yet (parts.length), not the
      // source index, so a leading skipped group never leaves a dangling
      // `AND`/`OR`.
      if (inner === '') continue
      // `negated` (whereNot / orWhereNot) wraps the parenthesized sub-tree.
      frag = node.negated ? `NOT (${inner})` : `(${inner})`
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

  const softExpr = compileSoftDelete(state, dialect)
  // Compile the existence predicates in order (shares the positional Bindings).
  const existsParts = (state.relationExists ?? []).map(pred => ({
    boolean: pred.boolean ?? 'AND',
    sql:     compileExists(state.table, pred, dialect, b),
  }))
  const hasOr = existsParts.some(p => p.boolean === 'OR')

  if (!hasOr) {
    // ── all-AND path (unchanged text) — whereHas/whereDoesntHave AND-ed at the
    // top level alongside soft-delete. Preserved verbatim so existing SQL holds.
    const others: string[] = []
    if (softExpr) others.push(softExpr)
    for (const part of existsParts) others.push(part.sql)

    if (!userExpr) return others.join(' AND ')
    if (others.length === 0) return userExpr

    // Parenthesize the user predicate when it has more than one top-level clause
    // so an inner top-level OR can't escape the AND. A single clause needs none.
    const wrapped = state.conditions.length > 1 ? `(${userExpr})` : userExpr
    return [wrapped, ...others].join(' AND ')
  }

  // ── OR-rooted existence predicate present ──
  // Fold the user clauses and the existence predicates into ONE predicate by
  // their booleans, then AND the soft-delete scope around the whole group so an
  // `orWhereHas` can't leak past the soft-delete filter.
  let predicate = userExpr
  for (const part of existsParts) {
    predicate = predicate === '' ? part.sql : `${predicate} ${part.boolean} ${part.sql}`
  }
  if (!softExpr) return predicate
  return `${softExpr} AND (${predicate})`
}

/** The `deletedAt IS [NOT] NULL` fragment, or `''` when not scoping. */
function compileSoftDelete(state: NativeQueryState, dialect: Dialect): string {
  if (state.softDelete === 'with') return ''
  const col = dialect.quoteId(state.deletedAtColumn)
  return state.softDelete === 'only' ? `${col} IS NOT NULL` : `${col} IS NULL`
}

/** ORDER BY fragment (without the keyword), or `''` when no orders. Raw order
 *  items splice verbatim (and may carry bindings — ORDER BY follows WHERE in the
 *  SQL text, so its placeholders bind after the WHERE's via the shared `b`). */
function compileOrderBy(orders: OrderItem[], dialect: Dialect, b: Bindings): string {
  return orders
    .map(o => ('kind' in o ? compileRaw(o.raw, b) : `${dialect.quoteId(o.column)} ${o.direction === 'DESC' ? 'DESC' : 'ASC'}`))
    .join(', ')
}

/** SQL keyword for each {@link JoinType}. */
const JOIN_KEYWORD: Record<JoinType, string> = {
  inner: 'INNER JOIN',
  left:  'LEFT JOIN',
  right: 'RIGHT JOIN',
  cross: 'CROSS JOIN',
}

/** Render a join's ON condition list into one boolean expression. `on` nodes are
 *  column-vs-column (both sides quoted, nothing bound); `where` nodes bind their
 *  value through the shared {@link Bindings}. */
function compileJoinConditions(conditions: JoinCondition[], dialect: Dialect, b: Bindings): string {
  const parts: string[] = []
  for (const c of conditions) {
    let frag: string
    if (c.kind === 'on') {
      const op = OPERATOR_SQL[c.operator]
      if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(c.operator)}`)
      frag = `${dialect.quoteId(c.left)} ${op} ${dialect.quoteId(c.right)}`
    } else {
      frag = compileClause(c.clause, dialect, b)
    }
    parts.push(parts.length === 0 ? frag : `${c.boolean} ${frag}`)
  }
  return parts.join(' ')
}

/**
 * Compile the JOIN clauses (`''` when none). Emitted after FROM and before
 * WHERE — so any bound values in a join's `where` condition land in positional
 * order after the SELECT-list bindings (rawSelects/aggregates) and before the
 * WHERE's. Shares the caller's {@link Bindings} to keep that order correct.
 */
function compileJoins(joins: JoinNode[], dialect: Dialect, b: Bindings): string {
  return joins
    .map(j => {
      const table = dialect.quoteId(j.table)
      const keyword = JOIN_KEYWORD[j.type]
      if (j.type === 'cross') return `${keyword} ${table}`
      const on = compileJoinConditions(j.conditions, dialect, b)
      if (on === '') {
        throw new Error(`[RudderJS ORM native] ${keyword} ${j.table} requires at least one ON condition.`)
      }
      return `${keyword} ${table} ON ${on}`
    })
    .join(' ')
}

/** `GROUP BY` column list (without the keyword), or `''` when none. Each column
 *  is identifier-quoted (qualified `table.col` supported); no values bind. */
function compileGroupBy(groupBy: string[], dialect: Dialect): string {
  return groupBy.map(c => dialect.quoteId(c)).join(', ')
}

/** HAVING expression (without the keyword), or `''` when none. `clause` entries
 *  bind their value; `raw` entries splice verbatim (and may bind via the shared
 *  {@link Bindings}). Booleans connect siblings, first ignored — mirrors WHERE. */
function compileHaving(having: HavingNode[], dialect: Dialect, b: Bindings): string {
  const parts: string[] = []
  for (const node of having) {
    const frag = node.kind === 'raw' ? compileRaw(node.raw, b) : compileClause(node.clause, dialect, b)
    parts.push(parts.length === 0 ? frag : `${node.boolean} ${frag}`)
  }
  return parts.join(' ')
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

  // WITH prefix first — CTE-body bindings precede every other parameter (the
  // WITH clause is the first SQL text). '' when the query declares no CTEs.
  let sql = compileCtePrefix(state.ctes ?? [], dialect, b)

  // Base SELECT body (projection → HAVING; no ORDER BY / LIMIT / lock — those
  // apply to the whole result, after any UNION). `overrides` only touch the base.
  sql += compileSelectBody(state, dialect, b, overrides)

  // UNION / UNION ALL members. Each member's body shares the same `Bindings`, so
  // its parameters land positionally after the base body's. Member ORDER BY /
  // LIMIT are intentionally dropped (compileSelectBody emits neither).
  for (const u of state.unions ?? []) {
    sql += ` UNION ${u.all ? 'ALL ' : ''}${compileSelectBody(u.state, dialect, b)}`
  }

  // ORDER BY / LIMIT / OFFSET / lock come from the BASE state and apply to the
  // combined result. Binds after every union member's parameters (SQL text order).
  const orderBy = compileOrderBy(state.orders, dialect, b)
  if (orderBy) sql += ` ORDER BY ${orderBy}`

  const limit = overrides.limit !== undefined ? overrides.limit : state.limitN
  if (limit !== null && limit !== undefined) sql += ` LIMIT ${asInt(limit)}`

  if (state.offsetN !== null) {
    // An OFFSET without a LIMIT needs a dialect-specific LIMIT clause: SQLite
    // and MySQL require a LIMIT before OFFSET (and reject `LIMIT -1` / negative
    // limits respectively), Postgres accepts a bare OFFSET.
    if (limit === null || limit === undefined) {
      const noLimit = dialect.offsetWithoutLimitClause()
      if (noLimit) sql += ` ${noLimit}`
    }
    sql += ` OFFSET ${asInt(state.offsetN)}`
  }

  // Pessimistic lock trails everything (standard SQL puts the locking clause
  // last). dialect.lockSql returns '' on engines without row locks (SQLite).
  if (state.lock) sql += dialect.lockSql(state.lock, state.lockOptions ?? undefined)

  return { sql, bindings: b.values }
}

/**
 * Compile the `WITH [RECURSIVE] name [(cols)] AS (body), …` prefix (trailing
 * space included) — or `''` when `ctes` is empty. `RECURSIVE` is a property of
 * the whole WITH list (standard SQL): one recursive member marks the list.
 * Builder-backed bodies compile through {@link compileSelectBody} (+ their own
 * UNION members — recursive-style bodies built from two queries `union`ed work);
 * raw bodies rebind their `?` placeholders through the shared {@link Bindings}.
 * Body ORDER BY / LIMIT are dropped, same rule as UNION members.
 */
function compileCtePrefix(ctes: readonly CteNode[], dialect: Dialect, b: Bindings): string {
  if (ctes.length === 0) return ''
  const parts = ctes.map(cte => {
    const name = dialect.quoteId(cte.name)
    const cols = cte.columns && cte.columns.length > 0
      ? ` (${cte.columns.map(c => dialect.quoteId(c)).join(', ')})`
      : ''
    return `${name}${cols} AS (${compileSubqueryBody(cte.body, dialect, b)})`
  })
  const recursive = ctes.some(c => c.recursive)
  return `WITH ${recursive ? 'RECURSIVE ' : ''}${parts.join(', ')} `
}

/**
 * Compile a {@link SubqueryBody} (CTE body / `whereExists` subquery) through
 * the caller's shared {@link Bindings}. Builder-backed bodies compile via
 * {@link compileSelectBody} plus their own UNION members (ORDER BY / LIMIT
 * dropped — the UNION-member rule); raw bodies rebind their `?` placeholders.
 */
function compileSubqueryBody(body: SubqueryBody, dialect: Dialect, b: Bindings): string {
  if (body.kind === 'raw') return compileRaw(body.raw, b)
  let sql = compileSelectBody(body.state, dialect, b)
  for (const u of body.state.unions ?? []) {
    sql += ` UNION ${u.all ? 'ALL ' : ''}${compileSelectBody(u.state, dialect, b)}`
  }
  return sql
}

/**
 * The SELECT body up to and including HAVING — projection, FROM, JOINs, WHERE,
 * GROUP BY, HAVING — with NO ORDER BY / LIMIT / OFFSET / lock. Shared by
 * {@link compileSelect} (which appends those) and the UNION members + the
 * wrapped {@link compileCount}. Uses the caller's {@link Bindings} so positional
 * parameters stay aligned across the whole (possibly unioned) statement.
 */
function compileSelectBody(
  state: NativeQueryState,
  dialect: Dialect,
  b: Bindings,
  overrides: { selectColumns?: string; extraConditions?: ConditionNode[] } = {},
): string {
  const table = dialect.quoteId(state.table)

  // `select(...)` / `selectRaw` REPLACE the default `*` projection (Laravel
  // semantics). Structured columns (quoted) come first, then raw fragments —
  // compiled before the WHERE so any `?` bindings land first (SELECT precedes
  // WHERE in SQL text). `overrides.selectColumns` (terminal-injected) still wins.
  const structuredSelects = (state.selects ?? []).map(c => dialect.quoteId(c))
  const rawSelects = state.rawSelects ?? []
  const projection = [...structuredSelects, ...rawSelects.map(frag => compileRaw(frag, b))]
  const baseSelect = overrides.selectColumns
    ?? (projection.length > 0 ? projection.join(', ') : '*')

  // Aggregate subselects (withCount/withSum/…) join the SELECT list. They're
  // compiled BEFORE the WHERE so their bindings land first — matching the SQL
  // text order (SELECT list precedes WHERE).
  const aggParts = (state.aggregates ?? []).map(req => compileAggregateSubselect(state.table, req, dialect, b))
  // Window projections are ADDITIVE (appended after the base projection +
  // aggregates) and bind-free — pure identifiers and keywords.
  const windowParts = (state.windows ?? []).map(w => compileWindowSelect(w, dialect))
  const extraParts = [...aggParts, ...windowParts]
  const selectList = extraParts.length > 0 ? [baseSelect, ...extraParts].join(', ') : baseSelect

  let sql = `SELECT ${state.distinct ? 'DISTINCT ' : ''}${selectList} FROM ${table}`

  // JOINs sit between FROM and WHERE; their `where`-condition bindings (if any)
  // land after the SELECT-list bindings and before the WHERE's — SQL text order.
  const joins = compileJoins(state.joins ?? [], dialect, b)
  if (joins) sql += ` ${joins}`

  const where = compileWhereWithExtra(state, dialect, b, overrides.extraConditions)
  if (where) sql += ` WHERE ${where}`

  // GROUP BY (no bindings) then HAVING (binds after WHERE, before ORDER BY).
  const groupBy = compileGroupBy(state.groupBy ?? [], dialect)
  if (groupBy) sql += ` GROUP BY ${groupBy}`
  const having = compileHaving(state.having ?? [], dialect, b)
  if (having) sql += ` HAVING ${having}`

  return sql
}

/** `ROW_NUMBER() OVER (PARTITION BY "a" ORDER BY "b" DESC) AS "alias"`. The
 *  function name comes from the closed {@link WINDOW_FUNCTION_SQL} map (the
 *  injection gate — `selectWindow` validates membership); every identifier is
 *  quoted; directions are pre-validated to `asc`/`desc`. */
function compileWindowSelect(w: WindowSelect, dialect: Dialect): string {
  const parts: string[] = []
  if (w.partitionBy.length > 0) {
    parts.push(`PARTITION BY ${w.partitionBy.map(c => dialect.quoteId(c)).join(', ')}`)
  }
  if (w.orderBy.length > 0) {
    parts.push(`ORDER BY ${w.orderBy.map(o => `${dialect.quoteId(o.column)} ${o.direction === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}`)
  }
  return `${WINDOW_FUNCTION_SQL[w.fn]}() OVER (${parts.join(' ')}) AS ${dialect.quoteId(w.as)}`
}

/** Compile `SELECT COUNT(*) AS count FROM ... WHERE ...` for `count()` /
 *  `paginate()` totals. Orders/limit/offset are irrelevant to a count. */
export function compileCount(state: NativeQueryState, dialect: Dialect): CompiledQuery {
  const b = new Bindings(dialect)
  const table = dialect.quoteId(state.table)
  const countCol = dialect.quoteId('count')

  // WITH prefix first (same rule as compileSelect) — CTE bindings precede all.
  const cte = compileCtePrefix(state.ctes ?? [], dialect, b)

  // A UNION counts the rows of the COMBINED result — wrap the whole union body
  // (each member carries its own GROUP BY/HAVING). Takes precedence over the
  // GROUP BY wrap below; member ORDER BY/LIMIT are irrelevant to a count.
  const unions = state.unions ?? []
  if (unions.length > 0) {
    let inner = compileSelectBody(state, dialect, b)
    for (const u of unions) inner += ` UNION ${u.all ? 'ALL ' : ''}${compileSelectBody(u.state, dialect, b)}`
    const sql = `${cte}SELECT COUNT(*) AS ${countCol} FROM (${inner}) AS ${dialect.quoteId('aggregate')}`
    return { sql, bindings: b.values }
  }

  // DISTINCT counts the number of DISTINCT projected rows — wrap the SELECT
  // DISTINCT body (a bare `COUNT(DISTINCT *)` isn't valid SQL).
  if (state.distinct) {
    const inner = compileSelectBody(state, dialect, b)
    const sql = `${cte}SELECT COUNT(*) AS ${countCol} FROM (${inner}) AS ${dialect.quoteId('aggregate')}`
    return { sql, bindings: b.values }
  }

  const joins = compileJoins(state.joins ?? [], dialect, b)
  const where = compileWhere(state, dialect, b)
  const groupBy = state.groupBy ?? []

  // No GROUP BY → a plain scalar COUNT(*).
  if (groupBy.length === 0) {
    let sql = `${cte}SELECT COUNT(*) AS ${countCol} FROM ${table}`
    if (joins) sql += ` ${joins}`
    if (where) sql += ` WHERE ${where}`
    return { sql, bindings: b.values }
  }

  // With GROUP BY, `COUNT(*)` would return one row per group. Laravel counts the
  // NUMBER OF GROUPS by wrapping the grouped query in a subquery — so paginate()
  // totals and count() agree. WHERE binds before HAVING (text order) via shared b.
  let inner = `SELECT 1 FROM ${table}`
  if (joins) inner += ` ${joins}`
  if (where) inner += ` WHERE ${where}`
  inner += ` GROUP BY ${compileGroupBy(groupBy, dialect)}`
  const having = compileHaving(state.having ?? [], dialect, b)
  if (having) inner += ` HAVING ${having}`
  const sql = `${cte}SELECT COUNT(*) AS ${countCol} FROM (${inner}) AS ${dialect.quoteId('aggregate')}`
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
 * Compile `INSERT INTO table (cols) SELECT …` for `insertUsing(columns, query)`
 * — the rows come from a subquery (builder state or raw SQL), not VALUES
 * tuples. Column names are identifier-quoted; the subquery compiles through
 * the shared {@link Bindings} (raw `?` placeholders rebound per dialect). The
 * column list is REQUIRED — the subquery's projection order must be pinned to
 * named target columns, a bare `INSERT INTO t SELECT …` is a column-order
 * footgun.
 */
export function compileInsertUsing(
  state: NativeQueryState,
  dialect: Dialect,
  columns: readonly string[],
  body: SubqueryBody,
  opts: { returning?: boolean } = {},
): CompiledQuery {
  if (columns.length === 0) {
    throw new NativeOrmError(
      'NATIVE_INSERT_USING_COLUMNS',
      'insertUsing() requires an explicit target column list — the subquery projection maps to it positionally.',
    )
  }
  const b = new Bindings(dialect)
  const cols = columns.map(c => dialect.quoteId(c)).join(', ')
  let sql = `INSERT INTO ${dialect.quoteId(state.table)} (${cols}) ${compileSubqueryBody(body, dialect, b)}`
  if (opts.returning) sql += ` RETURNING *`
  return { sql, bindings: b.values }
}

/**
 * Render the SET clause for an UPDATE payload containing arrow-path keys
 * (`'meta->prefs->lang': 'en'` → `"meta" = json_set("meta", '$."prefs"."lang"', json(?))`).
 *
 * All arrow writes on one base column merge into a single assignment (the
 * dialect's `jsonSet` seam takes the write list) — SQL forbids assigning the
 * same column twice in one SET. Plain keys keep their original form. SET items
 * appear in first-seen key order, values binding left-to-right in SQL-text
 * order. Mixing a plain write and an arrow write to the same column throws —
 * the two assignments would silently race, last-one-wins, per dialect.
 */
function compileJsonSetClause(
  entries: Array<[string, unknown]>,
  dialect: Dialect,
  b: Bindings,
): string {
  type SetItem =
    | { kind: 'plain'; column: string; value: unknown }
    | { kind: 'json';  column: string; writes: JsonPathWrite[] }
  const items: SetItem[] = []
  const jsonByColumn = new Map<string, Extract<SetItem, { kind: 'json' }>>()
  const plainColumns = new Set<string>()

  const conflict = (column: string): never => {
    throw new NativeOrmError(
      'NATIVE_JSON_SET_CONFLICT',
      `[RudderJS ORM native] Update payload writes both the whole column "${column}" and a JSON path inside it — ` +
      `pick one (the two assignments would conflict in a single SET).`,
    )
  }

  for (const [key, value] of entries) {
    if (key.includes('->')) {
      const { column, segments } = parseJsonPath(key)
      if (plainColumns.has(column)) conflict(column)
      let item = jsonByColumn.get(column)
      if (!item) {
        item = { kind: 'json', column, writes: [] }
        jsonByColumn.set(column, item)
        items.push(item)
      }
      item.writes.push({ segments, value })
    } else {
      if (jsonByColumn.has(key)) conflict(key)
      plainColumns.add(key)
      items.push({ kind: 'plain', column: key, value })
    }
  }

  return items.map(item => {
    const col = dialect.quoteId(item.column)
    return item.kind === 'plain'
      ? `${col} = ${b.add(item.value)}`
      : `${col} = ${dialect.jsonSet(col, item.writes, v => b.add(v))}`
  }).join(', ')
}

/**
 * Compile `UPDATE <table> SET col = ? [, …] [WHERE …] [RETURNING *]`.
 *
 * SET bindings are emitted before WHERE bindings, matching positional `?`
 * order. `undefined`-valued columns are dropped (see {@link definedEntries}).
 * Throws when there's nothing to set.
 *
 * Arrow-path keys (`'meta->prefs->lang'`) write into a JSON column via the
 * dialect's `jsonSet` seam — see {@link compileJsonSetClause}. Payloads with
 * no arrow key take the original plain path (byte-identical SQL).
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
  const setClause = entries.some(([col]) => col.includes('->'))
    ? compileJsonSetClause(entries, dialect, b)
    : entries.map(([col, v]) => `${dialect.quoteId(col)} = ${b.add(v)}`).join(', ')

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
 *
 * Arrow-path columns (`meta->prefs->lang`, from a `where()` inside a whereHas
 * constrain callback) route through the same {@link compileJsonComparison}
 * body as top-level `json` condition nodes — the base column is qualified +
 * quoted, the path segments are validated by {@link parseJsonPath}, and the
 * value binds through the shared positional {@link Bindings} so it lands in
 * SQL-text order within the EXISTS body.
 */
function compileClauseOn(table: string, clause: WhereClause, dialect: Dialect, b: Bindings): string {
  if (clause.column.includes('->')) {
    const { column, segments } = parseJsonPath(clause.column)
    return compileJsonComparison(qcol(table, column, dialect), segments, clause.operator, clause.value, dialect, b)
  }
  const col = qcol(table, clause.column, dialect)
  const { operator, value } = clause

  if (operator === 'IN' || operator === 'NOT IN') {
    const arr = Array.isArray(value) ? value : [value]
    if (arr.length === 0) return operator === 'IN' ? '1 = 0' : '1 = 1'
    // Splice raw Expression elements verbatim; everything else binds positionally.
    const list = arr.map(v => v instanceof Expression ? v.getValue() : b.add(v)).join(', ')
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
/** Normalize a predicate's `nested` field to a child list: dot-paths emit the
 *  singular form, callback nesting the array form (siblings AND together —
 *  each compiles recursively to its own correlated EXISTS on the related
 *  table, with its own `exists` flag and constraints). */
function nestedChildren(p: RelationExistencePredicate): RelationExistencePredicate[] {
  if (p.nested === undefined) return []
  return Array.isArray(p.nested) ? p.nested : [p.nested]
}

export function compileExists(
  outerTable: string,
  predicate: RelationExistencePredicate,
  dialect: Dialect,
  b: Bindings,
): string {
  const related = predicate.relatedTable

  // Fan-out through relations (hasOneThrough/hasManyThrough) with a count
  // comparison short-circuit BEFORE the generic body compilation (so the
  // shared Bindings sees each value exactly once): the intermediate is 1:N to
  // the far table, so `COUNT(*)` over the pivot-shaped body would count
  // INTERMEDIATES (users with ≥1 post), not far rows (posts). Count the join
  // product instead. Pivot relations keep the pivot-count shape
  // byte-identical (1:1 — the counts coincide). Plain existence falls
  // through: the nested-EXISTS shape below is already fan-out-correct.
  if (predicate.count && predicate.through?.fanOut) {
    const op = OPERATOR_SQL[predicate.count.operator]
    if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(predicate.count.operator)}`)
    const pivot  = predicate.through.pivotTable
    const joined = [
      `${qcol(pivot, predicate.through.foreignPivotKey, dialect)} = ${qcol(outerTable, predicate.parentColumn, dialect)}`,
      ...extraEqualsOn(pivot, predicate.extraEquals, dialect, b),
      ...predicate.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
      ...nestedChildren(predicate).map(c => compileExists(related, c, dialect, b)),
    ]
    return (
      `(SELECT COUNT(*) FROM ${dialect.quoteId(pivot)} ` +
      `INNER JOIN ${dialect.quoteId(related)} ON ${qcol(related, predicate.relatedColumn, dialect)} = ${qcol(pivot, predicate.through.relatedPivotKey, dialect)} ` +
      `WHERE ${andAll(joined)}) ${op} ${asInt(predicate.count.value)}`
    )
  }

  // The subquery's FROM table + WHERE body — shared by the EXISTS and the
  // `COUNT(*) op N` wrappers below.
  let fromTable: string
  let whereBody: string

  if (predicate.through) {
    const pivot = predicate.through.pivotTable
    // Compile in SQL-TEXT order so the shared `Bindings` stays positionally
    // aligned: the pivot's `extraEquals` appears in the text BEFORE the nested
    // inner EXISTS, so its parameters must bind first. (Building the inner
    // EXISTS first would swap `taggableType` and the related constraint.)
    const pivotKeyExpr = `${qcol(pivot, predicate.through.foreignPivotKey, dialect)} = ${qcol(outerTable, predicate.parentColumn, dialect)}`
    const extraExprs   = extraEqualsOn(pivot, predicate.extraEquals, dialect, b)

    // Inner: the related row joined to this pivot row, plus constraint wheres,
    // plus the child predicate of a nested path (correlated against the
    // related table, so it lives inside the related row's EXISTS — not the
    // pivot's). Recursion handles arbitrarily deep chains; compiled LAST so
    // its bindings follow the constraint values (SQL-text order).
    const innerExprs = [
      `${qcol(related, predicate.relatedColumn, dialect)} = ${qcol(pivot, predicate.through.relatedPivotKey, dialect)}`,
      ...predicate.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
      ...nestedChildren(predicate).map(c => compileExists(related, c, dialect, b)),
    ]
    const innerExists = `EXISTS (SELECT 1 FROM ${dialect.quoteId(related)} WHERE ${andAll(innerExprs)})`

    fromTable = pivot
    whereBody = andAll([pivotKeyExpr, ...extraExprs, innerExists])
  } else {
    // Direct: one correlated subquery on the related table. A nested child
    // predicate (`whereHas('posts.comments')`) appends its own correlated
    // EXISTS to the body — compiled LAST in text order, after the constraint
    // wheres, so the shared Bindings stay positionally aligned.
    fromTable = related
    whereBody = andAll([
      `${qcol(related, predicate.relatedColumn, dialect)} = ${qcol(outerTable, predicate.parentColumn, dialect)}`,
      ...extraEqualsOn(related, predicate.extraEquals, dialect, b),
      ...predicate.constraintWheres.map(w => compileClauseOn(related, w, dialect, b)),
      ...nestedChildren(predicate).map(c => compileExists(related, c, dialect, b)),
    ])
  }

  // `has(relation, op, n)` — count the matching rows instead of testing
  // existence. The integer is validated + inlined (not bound) so it can't shift
  // the surrounding WHERE's positional bindings.
  if (predicate.count) {
    const op = OPERATOR_SQL[predicate.count.operator]
    if (!op) throw new Error(`[RudderJS ORM native] Unsupported operator: ${String(predicate.count.operator)}`)
    return `(SELECT COUNT(*) FROM ${dialect.quoteId(fromTable)} WHERE ${whereBody}) ${op} ${asInt(predicate.count.value)}`
  }

  const keyword = predicate.exists ? 'EXISTS' : 'NOT EXISTS'
  return `${keyword} (SELECT 1 FROM ${dialect.quoteId(fromTable)} WHERE ${whereBody})`
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
    // related column, filters on it, or must honor its soft-delete flag —
    // or ALWAYS for fan-out through relations: the pivot fast path counts
    // intermediate rows (and implies existence from a bare intermediate),
    // which under-counts / false-positives when intermediate→related is 1:N.
    // The join branch aggregates the join product (one row per far row).
    const needJoin = req.fn === 'sum' || req.fn === 'min' || req.fn === 'max' || req.fn === 'avg'
      || req.constraintWheres.length > 0
      || js.softDeletes === true
      || js.through.fanOut === true

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

/** Engine-internal seam — exported for the query builder so it can share one
 *  `Bindings` run across the WHERE (clauses + EXISTS fragments) and the
 *  SELECT-list aggregate subselects. Construction is otherwise module-private.
 *  (Deliberately NOT tagged internal: `stripInternal` would drop it from the
 *  emitted d.ts, and it is consumed cross-package by @rudderjs/orm's engine
 *  suites until PR-A3.) */
export function makeBindings(dialect: Dialect): Bindings {
  return new Bindings(dialect)
}

export type { Bindings }
