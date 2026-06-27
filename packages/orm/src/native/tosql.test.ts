// toSQL() on a Model chain — the HydratingQueryBuilder proxy forwards it to the
// native builder, which compiles the { sql, bindings } pair WITHOUT executing.
// Laravel's toSql() (plus the bound values). Native engine only.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
  role!: string
  active!: boolean
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(
    `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, active INTEGER)`,
    [],
  )
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

afterEach(async () => {
  await driver.close()
})

describe('Model chain — toSQL()', () => {
  it('compiles a where() chain to { sql, bindings } without executing', () => {
    const { sql, bindings } = User.query().where('active', true).toSQL()
    assert.match(sql, /SELECT \* FROM "users" WHERE "active" = \?/)
    assert.deepStrictEqual(bindings, [true])
  })

  it('bindings + ORDER BY reflect a where().orderBy() chain', () => {
    const { sql, bindings } = User.where('role', 'admin').orderBy('name').toSQL()
    assert.match(sql, /WHERE "role" = \?/)
    assert.match(sql, /ORDER BY "name" ASC/)
    assert.deepStrictEqual(bindings, ['admin'])
  })
})
