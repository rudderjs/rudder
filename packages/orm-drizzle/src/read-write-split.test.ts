// Read/write split on the Drizzle adapter (multi-connection Task 4b).
//
// Two sqlite FILES stand in for the writer and replica(s): each file is seeded
// with a distinguishable marker row, so routing is proven by data divergence —
// a query that returns the replica's marker ran on the read pool, the writer's
// marker on the write connection. No real replication needed. (Same trick as
// the native engine's read-write-split.test.ts.)
//
// better-sqlite3 covers the fluent terminals; the transaction + raw DB-facade
// seams use libsql (better-sqlite3 rejects async transaction callbacks and its
// drizzle wrapper has no `db.execute`).

import assert from 'node:assert/strict'
import { test, before, after, beforeEach } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { QueryEvent } from '@rudderjs/contracts'
import { ConfigRepository, setConfigRepository } from '@rudderjs/core'
import type { Application } from '@rudderjs/core'
import { ModelRegistry } from '@rudderjs/orm'
import { runWithDatabaseContext } from '@rudderjs/orm/sticky'
import { DrizzleAdapter, DatabaseProvider } from './index.js'

const notes = sqliteTable('notes', {
  id:  integer('id').primaryKey({ autoIncrement: true }),
  src: text('src'),
})

let dir: string
let n = 0

/** Dispose every cached client (closes the write + replica file handles) before
 *  dropping the cache. Windows can't unlink an open sqlite file — without this
 *  the after() rmSync hits EBUSY on the leaked handles. */
async function drainClientCache(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  const cache = g['__rudderjs_drizzle_client__']
  if (cache instanceof Map) {
    for (const entry of cache.values() as Iterable<{ dispose?: () => void | Promise<void> }>) {
      await entry.dispose?.()
    }
  }
  delete g['__rudderjs_drizzle_client__']
}

before(() => { dir = mkdtempSync(join(tmpdir(), 'rudder-dz-rw-split-')) })
after(async () => {
  await drainClientCache()
  // maxRetries: Windows may need a beat after close() before unlink succeeds.
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
beforeEach(async () => {
  await drainClientCache()
  delete (globalThis as Record<string, unknown>)['__rudderjs_orm_connections__']
  ModelRegistry.reset()
})

/** Create a sqlite file seeded with one marker row in `notes(src)`. */
function seedFile(name: string, marker: string): string {
  const file = join(dir, name)
  const db = new Database(file)
  db.exec('create table notes (id integer primary key autoincrement, src text)')
  db.prepare('insert into notes (src) values (?)').run(marker)
  db.close()
  return file
}

/** Read a file's rows directly (no adapter — ground truth). */
function inspect(file: string): string[] {
  const db = new Database(file)
  const rows = db.prepare('select src from notes order by id').all() as Array<{ src: string }>
  db.close()
  return rows.map((r) => r.src)
}

/** A split adapter over fresh writer/replica files. Unique connection name per
 *  call — the dev-HMR client cache keys by name. `driver: 'libsql'` for the
 *  async-transaction / db.execute paths. */
async function splitAdapter(opts: {
  replicas?: number
  sticky?: boolean
  driver?: 'sqlite' | 'libsql'
} = {}): Promise<{ adapter: DrizzleAdapter; writeFile: string }> {
  const id = ++n
  const driver = opts.driver ?? 'sqlite'
  const writeFile = seedFile(`w${id}.db`, 'writer')
  const readFiles: string[] = []
  for (let r = 1; r <= (opts.replicas ?? 1); r++) {
    readFiles.push(seedFile(`r${id}-${r}.db`, `replica-${r}`))
  }
  // libsql's createClient requires the file: scheme; better-sqlite3 strips it.
  const toUrl = (f: string): string => (driver === 'libsql' ? `file:${f}` : f)
  const adapter = await DrizzleAdapter.make({
    driver,
    url: toUrl(writeFile),
    readUrls: readFiles.map(toUrl),
    connectionName: `dz-split-${id}`,
    tables: { notes },
    ...(opts.sticky !== undefined && { sticky: opts.sticky }),
  })
  return { adapter, writeFile }
}

type NoteRow = { src: string }

test('un-locked SELECT terminals route to the read pool', async () => {
  const { adapter } = await splitAdapter()

  const rows = await adapter.query<NoteRow>('notes').get()
  assert.deepEqual(rows.map((r) => r.src), ['replica-1'])

  const first = await adapter.query<NoteRow>('notes').first()
  assert.equal(first?.src, 'replica-1')

  assert.equal(await adapter.query('notes').count(), 1)

  const page = await adapter.query<NoteRow>('notes').paginate(1, 10)
  assert.deepEqual(page.data.map((r) => r.src), ['replica-1'])
})

test('writes land on the write connection; subsequent reads still serve the replica (no sticky)', async () => {
  const { adapter, writeFile } = await splitAdapter()
  await adapter.query('notes').create({ src: 'fresh-write' })

  // The write reached the writer file…
  assert.deepEqual(inspect(writeFile), ['writer', 'fresh-write'])
  // …and without sticky, reads keep serving the replica — including the
  // aggregate terminal (writer has 2 rows now, the replica still 1).
  const rows = await adapter.query<NoteRow>('notes').get()
  assert.deepEqual(rows.map((r) => r.src), ['replica-1'])
  assert.equal(await adapter.query('notes').count(), 1)
})

test('locked selects route to the write connection', async () => {
  const { adapter } = await splitAdapter()

  const forUpdate = await adapter.query<NoteRow>('notes').lockForUpdate!().get()
  assert.deepEqual(forUpdate.map((r) => r.src), ['writer'])

  const shared = await adapter.query<NoteRow>('notes').sharedLock!().first()
  assert.equal(shared?.src, 'writer')
})

test('every query inside a transaction runs on the write connection', async () => {
  // libsql — better-sqlite3 rejects async transaction callbacks.
  const { adapter } = await splitAdapter({ driver: 'libsql' })
  await adapter.transaction(async (tx) => {
    const rows = await tx.query<NoteRow>('notes').get()
    assert.deepEqual(rows.map((r) => r.src), ['writer'])
  })
})

test('sticky: reads after a write in the same database context route to the writer', async () => {
  const { adapter } = await splitAdapter({ sticky: true })

  await runWithDatabaseContext(async () => {
    // Before any write: replica.
    const beforeWrite = await adapter.query<NoteRow>('notes').get()
    assert.deepEqual(beforeWrite.map((r) => r.src), ['replica-1'])

    await adapter.query('notes').create({ src: 'mine' })

    // After the write: read-your-writes — the writer's data.
    const afterWrite = await adapter.query<NoteRow>('notes').get()
    assert.deepEqual(afterWrite.map((r) => r.src), ['writer', 'mine'])
  })

  // A NEW context starts clean — back to the replica.
  await runWithDatabaseContext(async () => {
    const fresh = await adapter.query<NoteRow>('notes').get()
    assert.deepEqual(fresh.map((r) => r.src), ['replica-1'])
  })

  // Outside any context the flag is a no-op (jobs/commands divergence).
  const outside = await adapter.query<NoteRow>('notes').get()
  assert.deepEqual(outside.map((r) => r.src), ['replica-1'])
})

test('sticky disabled: reads stay on the replica even after a write in context', async () => {
  const { adapter } = await splitAdapter({ sticky: false })
  await runWithDatabaseContext(async () => {
    await adapter.query('notes').create({ src: 'mine' })
    const rows = await adapter.query<NoteRow>('notes').get()
    assert.deepEqual(rows.map((r) => r.src), ['replica-1'])
  })
})

test('multiple replicas round-robin per query', async () => {
  const { adapter } = await splitAdapter({ replicas: 2 })
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    const rows = await adapter.query<NoteRow>('notes').get()
    seen.push(rows[0]?.src as string)
  }
  assert.deepEqual(seen, ['replica-1', 'replica-2', 'replica-1', 'replica-2'])
})

// ── raw DB-facade seams (execute-capable fake clients) ────
//
// Drizzle's sqlite-family wrappers have no `db.execute`, so the raw seams are
// exercised with fake execute-capable clients (same as on-query.test.ts). The
// split adapter is assembled through the ctor (compile-time-private only)
// because `make()` correctly refuses `client:` + `readUrls`; the live-pg test
// below covers the real-driver path end-to-end.

function fakeSplitAdapter(opts: { sticky?: boolean } = {}): {
  adapter:    DrizzleAdapter
  writeCalls: number[]
  readCalls:  number[]
} {
  const writeCalls: number[] = []
  const readCalls:  number[] = []
  const writeDb = { execute: async () => { writeCalls.push(1); return [{ src: 'writer' }] } }
  const readDb  = { execute: async () => { readCalls.push(1);  return [{ src: 'replica-1' }] } }
  const Ctor = DrizzleAdapter as unknown as new (
    db: unknown, tables: Record<string, unknown>, pk: string, dialect: string,
    listeners: unknown[], connectionName?: string, readDbs?: unknown[], sticky?: boolean,
  ) => DrizzleAdapter
  const adapter = new Ctor(writeDb, {}, 'id', 'pg', [], 'dz-raw-split', [readDb], opts.sticky ?? false)
  return { adapter, writeCalls, readCalls }
}

test('selectRaw routes to the read pool; affectingStatement to the writer', async () => {
  const { adapter, writeCalls, readCalls } = fakeSplitAdapter()

  const rows = await adapter.selectRaw('select src from notes', [])
  assert.deepEqual(rows.map((r) => r['src']), ['replica-1'])
  assert.deepEqual([readCalls.length, writeCalls.length], [1, 0])

  await adapter.affectingStatement("insert into notes (src) values ('raw-write')", [])
  assert.deepEqual([readCalls.length, writeCalls.length], [1, 1])
})

test('sticky covers the raw DB-facade seams too', async () => {
  const { adapter, writeCalls, readCalls } = fakeSplitAdapter({ sticky: true })
  await runWithDatabaseContext(async () => {
    await adapter.affectingStatement("insert into notes (src) values ('raw-mine')", [])
    // Sticky hit — the raw select routes to the writer.
    const rows = await adapter.selectRaw('select src from notes order by id', [])
    assert.deepEqual(rows.map((r) => r['src']), ['writer'])
    assert.deepEqual([readCalls.length, writeCalls.length], [0, 2])
  })
})

test('query events carry the connection name + read/write target on a split connection', async () => {
  const { adapter } = await splitAdapter()
  const events: QueryEvent[] = []
  adapter.onQuery((e) => events.push(e))

  await adapter.query<NoteRow>('notes').get()                       // read
  await adapter.query('notes').create({ src: 'tagged' })            // write
  await adapter.query<NoteRow>('notes').lockForUpdate!().get()      // locked → write

  assert.deepEqual(events.map((e) => e.target), ['read', 'write', 'write'])
  assert.ok(events.every((e) => e.connection?.startsWith('dz-split-')), 'events carry the connection name')
})

test('a single connection (no replicas) emits events with NO target and the dialect as connection', async () => {
  const writeFile = seedFile(`single${++n}.db`, 'solo')
  const adapter = await DrizzleAdapter.make({ driver: 'sqlite', url: writeFile, tables: { notes } })
  const events: QueryEvent[] = []
  adapter.onQuery((e) => events.push(e))

  await adapter.query<NoteRow>('notes').get()
  await adapter.query('notes').create({ src: 'x' })

  assert.equal(events.length, 2)
  assert.ok(events.every((e) => e.target === undefined), 'no target without a split')
  assert.ok(events.every((e) => e.connection === 'sqlite'), 'dialect fallback without a connection name')
})

test('dev-HMR cache: same name + signature reuses the write client AND the replicas', async () => {
  const id = ++n
  const writeFile = seedFile(`w${id}.db`, 'writer')
  const readFile = seedFile(`r${id}.db`, 'replica-1')
  const cfg = {
    driver: 'sqlite' as const,
    url: writeFile,
    readUrls: [readFile],
    connectionName: `dz-reuse-${id}`,
    tables: { notes },
  }
  const first  = await DrizzleAdapter.make(cfg)
  const second = await DrizzleAdapter.make(cfg)
  assert.strictEqual(second.db, first.db, 'write client reused')
  // The replica clients were reused too — routing still works on the re-make.
  const rows = await second.query<NoteRow>('notes').get()
  assert.deepEqual(rows.map((r) => r.src), ['replica-1'])
})

test('readUrls with a pre-built client: throws (the adapter cannot open replicas for it)', async () => {
  await assert.rejects(
    DrizzleAdapter.make({ client: {}, readUrls: [':memory:'], connectionName: 'dz-client-split' }),
    /readUrls.*url-based config/s,
  )
})

// ── provider: read/write/sticky config maps onto the adapter ──

function fakeApp(): Application {
  return { instance: () => {} } as unknown as Application
}

test('provider: read/write/sticky connection config boots a routing split adapter', async () => {
  const id = ++n
  const writeFile = seedFile(`pw${id}.db`, 'writer')
  const readFile = seedFile(`pr${id}.db`, 'replica-1')
  setConfigRepository(new ConfigRepository({ database: {
    default: 'main',
    connections: {
      main: {
        driver: 'sqlite',
        write: { url: writeFile },
        read:  { url: readFile },
        sticky: true,
      },
    },
    tables: { notes },
  } }))

  await new DatabaseProvider(fakeApp()).boot()

  const adapter = ModelRegistry.get()!
  // Reads serve the replica…
  const rows = await adapter.query<NoteRow>('notes').get()
  assert.deepEqual(rows.map((r) => r.src), ['replica-1'])
  // …writes land on the writer, and sticky routes the follow-up read there.
  await runWithDatabaseContext(async () => {
    await adapter.query('notes').create({ src: 'mine' })
    const after = await adapter.query<NoteRow>('notes').get()
    assert.deepEqual(after.map((r) => r.src), ['writer', 'mine'])
  })
  assert.deepEqual(inspect(writeFile), ['writer', 'mine'])
})

// ── live Postgres (gated) — split open/route/close on a real pooled driver ──
//
// read=write (same server) — routing is already proven by the sqlite two-file
// suite; this covers the pg-specific risk: TWO postgres-js pools opened per
// split connection, fluent + raw seams tagged correctly, both pools closed by
// disconnect(). (Mirrors the native engine's gated live-pg split test.)
const PG_URL = process.env['PG_TEST_URL']

test('live pg: split connection opens, tags read/write targets, and closes both pools', { skip: !PG_URL }, async () => {
  const { pgTable, serial, text: pgText } = await import('drizzle-orm/pg-core')
  const probe = `dz_rw_split_probe_${process.pid}`
  const probeTable = pgTable(probe, {
    id:  serial('id').primaryKey(),
    src: pgText('src'),
  })
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    readUrls: [PG_URL!],
    connectionName: `dz-pg-split-${process.pid}`,
    tables: { [probe]: probeTable },
  })
  try {
    const events: QueryEvent[] = []
    adapter.onQuery((e) => events.push(e))

    await adapter.affectingStatement(`create table if not exists ${probe} (id serial primary key, src text)`, [])
    await adapter.query(probe).create({ src: 'live' })
    await adapter.query<NoteRow>(probe).get()
    const raw = await adapter.selectRaw(`select src from ${probe}`, [])
    assert.deepEqual(raw.map((r) => r['src']), ['live'])
    await adapter.affectingStatement(`drop table ${probe}`, [])

    const targets = events.map((e) => e.target)
    assert.ok(targets.includes('read'), 'select tagged read')
    assert.ok(targets.includes('write'), 'write tagged write')
    assert.ok(!targets.includes(undefined), 'every event tagged on a split connection')
    assert.ok(events.every((e) => e.connection?.startsWith('dz-pg-split-')), 'events carry the connection name')
  } finally {
    await adapter.disconnect()
  }
})
