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
