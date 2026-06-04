/**
 * Phase 4 — MySQL capability branching for `increment` / `decrement` /
 * `deleteAll` / `updateAll`.
 *
 * Two coverage layers:
 *
 * 1. **Unit tests** (always run) — synthesize a fake Drizzle db that mirrors
 *    what `mysql2`'s adapter returns: bare `await` on UPDATE/DELETE yields
 *    `ResultSetHeader { affectedRows }` and `.returning()` is absent.
 *    The unit tests confirm we never call `.returning()` on MySQL and that
 *    `affectedRows` flows through. Critically, this catches regressions in
 *    CI without requiring a live MySQL instance.
 *
 * 2. **Integration tests** (env-gated on `MYSQL_TEST_URL`) — exercise the
 *    full path against a real MySQL/MariaDB server. Skipped by default so
 *    the unit cell stays green on every machine; opt in locally with
 *    `MYSQL_TEST_URL=mysql://root:secret@localhost:3306/test pnpm test`.
 *    CI portability matrix Phase 3 will land this in a dedicated job.
 */
import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { mysqlTable, int } from 'drizzle-orm/mysql-core'
import { sqliteTable, integer } from 'drizzle-orm/sqlite-core'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// ─── Layer 1 — unit (no MySQL required) ────────────────────

/**
 * Fake DrizzleDb wired to the same fluent surface the real driver exposes,
 * but with bare `await` returning a MySQL2-style `ResultSetHeader`. Records
 * whether `.returning()` was reached so the test can assert "never called
 * on MySQL".
 */
type FakeRecorder = {
  returningCalled: boolean
  lastOp:          'insert' | 'update' | 'delete' | 'select' | null
  /** Rows surfaced by select() — drives the increment re-fetch path. */
  selectRows:      unknown[]
}

function makeFakeMysqlDb(rec: FakeRecorder, affected: number): unknown {
  const updateChain = {
    set:       () => updateChain,
    where:     () => updateChain,
    // No .returning() at all — mirrors mysql2's MySqlUpdateBuilder.
    then(onfulfilled: (v: unknown) => unknown): unknown {
      rec.lastOp = 'update'
      return Promise.resolve({ affectedRows: affected }).then(onfulfilled)
    },
  } as unknown
  const deleteChain = {
    where: () => deleteChain,
    then(onfulfilled: (v: unknown) => unknown): unknown {
      rec.lastOp = 'delete'
      return Promise.resolve({ affectedRows: affected }).then(onfulfilled)
    },
  } as unknown
  const selectChain = {
    from:  () => selectChain,
    where: () => selectChain,
    limit: () => selectChain,
    then(onfulfilled: (v: unknown) => unknown): unknown {
      rec.lastOp = 'select'
      return Promise.resolve(rec.selectRows).then(onfulfilled)
    },
  } as unknown

  return {
    update: () => updateChain,
    delete: () => deleteChain,
    select: () => selectChain,
    insert: () => ({ values: () => Promise.resolve({ affectedRows: 1 }) }),
  }
}

// Use a sqlite-shaped table object since the adapter only treats it as an
// opaque reference for column lookup. The fake db never executes real SQL.
const fakeTable = sqliteTable('rows', {
  id:    integer('id').primaryKey(),
  views: integer('views').notNull().default(0),
})
type Row = { id: number; views: number }

describe('DrizzleAdapter — MySQL capability branching (unit)', () => {
  it('deleteAll() reads affectedRows on mysql and never calls .returning()', async () => {
    const rec: FakeRecorder = { returningCalled: false, lastOp: null, selectRows: [] }
    const db = makeFakeMysqlDb(rec, 42)
    const adapter = await drizzle({ client: db, tables: { rows: fakeTable }, dialect: 'mysql' })
      .create() as DrizzleAdapter

    const n = await adapter.query<Row>('rows').deleteAll()
    assert.equal(n, 42)
    assert.equal(rec.returningCalled, false)
  })

  it('updateAll() reads affectedRows on mysql', async () => {
    const rec: FakeRecorder = { returningCalled: false, lastOp: null, selectRows: [] }
    const db = makeFakeMysqlDb(rec, 7)
    const adapter = await drizzle({ client: db, tables: { rows: fakeTable }, dialect: 'mysql' })
      .create() as DrizzleAdapter

    const n = await adapter.query<Row>('rows').updateAll({ views: 0 })
    assert.equal(n, 7)
    assert.equal(rec.returningCalled, false)
  })

  it('affectedRowCount also accepts `rowsAffected` shape (planetscale-serverless)', async () => {
    // No wheres → updateAll skips `.where()`, so the chain's terminal point
    // is the `.set()` return. Mirror the planetscale-serverless shape:
    // every level is a thenable resolving to `{ rowsAffected }`.
    const planetscaleResult = { rowsAffected: 13 }
    const thenable = {
      set:   () => thenable,
      where: () => thenable,
      then(onfulfilled: (v: unknown) => unknown): unknown {
        return Promise.resolve(planetscaleResult).then(onfulfilled)
      },
    }
    const db = { update: () => thenable, delete: () => thenable }
    const adapter = await drizzle({ client: db, tables: { rows: fakeTable }, dialect: 'mysql' })
      .create() as DrizzleAdapter

    const n = await adapter.query<Row>('rows').updateAll({ views: 0 })
    assert.equal(n, 13)
  })

  it('increment() re-fetches the row on mysql instead of using RETURNING', async () => {
    const rec: FakeRecorder = { returningCalled: false, lastOp: null, selectRows: [{ id: 1, views: 5 }] }
    const db = makeFakeMysqlDb(rec, 1)
    const adapter = await drizzle({ client: db, tables: { rows: fakeTable }, dialect: 'mysql' })
      .create() as DrizzleAdapter

    const row = await adapter.query<Row>('rows').increment(1, 'views', 5)
    assert.equal(row.views, 5)
    // The increment path issues an UPDATE then a SELECT — the recorder's
    // `lastOp` lands on 'select' because that's the terminal call.
    assert.equal(rec.lastOp, 'select')
    assert.equal(rec.returningCalled, false)
  })

  it('increment() throws when re-fetch returns no row', async () => {
    const rec: FakeRecorder = { returningCalled: false, lastOp: null, selectRows: [] }
    const db = makeFakeMysqlDb(rec, 0)
    const adapter = await drizzle({ client: db, tables: { rows: fakeTable }, dialect: 'mysql' })
      .create() as DrizzleAdapter

    await assert.rejects(
      () => adapter.query<Row>('rows').increment(99, 'views', 5),
      /increment\(\) target row not found/,
    )
  })

  it('decrement() uses the same re-fetch path on mysql', async () => {
    const rec: FakeRecorder = { returningCalled: false, lastOp: null, selectRows: [{ id: 1, views: 8 }] }
    const db = makeFakeMysqlDb(rec, 1)
    const adapter = await drizzle({ client: db, tables: { rows: fakeTable }, dialect: 'mysql' })
      .create() as DrizzleAdapter

    const row = await adapter.query<Row>('rows').decrement(1, 'views', 2)
    assert.equal(row.views, 8)
    assert.equal(rec.lastOp, 'select')
  })

  it('default dialect (pg) still uses .returning() — no regression for Postgres users', async () => {
    // Sanity: when dialect is omitted on a client-config setup, default to
    // 'pg' (matches the legacy code path). The Postgres path calls
    // .returning() so we observe a different chain.
    let returningCalled = false
    const pgUpdateChain = {
      set:        () => pgUpdateChain,
      where:      () => pgUpdateChain,
      returning() { returningCalled = true; return Promise.resolve([{ id: 1, views: 5 }]) },
    } as unknown
    const pgDb = { update: () => pgUpdateChain, delete: () => pgUpdateChain }
    const adapter = await drizzle({ client: pgDb, tables: { rows: fakeTable } /* no dialect */ })
      .create() as DrizzleAdapter

    const row = await adapter.query<Row>('rows').increment(1, 'views', 5)
    assert.equal(row.views, 5)
    assert.equal(returningCalled, true)
  })

  it('sqlite dialect goes through the RETURNING path', async () => {
    // Real sqlite happy-path — proves the existing sqlite tests continue to
    // pass under the new dialect plumbing. Mirrors the integration.test.ts
    // setup at minimal scope.
    const sqlite = new Database(':memory:')
    sqlite.exec('CREATE TABLE rows (id INTEGER PRIMARY KEY AUTOINCREMENT, views INTEGER NOT NULL DEFAULT 0);')
    const db  = drizzleSqlite(sqlite)
    const cfg: DrizzleConfig = { client: db, tables: { rows: fakeTable }, dialect: 'sqlite' }
    const adapter = await drizzle(cfg).create() as DrizzleAdapter

    await adapter.query<Row>('rows').create({ views: 0 })
    const row = await adapter.query<Row>('rows').first() as Row
    const after = await adapter.query<Row>('rows').increment(row.id, 'views', 3)
    assert.equal(after.views, 3)
  })
})

// ─── Layer 2 — integration (env-gated) ─────────────────────

const MYSQL_URL  = process.env['MYSQL_TEST_URL']
const skipReason = MYSQL_URL
  ? false
  : 'MYSQL_TEST_URL not set — opt in with e.g. MYSQL_TEST_URL=mysql://root:secret@localhost:3306/test'

// Real MySQL schema — kept tiny on purpose. The test creates + drops it.
const mRows = mysqlTable('rl_phase4', {
  id:    int('id').primaryKey().autoincrement(),
  views: int('views').notNull().default(0),
})
type MRow = { id: number; views: number }

describe('DrizzleAdapter — MySQL integration', { skip: skipReason }, () => {
  let adapter: DrizzleAdapter

  // Close the pooled mysql2 client when the block finishes — without this the
  // open pool keeps the file's event loop alive and the WHOLE `node --test`
  // fleet hangs waiting for this file to exit (every beforeEach `make()` with
  // the same signature reuses the one cached client, so a single disconnect
  // closes it). Every other live block (json-where, read-write-split,
  // mysql-writes) already does this in its own teardown.
  after(async () => {
    const raw = (adapter?.db as unknown as { execute: (s: unknown) => Promise<unknown> } | undefined)?.execute
    if (typeof raw === 'function') {
      await raw.call(adapter.db, 'DROP TABLE IF EXISTS rl_phase4' as unknown).catch(() => {})
    }
    await adapter?.disconnect()
  })

  beforeEach(async () => {
    adapter = await drizzle({
      driver:  'mysql',
      url:     MYSQL_URL!,
      tables:  { rl_phase4: mRows },
      dialect: 'mysql',
    }).create() as DrizzleAdapter

    // Re-create the test table per-test. CREATE/DROP via raw SQL because
    // drizzle-kit migrations are out of scope here.
    const raw = (adapter.db as unknown as { execute: (s: unknown) => Promise<unknown> }).execute
    if (typeof raw === 'function') {
      await raw.call(adapter.db, 'DROP TABLE IF EXISTS rl_phase4' as unknown)
      await raw.call(adapter.db,
        'CREATE TABLE rl_phase4 (id INT PRIMARY KEY AUTO_INCREMENT, views INT NOT NULL DEFAULT 0)' as unknown,
      )
    }
  })

  it('increment() returns the updated row', async () => {
    const created = await adapter.query<MRow>('rl_phase4').create({ views: 0 })
    const after   = await adapter.query<MRow>('rl_phase4').increment(created.id, 'views', 5)
    assert.equal(after.views, 5)
  })

  it('deleteAll() reports the exact affected count', async () => {
    const qb = adapter.query<MRow>('rl_phase4')
    for (let i = 0; i < 50; i++) await qb.create({ views: i })
    const n = await adapter.query<MRow>('rl_phase4').deleteAll()
    assert.equal(n, 50)
  })

  it('prune --mass chunk loop terminates correctly (35 rows, chunk=10)', async () => {
    const qb = adapter.query<MRow>('rl_phase4')
    for (let i = 0; i < 35; i++) await qb.create({ views: i })

    // Emulate the prune --mass loop: delete `chunk` rows at a time until
    // the affected-row count is less than chunk. Before this fix, MySQL
    // returned 0 here so the loop exited after the first iteration with
    // 25 rows left in the table.
    const chunk = 10
    let deleted: number
    let total = 0
    do {
      deleted = await adapter.query<MRow>('rl_phase4').limit(chunk).deleteAll()
      total += deleted
    } while (deleted === chunk)

    assert.equal(total, 35)
    assert.equal(await adapter.query<MRow>('rl_phase4').count(), 0)
  })
})
