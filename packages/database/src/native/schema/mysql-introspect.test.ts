// ─── mysql introspection → types generator — LIVE tests ───
//
// Gated on MYSQL_TEST_URL (same harness as drivers/mysql.test.ts). Proves the
// schema→TS types pipeline (7.8) against a real MySQL: build a table through the
// mysql DDL compiler, introspect it via information_schema, and assert the
// generated column types + emitted registry.d.ts. Skips cleanly when unset.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MysqlDriver } from '../drivers/mysql.js'
import { MysqlDialect } from '../dialect-mysql.js'
import { SchemaBuilder } from './schema-builder.js'
import { Blueprint } from './blueprint.js'
import { collectSchemaTypes } from './schema-types.js'
import { emitRegistryDts } from './types-generator.js'

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('mysql introspection live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('mysql introspection → types (live)', () => {
    let driver: MysqlDriver
    let schema: SchemaBuilder
    const dialect = new MysqlDialect()

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      schema = new SchemaBuilder(driver, dialect)
      await schema.dropIfExists('rudder_mysql_introspect')
      await schema.create('rudder_mysql_introspect', (t: Blueprint) => {
        t.id()
        t.string('name')                  // varchar → string
        t.boolean('active')               // tinyint(1) → number (cast refines → boolean)
        t.integer('age')                  // int → number
        t.json('meta')                    // json → unknown
        t.timestamp('seen_at').nullable() // timestamp, nullable → Date | null
        t.decimal('amount', 12, 2)        // decimal → string
      })
    })

    after(async () => {
      await schema.dropIfExists('rudder_mysql_introspect')
      await driver.close()
    })

    it('reads only user tables (excludes migrations)', async () => {
      const types = await collectSchemaTypes(driver, dialect)
      const names = types.map((t) => t.table)
      assert.ok(names.includes('rudder_mysql_introspect'))
      assert.ok(!names.includes('migrations'), 'migrations bookkeeping table must be excluded')
    })

    it('maps mysql column types to the right TS types', async () => {
      const types = await collectSchemaTypes(driver, dialect)
      const table = types.find((t) => t.table === 'rudder_mysql_introspect')
      assert.ok(table)
      const byName = new Map(table.columns.map((c) => [c.name, c.ts]))
      assert.equal(byName.get('id'), 'number')           // bigint → number
      assert.equal(byName.get('name'), 'string')
      assert.equal(byName.get('active'), 'number')        // tinyint → number (no cast)
      assert.equal(byName.get('age'), 'number')
      assert.equal(byName.get('meta'), 'unknown')         // json
      assert.equal(byName.get('seen_at'), 'Date | null')  // nullable timestamp
      assert.equal(byName.get('amount'), 'string')        // decimal kept as string
    })

    it('a model cast overrides the mysql storage type', async () => {
      const types = await collectSchemaTypes(driver, dialect, [
        { table: 'rudder_mysql_introspect', casts: { active: 'boolean', amount: 'float' } },
      ])
      const table = types.find((t) => t.table === 'rudder_mysql_introspect')
      const byName = new Map(table?.columns.map((c) => [c.name, c.ts]))
      assert.equal(byName.get('active'), 'boolean')  // boolean cast refines tinyint→number to boolean
      assert.equal(byName.get('amount'), 'number')   // float cast refines decimal→string to number
    })

    it('emits a registry.d.ts augmentation with the introspected shape', async () => {
      const types = await collectSchemaTypes(driver, dialect)
      const dts = emitRegistryDts(types)
      assert.match(dts, /declare module '@rudderjs\/orm'/)
      assert.match(dts, /interface SchemaRegistry/)
      assert.match(dts, /rudder_mysql_introspect: \{/)
      assert.match(dts, /seen_at: Date \| null/)
    })
  })
}
