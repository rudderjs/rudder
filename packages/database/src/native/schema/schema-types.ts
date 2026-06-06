// ─── schema:types orchestration (GATE 7-types, node-only) ──
//
// Node-only glue: introspect every user table on a connection, fold in each
// model's declared `casts` (so a `boolean` cast surfaces as `boolean`, not the
// raw stored `number`), and write `.rudder/types/models.d.ts`. The pure
// column→TS mapping lives in `types-generator.ts`; the live catalog reads in
// `introspect.ts`. Run automatically after `migrate` / `migrate:fresh`, and on
// demand via `rudder schema:types`.

import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Executor } from '../driver.js'
import type { Dialect } from '../dialect.js'
import { readTables, readColumns } from './introspect.js'
import { buildTableTypes, emitRegistryDts, sqliteTypeToTs, pgTypeToTs, mysqlTypeToTs, type TableTypes } from './types-generator.js'

/** A model's contribution to type resolution: its table name + declared casts. */
export interface ModelCastInfo {
  table: string
  casts: Record<string, string>
}

/**
 * Introspect every user table and build the {@link TableTypes} for each, folding
 * in `casts` for any table a model declares them on (matched by table name).
 * Pure-ish: only reads the DB, returns data — the file write is separate so this
 * is unit-testable against an in-memory connection.
 */
export async function collectSchemaTypes(
  executor: Executor,
  dialect: Dialect,
  models: ModelCastInfo[] = [],
): Promise<TableTypes[]> {
  const castsByTable = new Map(models.map((m) => [m.table, m.casts]))
  // Per-dialect storage→TS mapper: Postgres / MySQL data types differ from
  // SQLite's fuzzy affinities (e.g. `jsonb`, `timestamptz`, `numeric`/`decimal`
  // as string, `tinyint`→number).
  const typeToTs =
    dialect.name === 'pg'    ? pgTypeToTs :
    dialect.name === 'mysql' ? mysqlTypeToTs :
    sqliteTypeToTs
  const tables = await readTables(executor, dialect)
  const out: TableTypes[] = []
  for (const table of tables) {
    const columns = await readColumns(executor, dialect, table)
    out.push(buildTableTypes(table, columns, castsByTable.get(table) ?? {}, typeToTs))
  }
  return out
}

/**
 * Default output path for the generated registry, relative to an app root.
 *
 * `.rudder/types/` is the committed generated-files home shared with
 * `@rudderjs/vite`'s view/route registries. The path is duplicated there
 * (`packages/vite/src/rudder-dir.ts`) because the two packages share no
 * workspace dependency — keep them in sync.
 */
export function registryDtsPath(cwd: string): string {
  return join(cwd, '.rudder', 'types', 'models.d.ts')
}

/** Pre-`.rudder/` output location — removed on write so migrated apps don't
 *  keep a stale duplicate augmentation. */
function legacyRegistryDtsPath(cwd: string): string {
  return join(cwd, 'app', 'Models', '__schema', 'registry.d.ts')
}

/**
 * Full `schema:types` run: introspect → emit → write
 * `.rudder/types/models.d.ts`. Returns the written path + table count
 * for the CLI to report. Creating the dir is idempotent.
 */
export async function generateSchemaTypes(
  executor: Executor,
  dialect: Dialect,
  cwd: string,
  models: ModelCastInfo[] = [],
): Promise<{ path: string; tableCount: number }> {
  const tables = await collectSchemaTypes(executor, dialect, models)
  const contents = emitRegistryDts(tables)
  const path = registryDtsPath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
  // Migrate apps off the legacy location (best effort — a stale duplicate
  // merges harmlessly until the next write). The rmdir clears the now-empty
  // `__schema/` dir; it fails harmlessly when other files live there.
  const legacy = legacyRegistryDtsPath(cwd)
  try {
    await rm(legacy, { force: true })
    await rmdir(dirname(legacy))
  } catch { /* dir not empty or never existed */ }
  return { path, tableCount: tables.length }
}
