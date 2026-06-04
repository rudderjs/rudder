// Schema facade binding (7.2): the static `Schema` delegates to a bound
// SchemaBuilder; calling it unbound throws; `withSchema` binds for the duration
// and always unbinds — even when the body throws.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'
import { NativeOrmError } from '@rudderjs/database/native'
import { SchemaBuilder } from './schema-builder.js'
import { Schema, withSchema } from './schema-facade.js'

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
