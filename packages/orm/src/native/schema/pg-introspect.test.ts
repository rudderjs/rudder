// ─── pg introspection → types generator — LIVE tests ──────
//
// Gated on PG_TEST_URL (same harness as drivers/postgres.test.ts). Proves the
// schema→TS types pipeline (7.7c) against a real Postgres: build a table through
// the pg DDL compiler, introspect it via information_schema, and assert the
// generated column types + emitted registry.d.ts. Skips cleanly when unset.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PostgresDriver } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { SchemaBuilder } from './schema-builder.js'
import { Blueprint } from './blueprint.js'
import { collectSchemaTypes } from './schema-types.js'
import { emitRegistryDts } from './types-generator.js'

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('pg introspection live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('pg introspection → types (live)', () => {
    let driver: PostgresDriver
    let schema: SchemaBuilder
    const dialect = new PgDialect()

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      schema = new SchemaBuilder(driver, dialect)
      await schema.dropIfExists('rudder_pg_introspect')
      await schema.create('rudder_pg_introspect', (t: Blueprint) => {
        t.id()
        t.string('name')                  // varchar → string
        t.boolean('active')               // boolean → boolean
        t.integer('age')                  // integer → number
        t.json('meta')                    // jsonb → unknown
        t.timestamp('seen_at').nullable() // timestamptz, nullable → Date | null
        t.decimal('amount', 12, 2)        // numeric → string (porsager)
      })
    })

    after(async () => {
      await schema.dropIfExists('rudder_pg_introspect')
      await driver.close()
    })

    it('reads only user tables (excludes migrations)', async () => {
      const types = await collectSchemaTypes(driver, dialect)
      const names = types.map((t) => t.table)
      assert.ok(names.includes('rudder_pg_introspect'))
      assert.ok(!names.includes('migrations'), 'migrations bookkeeping table must be excluded')
    })

    it('maps pg column types to the right TS types', async () => {
      const types = await collectSchemaTypes(driver, dialect)
      const table = types.find((t) => t.table === 'rudder_pg_introspect')
      assert.ok(table)
      const byName = new Map(table.columns.map((c) => [c.name, c.ts]))
      assert.equal(byName.get('id'), 'number')          // bigserial → bigint → number
      assert.equal(byName.get('name'), 'string')
      assert.equal(byName.get('active'), 'boolean')
      assert.equal(byName.get('age'), 'number')
      assert.equal(byName.get('meta'), 'unknown')       // jsonb
      assert.equal(byName.get('seen_at'), 'Date | null') // nullable timestamptz
      assert.equal(byName.get('amount'), 'string')      // numeric kept as string
    })

    it('a model cast overrides the pg storage type', async () => {
      const types = await collectSchemaTypes(driver, dialect, [
        { table: 'rudder_pg_introspect', casts: { amount: 'float', meta: 'json' } },
      ])
      const table = types.find((t) => t.table === 'rudder_pg_introspect')
      const byName = new Map(table?.columns.map((c) => [c.name, c.ts]))
      assert.equal(byName.get('amount'), 'number')  // float cast refines numeric→string to number
      assert.equal(byName.get('meta'), 'unknown')   // json cast → unknown
    })

    it('emits a registry.d.ts augmentation with the introspected shape', async () => {
      const types = await collectSchemaTypes(driver, dialect)
      const dts = emitRegistryDts(types)
      assert.match(dts, /declare module '@rudderjs\/orm'/)
      assert.match(dts, /interface SchemaRegistry/)
      assert.match(dts, /rudder_pg_introspect: \{/)
      assert.match(dts, /active: boolean/)
      assert.match(dts, /seen_at: Date \| null/)
    })
  })
}
