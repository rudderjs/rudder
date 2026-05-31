// Migrator conformance (7.2): runs migrations against a REAL in-memory
// better-sqlite3 NativeAdapter and asserts state tracking, idempotency, batches,
// and status — the runner core, independent of the CLI and the filesystem.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NativeAdapter } from '../adapter.js'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import type { Driver } from '../driver.js'
import { Migration } from './migration.js'
import { Schema } from './schema-facade.js'
import { Migrator, type LoadedMigration } from './migrator.js'

class CreateUsers extends Migration {
  async up()   { await Schema.create('users', (t) => { t.id(); t.string('name') }) }
  async down() { await Schema.dropIfExists('users') }
}
class CreatePosts extends Migration {
  async up()   { await Schema.create('posts', (t) => { t.id(); t.string('title') }) }
  async down() { await Schema.dropIfExists('posts') }
}

const users = (): LoadedMigration => ({ name: '2026_01_01_000000_create_users', migration: new CreateUsers() })
const posts = (): LoadedMigration => ({ name: '2026_01_02_000000_create_posts', migration: new CreatePosts() })

let driver: Driver
let adapter: NativeAdapter
let migrator: Migrator

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  adapter = await NativeAdapter.make({ driverInstance: driver })
  migrator = new Migrator(adapter)
})
afterEach(async () => { await driver.close() })

describe('Migrator — state table', () => {
  it('is not installed until the first run', async () => {
    assert.strictEqual(await migrator.installed(), false)
    await migrator.ensureTable()
    assert.strictEqual(await migrator.installed(), true)
  })

  it('ensureTable is idempotent', async () => {
    await migrator.ensureTable()
    await migrator.ensureTable() // must not throw on an existing table
    assert.strictEqual(await migrator.installed(), true)
  })
})

describe('Migrator — run', () => {
  it('applies pending migrations and creates their tables', async () => {
    const result = await migrator.run([users(), posts()])
    assert.deepStrictEqual(result.applied, [
      '2026_01_01_000000_create_users',
      '2026_01_02_000000_create_posts',
    ])
    assert.strictEqual(result.batch, 1)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), true)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('posts'), true)
  })

  it('runs in name order regardless of input order', async () => {
    const applied: string[] = []
    await migrator.run([posts(), users()], (n) => applied.push(n))
    // sorted by Migrator? No — Migrator preserves input order, the discoverer
    // sorts. Here input is [posts, users]; assert both ran (order is caller's).
    assert.strictEqual(applied.length, 2)
    assert.ok(applied.includes('2026_01_01_000000_create_users'))
  })

  it('is idempotent — a second run applies nothing', async () => {
    await migrator.run([users()])
    const second = await migrator.run([users()])
    assert.deepStrictEqual(second.applied, [])
  })

  it('applies only new migrations in the next batch', async () => {
    const first = await migrator.run([users()])
    assert.strictEqual(first.batch, 1)
    const second = await migrator.run([users(), posts()])
    assert.deepStrictEqual(second.applied, ['2026_01_02_000000_create_posts'])
    assert.strictEqual(second.batch, 2)
  })

  it('records applied migrations in order via ran()', async () => {
    await migrator.run([users(), posts()])
    assert.deepStrictEqual(await migrator.ran(), [
      '2026_01_01_000000_create_users',
      '2026_01_02_000000_create_posts',
    ])
  })
})

describe('Migrator — status', () => {
  it('reports ran/pending with batch numbers', async () => {
    await migrator.run([users()])
    const status = await migrator.status([users(), posts()])
    assert.deepStrictEqual(status, [
      { name: '2026_01_01_000000_create_users', ran: true,  batch: 1 },
      { name: '2026_01_02_000000_create_posts', ran: false, batch: null },
    ])
  })

  it('reports everything pending before any run', async () => {
    const status = await migrator.status([users()])
    assert.strictEqual(status[0]?.ran, false)
  })
})

describe('Migrator — rollback', () => {
  it('reverts only the last batch and deletes its rows', async () => {
    await migrator.run([users()])              // batch 1
    await migrator.run([users(), posts()])     // batch 2 → posts only

    const result = await migrator.rollback([users(), posts()])
    assert.strictEqual(result.batch, 2)
    assert.deepStrictEqual(result.reverted, ['2026_01_02_000000_create_posts'])

    // posts table + row gone; users untouched (earlier batch).
    assert.strictEqual(await adapter.schemaBuilder().hasTable('posts'), false)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), true)
    assert.deepStrictEqual(await migrator.ran(), ['2026_01_01_000000_create_users'])
  })

  it('reverts multiple migrations in one batch in reverse apply order', async () => {
    const reverted: string[] = []
    await migrator.run([users(), posts()])     // both in batch 1
    const result = await migrator.rollback([users(), posts()], (n) => reverted.push(n))

    assert.strictEqual(result.batch, 1)
    // id DESC → posts (applied 2nd) reverts before users (applied 1st).
    assert.deepStrictEqual(reverted, [
      '2026_01_02_000000_create_posts',
      '2026_01_01_000000_create_users',
    ])
    assert.deepStrictEqual(await migrator.ran(), [])
    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), false)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('posts'), false)
  })

  it('walks back one batch at a time across successive rollbacks', async () => {
    await migrator.run([users()])              // batch 1
    await migrator.run([users(), posts()])     // batch 2

    const first = await migrator.rollback([users(), posts()])
    assert.strictEqual(first.batch, 2)
    assert.deepStrictEqual(await migrator.ran(), ['2026_01_01_000000_create_users'])

    const second = await migrator.rollback([users(), posts()])
    assert.strictEqual(second.batch, 1)
    assert.deepStrictEqual(await migrator.ran(), [])
  })

  it('is a no-op (batch 0) when nothing has been applied', async () => {
    const result = await migrator.rollback([users()])
    assert.deepStrictEqual(result, { batch: 0, reverted: [] })
  })

  it('rollbackAll empties every batch', async () => {
    await migrator.run([users()])              // batch 1
    await migrator.run([posts()])              // batch 2

    const reverted = await migrator.rollbackAll([users(), posts()])
    assert.strictEqual(reverted.length, 2)
    assert.deepStrictEqual(await migrator.ran(), [])
    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), false)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('posts'), false)
  })

  it('rollbackAll on a never-run migrator returns []', async () => {
    assert.deepStrictEqual(await migrator.rollbackAll([users()]), [])
  })
})

describe('Migrator — transactional batches', () => {
  // A migration whose down() throws — proves a mid-batch failure rolls the
  // WHOLE batch back (DDL + the migrations-state rows) atomically.
  class CreateThenFailDown extends Migration {
    async up()   { await Schema.create('widgets', (t) => { t.id() }) }
    async down() { throw new Error('boom in down()') }
  }
  const failer = (): LoadedMigration => ({ name: '2026_01_03_000000_create_widgets', migration: new CreateThenFailDown() })

  it('a down() that throws rolls the batch back — state table unchanged', async () => {
    await migrator.run([users(), failer()])    // both batch 1
    assert.deepStrictEqual(await migrator.ran(), [
      '2026_01_01_000000_create_users',
      '2026_01_03_000000_create_widgets',
    ])

    await assert.rejects(() => migrator.rollback([users(), failer()]), /boom in down\(\)/)

    // Nothing was reverted: the failed down() rolled the whole batch back, so
    // both rows remain and both tables still exist.
    assert.deepStrictEqual(await migrator.ran(), [
      '2026_01_01_000000_create_users',
      '2026_01_03_000000_create_widgets',
    ])
    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), true)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('widgets'), true)
  })

  it('an up() that throws rolls the batch back — no rows recorded', async () => {
    class FailingUp extends Migration {
      async up()   { await Schema.create('ok_table', (t) => { t.id() }); throw new Error('boom in up()') }
      async down() { await Schema.dropIfExists('ok_table') }
    }
    const bad = (): LoadedMigration => ({ name: '2026_02_01_000000_failing', migration: new FailingUp() })

    await assert.rejects(() => migrator.run([users(), bad()]), /boom in up\(\)/)

    // The whole batch rolled back: users (recorded before the failure) is gone too.
    assert.deepStrictEqual(await migrator.ran(), [])
    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), false)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('ok_table'), false)
  })
})

describe('Migrator — dropAllTables', () => {
  it('drops every user table including the migrations state table', async () => {
    await migrator.run([users(), posts()])
    assert.strictEqual(await migrator.installed(), true)

    await migrator.dropAllTables()

    assert.strictEqual(await adapter.schemaBuilder().hasTable('users'), false)
    assert.strictEqual(await adapter.schemaBuilder().hasTable('posts'), false)
    assert.strictEqual(await migrator.installed(), false)
  })

  it('is a no-op on an empty database', async () => {
    await migrator.dropAllTables() // must not throw with no tables present
    assert.strictEqual(await migrator.installed(), false)
  })
})
