// Common table expressions through the Model layer — `withExpression` /
// `withRecursiveExpression` on `Model` statics + query chains (the compiler
// units live in @rudderjs/database's own cte.test.ts; this suite proves the
// hydrating-proxy forwarding, Model-rooted CTE bodies, and the
// unsupported-adapter guard).

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class Employee extends Model {
  static override table = 'employees'
  id!:        number
  name!:      string
  managerId!: number | null
}

let driver: Driver

describe('CTE (Model layer, native sqlite)', () => {
  before(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(
      'CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, managerId INTEGER)', [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    // alice (1) → bob (2) → carol (3); dave (4) reports to alice.
    for (const [name, managerId] of [['alice', null], ['bob', 1], ['carol', 2], ['dave', 1]] as const) {
      await Employee.create({ name, managerId })
    }
  })
  after(async () => { await driver.close() })

  const names = (rows: Employee[]): string[] => rows.map(r => r.name).sort()

  it('Model static + raw-SQL body + join — rows hydrate as Models', async () => {
    const rows = await Employee
      .withExpression('managers', 'SELECT DISTINCT managerId AS id FROM employees WHERE managerId IS NOT NULL')
      .join('managers', 'employees.id', '=', 'managers.id')
      .get()
    assert.deepEqual(names(rows), ['alice', 'bob'])
    assert.ok(rows[0] instanceof Employee)
  })

  it('Model.query() chain + builder-backed body (a Model query as the CTE)', async () => {
    const rows = await Employee.query()
      .withExpression('reports', Employee.where('managerId', 1))
      .join('reports', 'employees.id', '=', 'reports.id')
      .get()
    assert.deepEqual(names(rows), ['bob', 'dave'])
  })

  it('recursive CTE walks the hierarchy; paginate() total agrees', async () => {
    const subtree = () =>
      Employee.withRecursiveExpression(
        'subtree',
        'SELECT id FROM employees WHERE id = ? UNION ALL SELECT e.id FROM employees e JOIN subtree s ON e.managerId = s.id',
        { bindings: [1], columns: ['id'] },
      ).join('subtree', 'employees.id', '=', 'subtree.id')
    assert.deepEqual(names(await subtree().get()), ['alice', 'bob', 'carol', 'dave'])
    const page = await subtree().paginate(1, 2)
    assert.strictEqual(page.total, 4)
    assert.strictEqual(page.data.length, 2)
  })
})

// ── Live Postgres — WITH RECURSIVE + the ?→$n rebind inside a raw CTE body ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  it('native CTE pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('CTE (live pg)', () => {
    class PgEmployee extends Model {
      static override table = 'rudder_cte_employees'
      id!:   number
      name!: string
    }
    let pgDriver: import('@rudderjs/database/native').PostgresDriver

    before(async () => {
      const { PostgresDriver, PgDialect, NativeAdapter: NA } = await import('@rudderjs/database/native')
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute('DROP TABLE IF EXISTS rudder_cte_employees', [])
      await pgDriver.execute(
        'CREATE TABLE rudder_cte_employees (id SERIAL PRIMARY KEY, name TEXT, "managerId" INTEGER)', [])
      for (const [name, managerId] of [['alice', null], ['bob', 1], ['carol', 2], ['dave', 1]] as const) {
        await pgDriver.execute('INSERT INTO rudder_cte_employees (name, "managerId") VALUES ($1, $2)', [name, managerId])
      }
      ModelRegistry.reset()
      ModelRegistry.set(await NA.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })
    after(async () => {
      await pgDriver.execute('DROP TABLE IF EXISTS rudder_cte_employees', [])
      await pgDriver.close()
    })

    it('recursive CTE runs live — raw-body ? placeholders rebind to $n', async () => {
      const rows = await PgEmployee.withRecursiveExpression(
        'subtree',
        'SELECT id FROM rudder_cte_employees WHERE id = ? UNION ALL ' +
          'SELECT e.id FROM rudder_cte_employees e JOIN subtree s ON e."managerId" = s.id',
        { bindings: [1], columns: ['id'] },
      )
        .join('subtree', 'rudder_cte_employees.id', '=', 'subtree.id')
        .get()
      assert.deepStrictEqual(rows.map(r => r.name).sort(), ['alice', 'bob', 'carol', 'dave'])
    })
  })
}

describe('CTE — unsupported-adapter guard', () => {
  it('throws the forward-or-throw error when the adapter QB lacks the method', () => {
    const bareQb = {} as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    class Thing extends Model {
      static override table = 'things'
    }

    assert.throws(
      () => Thing.query().withExpression('x', 'SELECT 1'),
      /withExpression\(\) is not supported on this adapter/,
    )
    assert.throws(
      () => Thing.query().withRecursiveExpression('x', 'SELECT 1'),
      /withRecursiveExpression\(\) is not supported on this adapter/,
    )
  })
})
