// ─── Schema → TypeScript types generator (GATE 7-types) ────
//
// The headline of the migrations plan: after `migrate`, a model's column types
// are GENERATED from the live schema, not hand-maintained — so they can't drift.
// This module is the PURE core: it turns introspected columns (+ a model's
// declared `casts`) into a `SchemaRegistry` `.d.ts` that augments `@rudderjs/orm`,
// which `Model<'table'>` then resolves. Mirrors `@rudderjs/vite`'s scanner
// emitting `.rudder/types/views.d.ts` (same "generated .d.ts augments framework
// types" pattern).
//
// PURE: string building only. The node-only orchestration (introspect every
// table → write the file) lives in `schema-types.ts`; the runtime DB reads live
// in `introspect.ts`. Keeping the mapping pure makes the column→TS contract
// directly unit-testable.

import type { RawColumn } from './introspect.js'
import type { BuiltInCast } from '@rudderjs/contracts'

/** A column's resolved TypeScript type plus whether it's optional on read. */
export interface GeneratedColumnType {
  /** The TS type expression, e.g. `string`, `number | null`, `Date`. */
  ts:       string
  /** Column name (carried through for the emitter). */
  name:     string
}

/** One table's generated shape: name → ordered column types. */
export interface TableTypes {
  table:   string
  columns: GeneratedColumnType[]
}

/**
 * Map a SQLite declared type (`PRAGMA table_info.type`) to a base TS type. The
 * mapping is by affinity rules — SQLite types are fuzzy, so we match on
 * substrings the same way SQLite's own affinity algorithm does (INT→integer,
 * CHAR/CLOB/TEXT→text, BLOB→blob, REAL/FLOA/DOUB→real, else numeric).
 */
export function sqliteTypeToTs(declared: string): string {
  const t = declared.toUpperCase()
  if (t.includes('INT')) return 'number'
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'string'
  if (t.includes('BLOB') || t === '') return 'Uint8Array'
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'number'
  return 'number' // NUMERIC / DECIMAL affinity — stored as number
}

/**
 * Map a Postgres `information_schema.columns.data_type` to a base TS type. The
 * mapping reflects what the porsager driver actually returns on READ (so the
 * generated type matches runtime), which `casts` then refine:
 *  - `int8`/`bigint` → `number` (the pg driver parses OID 20 to a JS number);
 *  - `numeric`/`money` → `string` (porsager keeps these as strings for
 *    precision safety — a `float`/`decimal` cast refines them to `number`);
 *  - `json`/`jsonb` → `unknown` (a `json` cast or a typed `casts` entry refines);
 *  - `timestamp*`/`date` → `Date`; `bytea` → `Uint8Array`; the rest → `string`.
 */
export function pgTypeToTs(declared: string): string {
  const t = declared.toLowerCase()
  switch (t) {
    case 'boolean':                     return 'boolean'
    case 'smallint':
    case 'integer':
    case 'bigint':
    case 'real':
    case 'double precision':            return 'number'
    case 'numeric':
    case 'money':                       return 'string'
    case 'json':
    case 'jsonb':                       return 'unknown'
    case 'bytea':                       return 'Uint8Array'
    case 'date':                        return 'Date'
    default:
      // varchar/char surface as `character varying`/`character`; timestamps as
      // `timestamp with/without time zone`; times as `time …`. Match by prefix.
      if (t.startsWith('timestamp')) return 'Date'
      if (t.startsWith('character') || t.startsWith('time') || t === 'text' || t === 'uuid') return 'string'
      return 'unknown'
  }
}

/**
 * Map a MySQL `information_schema.columns.data_type` to a base TS type. The
 * `data_type` is the base type WITHOUT length/precision, which `casts` then
 * refine:
 *  - integer family (`tinyint`/`smallint`/`mediumint`/`int`/`bigint`) → `number`.
 *    Note `tinyint(1)` (MySQL's BOOLEAN alias) surfaces as `tinyint` here → `number`;
 *    a declared `boolean` cast refines it to `boolean` (same treatment as pg);
 *  - `decimal`/`numeric` → `string` (precision safety, matching pg — a
 *    `float`/`decimal` cast refines to `number`);
 *  - `float`/`double`/`real` → `number`;
 *  - `json` → `unknown` (a `json` cast or typed `casts` entry refines);
 *  - `date`/`datetime`/`timestamp` → `Date`; `blob`/`binary` → `Uint8Array`;
 *  - char/text families → `string`; everything else → `unknown`.
 */
export function mysqlTypeToTs(declared: string): string {
  const t = declared.toLowerCase()
  switch (t) {
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'int':
    case 'integer':
    case 'bigint':                return 'number'
    case 'decimal':
    case 'numeric':               return 'string'
    case 'float':
    case 'double':
    case 'double precision':
    case 'real':                  return 'number'
    case 'json':                  return 'unknown'
    case 'date':
    case 'datetime':
    case 'timestamp':             return 'Date'
    default:
      // varchar/char/text families → string; blob/binary families → Uint8Array.
      if (t.includes('char') || t.includes('text') || t === 'enum' || t === 'set') return 'string'
      if (t.includes('blob') || t.includes('binary')) return 'Uint8Array'
      return 'unknown'
  }
}

/**
 * The TS type a declared cast produces on READ (`toJSON`/hydration). Casts
 * OVERRIDE the storage type — a `boolean` cast turns an INTEGER column into
 * `boolean`, a `json` cast turns TEXT into `unknown`, etc. Returns null for
 * casts that don't change the read type (or unknown cast names), so the caller
 * falls back to the storage mapping.
 */
export function castToTs(cast: BuiltInCast | string): string | null {
  switch (cast) {
    case 'boolean':           return 'boolean'
    case 'integer':           return 'number'
    case 'float':             return 'number'
    case 'string':            return 'string'
    case 'encrypted':         return 'string'
    case 'date':              return 'Date'
    case 'datetime':          return 'Date'
    case 'json':              return 'unknown'
    case 'array':             return 'unknown[]'
    case 'encrypted:array':   return 'unknown[]'
    case 'collection':        return 'unknown[]'
    case 'encrypted:object':  return 'Record<string, unknown>'
    default:
      // `vector(...)` and custom CastUsing classes resolve to number[] / unknown;
      // be conservative — unknown name → let storage type win.
      return null
  }
}

/**
 * Resolve one column's TS type: a declared cast wins over the storage mapping,
 * and a nullable column widens with `| null`. The primary key and NOT NULL
 * columns stay non-null. `typeToTs` is the per-dialect storage mapper
 * ({@link sqliteTypeToTs} by default; {@link pgTypeToTs} for Postgres).
 */
export function resolveColumnType(
  col: RawColumn,
  casts: Record<string, string>,
  typeToTs: (declared: string) => string = sqliteTypeToTs,
): GeneratedColumnType {
  const declaredCast = casts[col.name]
  const base = (declaredCast && castToTs(declaredCast)) || typeToTs(col.type)
  // A column is nullable on read when it permits NULL and isn't the PK.
  const nullable = !col.notNull && col.pk === 0
  return { name: col.name, ts: nullable ? `${base} | null` : base }
}

/** Build one table's {@link TableTypes} from its columns + casts, using the
 *  given per-dialect storage mapper (defaults to the SQLite mapping). */
export function buildTableTypes(
  table: string,
  columns: RawColumn[],
  casts: Record<string, string> = {},
  typeToTs: (declared: string) => string = sqliteTypeToTs,
): TableTypes {
  return { table, columns: columns.map((c) => resolveColumnType(c, casts, typeToTs)) }
}

/**
 * Emit the full `registry.d.ts` contents: a `declare module '@rudderjs/orm'`
 * augmentation extending `SchemaRegistry` with one entry per table. Tables are
 * sorted for deterministic output (stable diffs / git). An empty schema still
 * emits a valid (empty) augmentation so a stale file is always overwritten.
 */
export function emitRegistryDts(tables: TableTypes[]): string {
  const sorted = [...tables].sort((a, b) => a.table.localeCompare(b.table))
  const entries = sorted.map((t) => {
    const cols = t.columns.map((c) => `      ${quoteKey(c.name)}: ${c.ts}`).join('\n')
    return `    ${quoteKey(t.table)}: {\n${cols}\n    }`
  }).join('\n')

  return (
    `// AUTO-GENERATED by @rudderjs/orm — do not edit.\n` +
    `// Source: the migrated database schema (run \`rudder schema:types\` or \`migrate\`).\n` +
    `import '@rudderjs/orm'\n\n` +
    `declare module '@rudderjs/orm' {\n` +
    `  interface SchemaRegistry {\n` +
    `${entries}\n` +
    `  }\n` +
    `}\n`
  )
}

/** Quote an object key only when it isn't a plain JS identifier (keeps the
 *  common case clean, stays correct for snake_case-with-dashes or odd names). */
function quoteKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}
