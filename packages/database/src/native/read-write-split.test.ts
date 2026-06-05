// Read/write split on the native engine (multi-connection Task 3).
//
// Two sqlite FILES stand in for the writer and replica(s): each file is seeded
// with a distinguishable marker row, so routing is proven by data divergence —
// a query that returns the replica's marker ran on the read pool, the writer's
// marker on the write connection. No real replication needed.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueryEvent } from '@rudderjs/contracts'
import { NativeAdapter } from './adapter.js'
import { runWithDatabaseContext } from '../sticky.js'

let dir: string
let n = 0

before(() => { dir = mkdtempSync(join(tmpdir(), 'rudder-rw-split-')) })
after(() => { rmSync(dir, { recursive: true, force: true }) })

/** Create a sqlite file seeded with one marker row in `notes(src)`. */
async function seedFile(name: string, marker: string): Promise<string> {
  const file = join(dir, name)
  const seeder = await NativeAdapter.make({ driver: 'sqlite', url: file })
  await seeder.affectingStatement('create table notes (id integer primary key autoincrement, src text)', [])
  await seeder.affectingStatement('insert into notes (src) values (?)', [marker])
  await seeder.disconnect()
  return file
}

/** A split adapter over fresh writer/replica files. Unique connection name per
 *  call — the dev-HMR client cache keys by name. */
async function splitAdapter(opts: { replicas?: number; sticky?: boolean } = {}): Promise<{
  adapter: NativeAdapter
  writeFile: string
  inspect: (file: string) => Promise<string[]>
}> {
  const id = ++n
  const writeFile = await seedFile(`w${id}.db`, 'writer')
  const readUrls: string[] = []
  for (let r = 1; r <= (opts.replicas ?? 1); r++) {
    readUrls.push(await seedFile(`r${id}-${r}.db`, `replica-${r}`))
  }
  const adapter = await NativeAdapter.make({
    driver: 'sqlite',
    url: writeFile,
    readUrls,
    connectionName: `split-${id}`,
    ...(opts.sticky !== undefined && { sticky: opts.sticky }),
  })
  const inspect = async (file: string): Promise<string[]> => {
    const direct = await NativeAdapter.make({ driver: 'sqlite', url: file })
    const rows = await direct.selectRaw('select src from notes order by id', [])
    await direct.disconnect()
    return rows.map((r) => r.src as string)
  }
  return { adapter, writeFile, inspect }
}

test('un-locked SELECT terminals route to the read pool', async () => {
  const { adapter } = await splitAdapter()
  try {
    const rows = await adapter.query<{ src: string }>('notes').get()
    assert.deepEqual(rows.map((r) => r.src), ['replica-1'])

    const first = await adapter.query<{ src: string }>('notes').first()
    assert.equal(first?.src, 'replica-1')

    assert.equal(await adapter.query('notes').count(), 1)

    const page = await adapter.query<{ src: string }>('notes').paginate(1, 10)
    assert.deepEqual(page.data.map((r) => r.src), ['replica-1'])
  } finally {
    await adapter.disconnect()
  }
})

test('writes land on the write connection; subsequent reads still serve the replica (no sticky)', async () => {
  const { adapter, writeFile, inspect } = await splitAdapter()
  try {
    await adapter.query('notes').create({ src: 'fresh-write' })

    // The write reached the writer file…
    assert.deepEqual(await inspect(writeFile), ['writer', 'fresh-write'])
    // …and without sticky, reads keep serving the replica.
    const rows = await adapter.query<{ src: string }>('notes').get()
    assert.deepEqual(rows.map((r) => r.src), ['replica-1'])
  } finally {
    await adapter.disconnect()
  }
})

test('locked selects route to the write connection', async () => {
  const { adapter } = await splitAdapter()
  try {
    const forUpdate = await adapter.query<{ src: string }>('notes').lockForUpdate!().get()
    assert.deepEqual(forUpdate.map((r) => r.src), ['writer'])

    const shared = await adapter.query<{ src: string }>('notes').sharedLock!().first()
    assert.equal(shared?.src, 'writer')
  } finally {
    await adapter.disconnect()
  }
})

test('every query inside a transaction runs on the write connection', async () => {
  const { adapter } = await splitAdapter()
  try {
    await adapter.transaction(async (tx) => {
      const rows = await tx.query<{ src: string }>('notes').get()
      assert.deepEqual(rows.map((r) => r.src), ['writer'])
    })
  } finally {
    await adapter.disconnect()
  }
})

test('sticky: reads after a write in the same database context route to the writer', async () => {
  const { adapter } = await splitAdapter({ sticky: true })
  try {
    await runWithDatabaseContext(async () => {
      // Before any write: replica.
      const beforeWrite = await adapter.query<{ src: string }>('notes').get()
      assert.deepEqual(beforeWrite.map((r) => r.src), ['replica-1'])

      await adapter.query('notes').create({ src: 'mine' })

      // After the write: read-your-writes — the writer's data.
      const afterWrite = await adapter.query<{ src: string }>('notes').get()
      assert.deepEqual(afterWrite.map((r) => r.src), ['writer', 'mine'])
    })

    // A NEW context starts clean — back to the replica.
    await runWithDatabaseContext(async () => {
      const fresh = await adapter.query<{ src: string }>('notes').get()
      assert.deepEqual(fresh.map((r) => r.src), ['replica-1'])
    })

    // Outside any context the flag is a no-op (jobs/commands divergence).
    const outside = await adapter.query<{ src: string }>('notes').get()
    assert.deepEqual(outside.map((r) => r.src), ['replica-1'])
  } finally {
    await adapter.disconnect()
  }
})

test('sticky disabled: reads stay on the replica even after a write in context', async () => {
  const { adapter } = await splitAdapter({ sticky: false })
  try {
    await runWithDatabaseContext(async () => {
      await adapter.query('notes').create({ src: 'mine' })
      const rows = await adapter.query<{ src: string }>('notes').get()
      assert.deepEqual(rows.map((r) => r.src), ['replica-1'])
    })
  } finally {
    await adapter.disconnect()
  }
})

test('multiple replicas round-robin per query', async () => {
  const { adapter } = await splitAdapter({ replicas: 2 })
  try {
    const seen: string[] = []
    for (let i = 0; i < 4; i++) {
      const rows = await adapter.query<{ src: string }>('notes').get()
      seen.push(rows[0]?.src as string)
    }
    assert.deepEqual(seen, ['replica-1', 'replica-2', 'replica-1', 'replica-2'])
  } finally {
    await adapter.disconnect()
  }
})

test('selectRaw routes to the read pool; affectingStatement to the writer', async () => {
  const { adapter, writeFile, inspect } = await splitAdapter()
  try {
    const rows = await adapter.selectRaw('select src from notes', [])
    assert.deepEqual(rows.map((r) => r.src), ['replica-1'])

    await adapter.affectingStatement("insert into notes (src) values ('raw-write') returning *", [])
    assert.deepEqual(await inspect(writeFile), ['writer', 'raw-write'])
  } finally {
    await adapter.disconnect()
  }
})

test('query events carry the connection name + read/write target on a split connection', async () => {
  const { adapter } = await splitAdapter()
  try {
    const events: QueryEvent[] = []
    adapter.onQuery((e) => events.push(e))

    await adapter.query<{ src: string }>('notes').get()              // read
    await adapter.query('notes').create({ src: 'tagged' })           // write
    await adapter.query<{ src: string }>('notes').lockForUpdate!().get() // locked → write

    assert.deepEqual(events.map((e) => e.target), ['read', 'write', 'write'])
    assert.ok(events.every((e) => e.connection?.startsWith('split-')), 'events carry the connection name')
  } finally {
    await adapter.disconnect()
  }
})

test('a single connection (no replicas) emits events with NO target', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  try {
    await adapter.affectingStatement('create table notes (id integer primary key, src text)', [])
    const events: QueryEvent[] = []
    adapter.onQuery((e) => events.push(e))

    await adapter.query('notes').get()
    await adapter.query('notes').create({ id: 1, src: 'x' })

    assert.equal(events.length, 2)
    assert.ok(events.every((e) => e.target === undefined), 'no target without a split')
  } finally {
    await adapter.disconnect()
  }
})

test('disconnect closes the replica drivers too (a later read fails fast, not hangs)', async () => {
  const { adapter } = await splitAdapter()
  await adapter.disconnect()
  await assert.rejects(() => adapter.query('notes').get(), /not open/i)
})

// ── live Postgres (gated) — split open/route/close on a real pooled driver ──
//
// read=write (same server) — routing is already proven by the sqlite two-file
// suite; this covers the pg-specific risk: TWO porsager pools opened per split
// connection, both tagged correctly, both closed by disconnect().
const PG_URL = process.env['PG_TEST_URL']

test('live pg: split connection opens, tags read/write targets, and closes both pools', { skip: !PG_URL }, async () => {
  const adapter = await NativeAdapter.make({
    driver: 'pg',
    url: PG_URL!,
    readUrls: [PG_URL!],
    connectionName: `pg-split-${process.pid}`,
  })
  try {
    const events: QueryEvent[] = []
    adapter.onQuery((e) => events.push(e))

    await adapter.affectingStatement('create table if not exists rw_split_probe (id serial primary key, src text)', [])
    await adapter.query('rw_split_probe').create({ src: 'live' })
    await adapter.query<{ src: string }>('rw_split_probe').get()
    await adapter.affectingStatement('drop table rw_split_probe', [])

    const targets = events.map((e) => e.target)
    assert.ok(targets.includes('read'), 'select tagged read')
    assert.ok(targets.includes('write'), 'write tagged write')
    assert.ok(!targets.includes(undefined), 'every event tagged on a split connection')
  } finally {
    await adapter.disconnect()
  }
})

// Same shape on MySQL (audit P1-8: split routing had ZERO mysql live coverage
// — pool semantics, target tagging, and the dual-pool teardown are
// driver-specific). read=write (same server) — routing itself is proven by
// the sqlite two-file suite; this covers the mysql2-specific risk.
const MYSQL_URL = process.env['MYSQL_TEST_URL']

test('live mysql: split connection opens, tags read/write targets, and closes both pools', { skip: !MYSQL_URL }, async () => {
  const adapter = await NativeAdapter.make({
    driver: 'mysql',
    url: MYSQL_URL!,
    readUrls: [MYSQL_URL!],
    connectionName: `mysql-split-${process.pid}`,
  })
  try {
    const events: QueryEvent[] = []
    adapter.onQuery((e) => events.push(e))

    await adapter.affectingStatement(`create table if not exists rw_split_probe_my_${process.pid} (id int auto_increment primary key, src text)`, [])
    await adapter.query(`rw_split_probe_my_${process.pid}`).create({ src: 'live' })
    await adapter.query<{ src: string }>(`rw_split_probe_my_${process.pid}`).get()
    await adapter.affectingStatement(`drop table rw_split_probe_my_${process.pid}`, [])

    const targets = events.map((e) => e.target)
    assert.ok(targets.includes('read'), 'select tagged read')
    assert.ok(targets.includes('write'), 'write tagged write')
    assert.ok(!targets.includes(undefined), 'every event tagged on a split connection')
  } finally {
    await adapter.disconnect()
  }
})
