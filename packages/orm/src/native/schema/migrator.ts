// ─── Migrator (runner + state) ─────────────────────────────
//
// Node-capable: drives migration files against a connection and tracks applied
// migrations in a `migrations` table (Laravel's model: `id`, `migration`,
// `batch`). Phase 7.2 ships forward `migrate` + `status`; `rollback`/`refresh`
// (which reverse a batch via `down()`) and transactional batches land in 7.5 —
// the `batch` column is recorded now so rollback has the grouping it needs.
//
// The runner is decoupled from the concrete adapter: it needs only a
// `schemaBuilder()` (DDL) and `query()` (state-table CRUD), both of which
// `NativeAdapter` provides. That keeps it unit-testable against an in-memory
// SQLite adapter, and reusable by RN/WASM drivers later.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { QueryBuilder } from '@rudderjs/contracts'
import { Migration } from './migration.js'
import { withSchema } from './schema-facade.js'
import type { SchemaBuilder } from './schema-builder.js'
import { NativeOrmError } from '../errors.js'

/** The minimal connection surface the migrator needs. `NativeAdapter` satisfies it. */
export interface MigratorAdapter {
  schemaBuilder(): SchemaBuilder
  query<T>(table: string): QueryBuilder<T>
}

/** A migration file resolved to its name (filename sans extension) + instance. */
export interface LoadedMigration {
  name:      string
  migration: Migration
}

/** One row of `migrate:status` output. */
export interface MigrationStatus {
  name:  string
  ran:   boolean
  batch: number | null
}

/** Outcome of a `run()`. */
export interface RunResult {
  batch:   number
  applied: string[]
}

interface MigrationRow {
  id:        number
  migration: string
  batch:     number
}

const TABLE = 'migrations'

export class Migrator {
  private readonly schema: SchemaBuilder

  constructor(private readonly adapter: MigratorAdapter) {
    this.schema = adapter.schemaBuilder()
  }

  /** Whether the `migrations` state table exists yet. */
  installed(): Promise<boolean> {
    return this.schema.hasTable(TABLE)
  }

  /** Create the `migrations` state table if it's missing. Idempotent. */
  async ensureTable(): Promise<void> {
    if (await this.installed()) return
    await this.schema.create(TABLE, (t) => {
      t.id()
      t.string('migration').unique()
      t.integer('batch')
    })
  }

  /** Names of applied migrations, in apply order. */
  async ran(): Promise<string[]> {
    if (!(await this.installed())) return []
    const rows = await this.adapter.query<MigrationRow>(TABLE).orderBy('id', 'ASC').get()
    return rows.map(r => r.migration)
  }

  /** The batch number a fresh `run()` would use (`max(batch) + 1`, or 1). */
  async nextBatch(): Promise<number> {
    if (!(await this.installed())) return 1
    const rows = await this.adapter.query<MigrationRow>(TABLE).get()
    return rows.reduce((max, r) => Math.max(max, r.batch), 0) + 1
  }

  /**
   * Apply every not-yet-run migration (in `name` order) inside a single new
   * batch. `onApply` streams progress to the caller (the CLI prints it). Returns
   * the batch number and the applied names.
   */
  async run(migrations: LoadedMigration[], onApply?: (name: string) => void): Promise<RunResult> {
    await this.ensureTable()
    const done = new Set(await this.ran())
    const pending = migrations.filter(m => !done.has(m.name))
    const batch = await this.nextBatch()

    for (const { name, migration } of pending) {
      await withSchema(this.schema, () => migration.up())
      await this.adapter.query<MigrationRow>(TABLE).create({ migration: name, batch })
      onApply?.(name)
    }

    return { batch, applied: pending.map(m => m.name) }
  }

  /** ran/pending state for every known migration, plus its batch when applied. */
  async status(migrations: LoadedMigration[]): Promise<MigrationStatus[]> {
    const rows = (await this.installed())
      ? await this.adapter.query<MigrationRow>(TABLE).get()
      : []
    const byName = new Map(rows.map(r => [r.migration, r.batch]))
    return migrations.map(m => ({
      name:  m.name,
      ran:   byName.has(m.name),
      batch: byName.get(m.name) ?? null,
    }))
  }
}

/**
 * Load migration files from a directory: each `*.{ts,js,mts,mjs}` whose default
 * export is a {@link Migration} subclass, instantiated and sorted by filename
 * (timestamp-prefixed names sort chronologically). A file without a valid
 * default export throws — a silently-skipped migration is worse than a loud one.
 */
export async function discoverMigrations(dir: string): Promise<LoadedMigration[]> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return [] // no migrations directory yet
  }

  const files = entries
    .filter(f => /\.(ts|js|mts|mjs)$/.test(f) && !/\.d\.ts$/.test(f))
    .sort()

  const loaded: LoadedMigration[] = []
  for (const file of files) {
    const name = file.replace(/\.(ts|js|mts|mjs)$/, '')
    const mod = await import(pathToFileURL(join(dir, file)).href) as { default?: unknown }
    const Cls = mod.default
    if (typeof Cls !== 'function' || !(Cls.prototype instanceof Migration)) {
      throw new NativeOrmError(
        'NATIVE_BAD_MIGRATION',
        `[RudderJS ORM native] ${file} must default-export a class extending Migration.`,
      )
    }
    loaded.push({ name, migration: new (Cls as new () => Migration)() })
  }
  return loaded
}
