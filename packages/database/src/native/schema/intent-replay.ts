// ─── Blueprint-intent replay (schema:types fallback layer) ──
//
// On SQLite a `t.boolean()` / `t.json()` column introspects as its storage
// affinity (INTEGER / TEXT), so the typed registry only got the right TS type
// when the model declared a matching cast. The migration files already carry
// the INTENT — this module recovers it at generation time by REPLAYING the
// applied migrations' `up()` bodies against a recording schema builder that
// applies each blueprint to an in-memory ledger instead of executing DDL.
//
// Why replay (vs persisting intent at migrate time, or a sidecar file per
// migration): the migration files are already the committed source of truth,
// so replay needs no state-table schema change, no extra artifacts to commit,
// and — decisively — works retroactively for every existing app whose
// migrations ran before this feature shipped. See the plan doc
// `docs/plans/2026-06-05-schema-types-cast-folding-needs-import-time-registration.md`.
//
// Replay is bounded to APPLIED migrations (the `migrations` state table, in
// apply order) so a pending migration's intent — e.g. a future `.change()` —
// can never claim a type ahead of the live schema. It is also PURE:
// `hasTable` / `hasColumn` answer from the ledger (mirroring the historical
// schema state at that point in the sequence), and the guard in
// `../intent-guard.ts` makes any runtime statement inside an `up()` (a
// `DB.statement` backfill, a Model write) throw instead of re-executing —
// the replayer catches per-migration and skips the rest of that migration's
// intent. Intent is a fallback REFINEMENT only (cast > intent > introspected
// storage type): a column missing from the ledger just keeps its storage type.

import type { ColumnType } from './column.js'
import type { LoadedMigration } from './migrator.js'
import { Blueprint } from './blueprint.js'
import { AlterBlueprint } from './alter-blueprint.js'
import { SchemaBuilder } from './schema-builder.js'
import { withSchema } from './schema-facade.js'
import { SqliteDialect } from '../dialect.js'
import type { Executor } from '../driver.js'
import { withIntentReplayGuard, refuseIntentReplayStatement } from '../intent-guard.js'

/** Declared column types per table, recovered from blueprint replay:
 *  table → column → the blueprint's {@link ColumnType}. */
export type TableIntent = Map<string, Map<string, ColumnType>>

/** Outcome of {@link collectBlueprintIntent}. */
export interface BlueprintIntentResult {
  intent:  TableIntent
  /** Migrations whose `up()` threw during replay (runtime statements, schema
   *  reads the ledger couldn't satisfy, …). Their intent recorded before the
   *  throw is kept — an applied migration's earlier ops did run historically —
   *  but the remainder is skipped. */
  skipped: string[]
}

/** The in-memory schema the replay maintains. Apply order mirrors the real
 *  migrator's, so the ledger at step N is the declared schema as of step N. */
class IntentLedger {
  readonly tables: TableIntent = new Map()

  private table(name: string): Map<string, ColumnType> {
    let cols = this.tables.get(name)
    if (!cols) {
      cols = new Map()
      this.tables.set(name, cols)
    }
    return cols
  }

  /** CREATE TABLE — replaces any prior entry (drop + recreate). */
  create(name: string, columns: Iterable<{ name: string; type: ColumnType }>): void {
    const cols = new Map<string, ColumnType>()
    for (const c of columns) cols.set(c.name, c.type)
    this.tables.set(name, cols)
  }

  /** ADD COLUMN / `.change()` — both upsert the declared type. */
  setColumn(table: string, column: string, type: ColumnType): void {
    this.table(table).set(column, type)
  }

  dropColumn(table: string, column: string): void {
    this.tables.get(table)?.delete(column)
  }

  renameColumn(table: string, from: string, to: string): void {
    const cols = this.tables.get(table)
    if (!cols) return
    const type = cols.get(from)
    if (type === undefined) return
    cols.delete(from)
    cols.set(to, type)
  }

  renameTable(from: string, to: string): void {
    const cols = this.tables.get(from)
    if (!cols) return
    this.tables.delete(from)
    this.tables.set(to, cols)
  }

  dropTable(name: string): void {
    this.tables.delete(name)
  }
}

/** A throwing executor: nothing in the replay path may reach one — a call
 *  means an un-overridden {@link SchemaBuilder} method slipped through. */
const inertExecutor: Executor = {
  execute(): never {
    return refuseIntentReplayStatement()
  },
}

/**
 * A {@link SchemaBuilder} that applies blueprints to an {@link IntentLedger}
 * instead of compiling/executing DDL. Subclasses the real builder (the
 * `Schema` facade types against the class, whose private fields make it
 * nominal) over an inert executor + a dummy dialect — every public method is
 * overridden, so neither is ever consulted.
 */
class IntentSchemaBuilder extends SchemaBuilder {
  constructor(private readonly ledger: IntentLedger) {
    super(inertExecutor, new SqliteDialect())
  }

  override async create(table: string, build: (t: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table)
    build(blueprint)
    this.ledger.create(table, blueprint.columns)
  }

  override async table(table: string, build: (t: AlterBlueprint) => void): Promise<void> {
    const blueprint = new AlterBlueprint(table)
    build(blueprint)
    // Order mirrors the real ALTER: adds/changes, renames, then drops.
    for (const col of blueprint.columns) this.ledger.setColumn(table, col.name, col.type)
    for (const { from, to } of blueprint.renamedColumns) this.ledger.renameColumn(table, from, to)
    for (const name of blueprint.droppedColumns) this.ledger.dropColumn(table, name)
  }

  override async rename(from: string, to: string): Promise<void> {
    this.ledger.renameTable(from, to)
  }

  override async drop(table: string): Promise<void> {
    this.ledger.dropTable(table)
  }

  override async dropIfExists(table: string): Promise<void> {
    this.ledger.dropTable(table)
  }

  override async allTables(): Promise<string[]> {
    return [...this.ledger.tables.keys()]
  }

  override async dropAllTables(): Promise<void> {
    this.ledger.tables.clear()
  }

  /** Answer from the ledger — the declared schema as of this replay step. A
   *  table created outside blueprints (raw DDL) reads as absent; an `up()`
   *  branching on that may diverge from its historical run, which at worst
   *  loses intent for the affected columns (they keep their storage types). */
  override async hasTable(table: string): Promise<boolean> {
    return this.ledger.tables.has(table)
  }

  override async hasColumn(table: string, column: string): Promise<boolean> {
    return this.ledger.tables.get(table)?.has(column) ?? false
  }
}

/**
 * Replay the APPLIED migrations (filtered + ordered by `applied`, the
 * `migrations` state table's apply order) and return the declared column
 * types per table. Applied migrations whose files are gone are skipped
 * silently (same tolerance as `migrate:status`); an `up()` that throws —
 * the guard refusing a runtime statement, usually — lands in `skipped` and
 * contributes only the intent it recorded before the throw.
 *
 * Binds with `pretend: true` so `Schema.connection()` refuses during replay
 * (DDL on a second connection would execute for real).
 */
export async function collectBlueprintIntent(
  migrations: LoadedMigration[],
  applied: string[],
): Promise<BlueprintIntentResult> {
  const ledger = new IntentLedger()
  const builder = new IntentSchemaBuilder(ledger)
  const byName = new Map(migrations.map((m) => [m.name, m.migration]))
  const skipped: string[] = []

  await withIntentReplayGuard(async () => {
    for (const name of applied) {
      const migration = byName.get(name)
      if (!migration) continue
      try {
        await withSchema(builder, () => migration.up(), { pretend: true })
      } catch {
        skipped.push(name)
      }
    }
  })

  return { intent: ledger.tables, skipped }
}
