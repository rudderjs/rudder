// Schema facade binding (7.2): the static `Schema` delegates to a bound
// SchemaBuilder; calling it unbound throws; `withSchema` binds for the duration
// and always unbinds — even when the body throws.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import { SqliteDialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { NativeOrmError } from '../errors.js'
import { SchemaBuilder } from './schema-builder.js'
import { Schema, withSchema } from './schema-facade.js'
import { NativeAdapter } from '../adapter.js'
import { registerConnectionResolver, __resetAdapterResolver } from '../../registry-bridge.js'
import type { OrmAdapter } from '@rudderjs/contracts'

let driver: Driver
let builder: SchemaBuilder

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  builder = new SchemaBuilder(driver, new SqliteDialect())
})
afterEach(async () => {
  Schema.reset()
  await driver.close()
})

describe('Schema facade', () => {
  it('throws when used with no bound connection', async () => {
    Schema.reset()
    await assert.rejects(
      () => Schema.create('t', (b) => b.id()),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_SCHEMA_UNBOUND',
    )
  })

  it('delegates to the bound builder', async () => {
    await withSchema(builder, async () => {
      await Schema.create('widgets', (t) => { t.id(); t.string('name') })
      assert.strictEqual(await Schema.hasTable('widgets'), true)
    })
  })

  it('withSchema unbinds afterwards (so a later unbound call throws)', async () => {
    await withSchema(builder, () => Schema.create('a', (t) => t.id()))
    await assert.rejects(() => Schema.hasTable('a'), (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_SCHEMA_UNBOUND')
  })

  it('withSchema unbinds even when the body throws', async () => {
    await assert.rejects(() => withSchema(builder, () => { throw new Error('boom') }))
    // still unbound
    await assert.rejects(() => Schema.hasTable('x'), (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_SCHEMA_UNBOUND')
  })
})

// ── Schema.connection(name) — named-connection DDL ────────
//
// Resolves through the same registry-bridge seam as `DB.connection()`. A fresh
// in-memory NativeAdapter stands in for the named connection (`driverInstance:`
// avoids the dev-HMR cache, so each test owns its lifecycle).

describe('Schema.connection()', () => {
  let named: NativeAdapter

  beforeEach(async () => {
    named = await NativeAdapter.make({
      driverInstance: await BetterSqlite3Driver.open({ filename: ':memory:' }),
    })
    registerConnectionResolver(async (name) => {
      if (name !== 'reporting') throw new Error(`unknown connection "${name}"`)
      return named as unknown as OrmAdapter
    })
  })
  afterEach(async () => {
    __resetAdapterResolver()
    await named.disconnect()
  })

  it('runs DDL on the NAMED connection, not the bound one', async () => {
    await withSchema(builder, async () => {
      await Schema.connection('reporting').create('events', (t) => { t.id(); t.string('kind') })
    })
    // On the named adapter…
    assert.strictEqual(await named.schemaBuilder().hasTable('events'), true)
    // …and NOT on the bound (default) connection.
    assert.strictEqual(await builder.hasTable('events'), false)
  })

  it('works outside a migration bind (no Schema.use)', async () => {
    Schema.reset()
    await Schema.connection('reporting').create('standalone', (t) => t.id())
    assert.strictEqual(await Schema.connection('reporting').hasTable('standalone'), true)
    assert.strictEqual(await Schema.connection('reporting').hasColumn('standalone', 'id'), true)
    await Schema.connection('reporting').dropIfExists('standalone')
    assert.strictEqual(await Schema.connection('reporting').hasTable('standalone'), false)
  })

  it('throws a clear engine error for a non-native connection', async () => {
    registerConnectionResolver(async () => ({}) as OrmAdapter) // prisma/drizzle shape: no schemaBuilder()
    await assert.rejects(
      () => Schema.connection('reporting').hasTable('x'),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_SCHEMA_CONNECTION_ENGINE',
    )
  })

  it('throws the bridge error when no connection resolver is registered', async () => {
    __resetAdapterResolver()
    await assert.rejects(() => Schema.connection('reporting').hasTable('x'), /No connection resolver is available/)
  })

  it('refuses under a pretend (dry-run) bind', async () => {
    await withSchema(builder, async () => {
      assert.throws(
        () => Schema.connection('reporting'),
        (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_SCHEMA_PRETEND_CONNECTION',
      )
    }, { pretend: true })
    // A normal bind afterwards is fine again (reset() cleared the flag).
    await withSchema(builder, async () => {
      await Schema.connection('reporting').create('after_pretend', (t) => t.id())
    })
    assert.strictEqual(await named.schemaBuilder().hasTable('after_pretend'), true)
  })
})
