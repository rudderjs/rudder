// Optimistic locking (`static version`) — end-to-end on the NATIVE engine.
//
// Proves the full read-modify-write cycle against real SQLite: create stamps
// version 1, save() bumps it, a concurrent writer's bump makes the slower
// save() throw OptimisticLockError, and refresh() + retry recovers. The
// Model-layer call-shape units live in `../optimistic-lock.test.ts`; the
// Drizzle mirror is `orm-drizzle/src/optimistic-lock.test.ts`.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, ModelNotFoundError, OptimisticLockError } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver, type Driver } from '@rudderjs/database/native'

class Doc extends Model {
  static override table = 'docs'
  static override version = true
  id!: number
  title!: string
  version!: number
}

class LedgerRow extends Model {
  static override table = 'ledger_rows'
  static override version = 'lockVersion'
  id!: number
  amount!: number
  lockVersion!: number
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE docs        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)`, [])
  await driver.execute(`CREATE TABLE ledger_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, lockVersion INTEGER NOT NULL DEFAULT 1)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

describe('optimistic locking — native sqlite E2E', () => {
  it('create() stamps version 1 and save() bumps it', async () => {
    const doc = await Doc.create({ title: 'draft' })
    assert.strictEqual(doc.version, 1)

    doc.title = 'published'
    await doc.save()
    assert.strictEqual(doc.version, 2)
    assert.strictEqual(doc.title, 'published')

    const fresh = await Doc.findOrFail(doc.id)
    assert.strictEqual(fresh.version, 2)
    assert.strictEqual(fresh.title, 'published')
  })

  it('a stale save() throws OptimisticLockError after a concurrent write', async () => {
    const created = await Doc.create({ title: 'orig' })
    const a = await Doc.findOrFail(created.id)
    const b = await Doc.findOrFail(created.id)

    a.title = 'theirs'
    await a.save() // bumps to 2

    b.title = 'mine'
    await assert.rejects(
      b.save(),
      (err: unknown) => {
        assert.ok(err instanceof OptimisticLockError)
        assert.strictEqual(err.code, 'OPTIMISTIC_LOCK')
        assert.strictEqual(err.expectedVersion, 1)
        assert.strictEqual(err.actualVersion, 2)
        assert.strictEqual(err.httpStatus, 409)
        return true
      },
    )

    // The stale write touched nothing.
    const fresh = await Doc.findOrFail(created.id)
    assert.strictEqual(fresh.title, 'theirs')
    assert.strictEqual(fresh.version, 2)
  })

  it('refresh() + retry recovers from a conflict', async () => {
    const created = await Doc.create({ title: 'orig' })
    const a = await Doc.findOrFail(created.id)
    const b = await Doc.findOrFail(created.id)

    a.title = 'theirs'
    await a.save()

    b.title = 'mine'
    await assert.rejects(b.save(), OptimisticLockError)

    await b.refresh()
    b.title = 'mine'
    await b.save()
    assert.strictEqual(b.version, 3)

    const fresh = await Doc.findOrFail(created.id)
    assert.strictEqual(fresh.title, 'mine')
    assert.strictEqual(fresh.version, 3)
  })

  it('static update() with an explicit version checks staleness', async () => {
    const doc = await Doc.create({ title: 'orig' })

    const updated = await Doc.update(doc.id, { title: 'v2', version: 1 })
    assert.strictEqual(updated.version, 2)

    await assert.rejects(Doc.update(doc.id, { title: 'late', version: 1 }), OptimisticLockError)
  })

  it('static update() without a version bumps atomically, no check', async () => {
    const doc = await Doc.create({ title: 'orig' })
    await Doc.update(doc.id, { title: 'v2', version: 1 })

    // No baseline supplied — applies on top of whatever is there, still bumps.
    const updated = await Doc.update(doc.id, { title: 'v3' })
    assert.strictEqual(updated.version, 3)
    assert.strictEqual(updated.title, 'v3')
  })

  it('a save() against a deleted row throws ModelNotFoundError', async () => {
    const created = await Doc.create({ title: 'orig' })
    const stale = await Doc.findOrFail(created.id)
    await Doc.delete(created.id)

    stale.title = 'ghost'
    await assert.rejects(stale.save(), ModelNotFoundError)
  })

  it('supports a custom column name via `static version = "lockVersion"`', async () => {
    const row = await LedgerRow.create({ amount: 100 })
    assert.strictEqual(row.lockVersion, 1)

    const a = await LedgerRow.findOrFail(row.id)
    const b = await LedgerRow.findOrFail(row.id)

    a.amount = 150
    await a.save()
    assert.strictEqual(a.lockVersion, 2)

    b.amount = 200
    await assert.rejects(b.save(), OptimisticLockError)
  })

  it('replicate() + save() starts the clone at version 1', async () => {
    const doc = await Doc.create({ title: 'orig' })
    doc.title = 'bumped'
    await doc.save() // version 2

    const clone = doc.replicate()
    await clone.save()
    assert.notStrictEqual(clone.id, doc.id)
    assert.strictEqual(clone.version, 1)
  })
})
