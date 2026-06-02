// ─── Queue schema (jobs + failed_jobs) ─────────────────────
//
// The native `database` queue driver persists jobs in two tables, modeled on
// Laravel's `database` driver. Time columns are stored as **integer unix
// seconds** (not timestamps) — Laravel does the same: integer comparison is
// dialect-portable and sidesteps SQLite's lack of a real date type.
//
// `jobsTableStub` / `failedJobsTableStub` return the *text* of a migration file
// for `rudder queue:table` to write into the app's `database/migrations/`.
// `defineJobsTable` / `defineFailedJobsTable` are the programmatic Blueprint
// builders the stubs mirror — reused by tests so the two never drift.

/** Minimal shape of the native `Blueprint` (`@rudderjs/orm/native`) we touch. */
export interface QueueBlueprint {
  id(name?: string): { primary(): unknown }
  string(name: string, length?: number): { unique(): unknown; index(): unknown }
  text(name: string): unknown
  integer(name: string): { nullable(): unknown; default(value: unknown): unknown; index(): unknown }
  index(columns: string | string[], name?: string): void
}

/** Build the `jobs` table (Laravel-parity columns; integer unix-second times). */
export function defineJobsTable(t: QueueBlueprint): void {
  t.id()
  t.string('queue').index()
  t.text('payload')
  t.integer('attempts').default(0)
  t.integer('reserved_at').nullable()
  t.integer('available_at')
  t.integer('created_at')
  // Composite index for the reservation poll (queue + availability + reserved).
  t.index(['queue', 'available_at'])
}

/** Build the `failed_jobs` table. */
export function defineFailedJobsTable(t: QueueBlueprint): void {
  t.id()
  t.string('uuid').unique()
  t.text('connection')
  t.text('queue')
  t.text('payload')
  t.text('exception')
  t.integer('failed_at')
}

/** Migration-file text for the `jobs` table. `table` lets a non-default table
 *  name flow through (defaults to `jobs`). */
export function jobsTableStub(table = 'jobs'): string {
  return `import { Migration, Schema } from '@rudderjs/orm/native'

export default class extends Migration {
  async up() {
    await Schema.create('${table}', (t) => {
      t.id()
      t.string('queue').index()
      t.text('payload')
      t.integer('attempts').default(0)
      t.integer('reserved_at').nullable()
      t.integer('available_at')
      t.integer('created_at')
      t.index(['queue', 'available_at'])
    })
  }

  async down() {
    await Schema.dropIfExists('${table}')
  }
}
`
}

/** Migration-file text for the `failed_jobs` table. */
export function failedJobsTableStub(table = 'failed_jobs'): string {
  return `import { Migration, Schema } from '@rudderjs/orm/native'

export default class extends Migration {
  async up() {
    await Schema.create('${table}', (t) => {
      t.id()
      t.string('uuid').unique()
      t.text('connection')
      t.text('queue')
      t.text('payload')
      t.text('exception')
      t.integer('failed_at')
    })
  }

  async down() {
    await Schema.dropIfExists('${table}')
  }
}
`
}
