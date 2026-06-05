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
import type { QueryBuilder, OrmAdapter } from '@rudderjs/contracts'
import { Migration } from './migration.js'
import { withSchema } from './schema-facade.js'
import type { SchemaBuilder } from './schema-builder.js'
import { NativeOrmError } from '../errors.js'

/** The minimal connection surface the migrator needs. `NativeAdapter` satisfies it. */
export interface MigratorAdapter {
  schemaBuilder(): SchemaBuilder
  query<T>(table: string): QueryBuilder<T>
  /**
   * Run `fn` inside a transaction, passing it a transaction-scoped adapter whose
   * `schemaBuilder()` / `query()` execute on the transaction. The migrator wraps
   * each batch's up()s / down()s in this so a mid-batch failure rolls back the
   * WHOLE batch — DDL and the `migrations` state-table writes commit atomically.
   *
   * The callback param mirrors the `OrmAdapter` contract (the scoped adapter the
   * concrete `transaction()` hands back) so `NativeAdapter` stays structurally
   * assignable to `MigratorAdapter`. The migrator narrows it to a {@link
   * ScopedMigratorAdapter} internally — the scoped adapter is in fact a full
   * native adapter that also exposes `schemaBuilder()`.
   */
  transaction<T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T>
  /**
   * A recording {@link SchemaBuilder} for `migrate --pretend`: statements are
   * captured (via `record`) instead of executed. Optional — an adapter without it
   * makes `--pretend` throw a clear error rather than silently executing.
   */
  pretendSchemaBuilder?(record: (sql: string, bindings: readonly unknown[]) => void): SchemaBuilder
}

/** The transaction-scoped adapter the migrator drives inside a batch — an
 *  `OrmAdapter` that also carries the migrator's `schemaBuilder()`/`query()`. */
type ScopedMigratorAdapter = OrmAdapter & MigratorAdapter

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

/** The SQL a single migration's `up()` would emit, captured under `--pretend`. */
export interface PretendedMigration {
  name:       string
  statements: string[]
}

/** Outcome of a `run()`. */
export interface RunResult {
  batch:   number
  applied: string[]
  /** Present only under `{ pretend: true }` — the captured (un-executed) SQL per
   *  pending migration. `applied` is empty in that case (nothing ran). */
  pretended?: PretendedMigration[]
}

/** Knobs for {@link Migrator.run} (Laravel `migrate` flag parity). */
export interface RunOptions {
  /** `--step`: record each pending migration in its OWN batch (so they roll back
   *  one at a time) instead of grouping the whole run into a single batch. */
  step?:    boolean
  /** `--pretend`: capture the SQL each pending migration would emit without
   *  executing anything or writing the `migrations` state table. */
  pretend?: boolean
}

/** Outcome of a `rollback()`. */
export interface RollbackResult {
  /** The batch number that was rolled back (`0` if nothing to roll back). For a
   *  `--step`/`--batch` rollback this is the highest batch touched. */
  batch:    number
  reverted: string[]
}

/** Knobs for {@link Migrator.rollback} (Laravel `migrate:rollback` flag parity). */
export interface RollbackOptions {
  /** `--step=N`: roll back the last N applied migrations (across batches), each
   *  reverted in reverse apply order. */
  step?:  number
  /** `--batch=N`: roll back every migration recorded in batch N. */
  batch?: number
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
  async run(
    migrations: LoadedMigration[],
    onApply?: (name: string) => void,
    opts: RunOptions = {},
  ): Promise<RunResult> {
    // --pretend: capture each pending migration's SQL without touching the DB or
    // the state table. Doesn't need (or create) the migrations table.
    if (opts.pretend) return this.pretend(migrations)

    await this.ensureTable()
    const done = new Set(await this.ran())
    const pending = migrations.filter(m => !done.has(m.name))
    const startBatch = await this.nextBatch()
    if (pending.length === 0) return { batch: startBatch, applied: [] }

    // One transaction for the whole run: if any up() throws, every DDL change and
    // `migrations` row recorded so far rolls back atomically. Use the TX-scoped
    // adapter for both the schema builder and the state-table writes. Under
    // --step each migration takes its own incrementing batch number (so it can be
    // rolled back individually); otherwise they share `startBatch`.
    await this.adapter.transaction(async (txAdapter) => {
      const tx = txAdapter as ScopedMigratorAdapter
      const schema = tx.schemaBuilder()
      let offset = 0
      for (const { name, migration } of pending) {
        const batch = opts.step ? startBatch + offset : startBatch
        await withSchema(schema, () => migration.up())
        await tx.query<MigrationRow>(TABLE).create({ migration: name, batch })
        onApply?.(name)
        offset++
      }
    })

    return { batch: startBatch, applied: pending.map(m => m.name) }
  }

  /** Dry-run: bind each pending migration's `up()` to a recording schema builder
   *  and collect the DDL it would emit. No transaction, no state-table writes. */
  private async pretend(migrations: LoadedMigration[]): Promise<RunResult> {
    if (!this.adapter.pretendSchemaBuilder) {
      throw new NativeOrmError(
        'NATIVE_PRETEND_UNSUPPORTED',
        `[RudderJS ORM native] --pretend is not supported by this adapter (no pretendSchemaBuilder()).`,
      )
    }
    const done = new Set(await this.ran())
    const pending = migrations.filter(m => !done.has(m.name))
    const pretended: PretendedMigration[] = []
    for (const { name, migration } of pending) {
      const statements: string[] = []
      const schema = this.adapter.pretendSchemaBuilder((sql) => statements.push(sql))
      await withSchema(schema, () => migration.up(), { pretend: true })
      pretended.push({ name, statements })
    }
    return { batch: await this.nextBatch(), applied: [], pretended }
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

  /** The highest recorded batch number, or `0` when nothing has been applied. */
  async lastBatch(): Promise<number> {
    if (!(await this.installed())) return 0
    const rows = await this.adapter.query<MigrationRow>(TABLE).get()
    return rows.reduce((max, r) => Math.max(max, r.batch), 0)
  }

  /** Rows recorded in `batch`, newest-applied first (id DESC) — i.e. the order
   *  their `down()` methods should run to unwind the batch. */
  migrationsInBatch(batch: number): Promise<MigrationRow[]> {
    return this.adapter.query<MigrationRow>(TABLE).where('batch', batch).orderBy('id', 'DESC').get()
  }

  /**
   * Revert the LAST batch: run each of its migrations' `down()` in reverse apply
   * order (id DESC) and delete their `migrations` rows. The whole batch runs in
   * one transaction, so a `down()` that throws leaves the state table untouched.
   * Returns the rolled-back batch number and the reverted names. A no-op (batch
   * `0`) when nothing has been applied.
   */
  async rollback(
    migrations: LoadedMigration[],
    onRevert?: (name: string) => void,
    opts: RollbackOptions = {},
  ): Promise<RollbackResult> {
    // --batch=N: revert every migration recorded in that batch.
    if (opts.batch !== undefined) {
      const rows = await this.migrationsInBatch(opts.batch)
      const reverted = await this.revertRows(rows, migrations, onRevert)
      return { batch: opts.batch, reverted }
    }
    // --step=N: revert the last N applied migrations, across batches, newest first.
    if (opts.step !== undefined && opts.step > 0) {
      if (!(await this.installed())) return { batch: 0, reverted: [] }
      const all = await this.adapter.query<MigrationRow>(TABLE).orderBy('id', 'DESC').get()
      const rows = all.slice(0, opts.step)
      const batch = rows.reduce((max, r) => Math.max(max, r.batch), 0)
      const reverted = await this.revertRows(rows, migrations, onRevert)
      return { batch, reverted }
    }
    // Default: revert the last batch.
    const batch = await this.lastBatch()
    if (batch === 0) return { batch: 0, reverted: [] }
    const rows = await this.migrationsInBatch(batch)
    const reverted = await this.revertRows(rows, migrations, onRevert)
    return { batch, reverted }
  }

  /**
   * Revert EVERY applied migration (all batches), `down()` in full reverse order
   * (id DESC across batches), in a single transaction. Used by `migrate:refresh`.
   * Returns the reverted names.
   */
  async rollbackAll(migrations: LoadedMigration[]): Promise<string[]> {
    if (!(await this.installed())) return []
    const rows = await this.adapter.query<MigrationRow>(TABLE).orderBy('id', 'DESC').get()
    return this.revertRows(rows, migrations)
  }

  /** Shared unwind path for `rollback` / `rollbackAll`: run `down()` for each row
   *  (already in reverse order) inside one transaction and delete its state row. */
  private async revertRows(
    rows: MigrationRow[],
    migrations: LoadedMigration[],
    onRevert?: (name: string) => void,
  ): Promise<string[]> {
    if (rows.length === 0) return []
    const byName = new Map(migrations.map(m => [m.name, m.migration]))
    const reverted: string[] = []
    await this.adapter.transaction(async (txAdapter) => {
      const tx = txAdapter as ScopedMigratorAdapter
      const schema = tx.schemaBuilder()
      for (const row of rows) {
        const migration = byName.get(row.migration)
        if (!migration) {
          throw new NativeOrmError(
            'NATIVE_BAD_MIGRATION',
            `[RudderJS ORM native] Cannot roll back "${row.migration}": its migration file ` +
            `was not found in database/migrations. Restore the file or remove its row from the migrations table.`,
          )
        }
        await withSchema(schema, () => migration.down())
        await tx.query<MigrationRow>(TABLE).delete(row.id)
        reverted.push(row.migration)
        onRevert?.(row.migration)
      }
    })
    return reverted
  }

  /**
   * Drop every user table (used by `migrate:fresh`) — including the
   * `migrations` state table, so the next `run()` rebuilds from a clean slate.
   * Delegates to the dialect-aware {@link SchemaBuilder.dropAllTables}
   * (`information_schema` + FK-safe drops on pg/mysql, `sqlite_master` on
   * sqlite). Historically this read the SQLite catalog directly, which made
   * `migrate:fresh` throw on pg/mysql native connections.
   */
  async dropAllTables(): Promise<void> {
    await this.schema.dropAllTables()
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
    // Runtime path by design (user migration files on disk) — Vite can't analyze it; suppress the dev warning.
    const mod = await import(/* @vite-ignore */ pathToFileURL(join(dir, file)).href) as { default?: unknown }
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
