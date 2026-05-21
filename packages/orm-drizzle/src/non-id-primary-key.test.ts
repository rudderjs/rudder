import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// A table whose primary key is `uuid`, not `id` — exercises per-query
// `primaryKey` threading from `Model.primaryKey` through the adapter.
const things = sqliteTable('things', {
  uuid:      text('uuid').primaryKey(),
  name:      text('name').notNull(),
  viewCount: integer('view_count').notNull().default(0),
})

type Thing = { uuid: string; name: string; viewCount: number }

async function makeAdapter(adapterPrimaryKey: string): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE things (
      uuid       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0
    );
  `)
  const db  = drizzleSqlite(sqlite)
  // Set the adapter-global primaryKey to something else so we can prove that
  // the per-query override beats it. Without override the queries would
  // target the wrong column and SQLite would either fail loudly or no-op.
  const cfg: DrizzleConfig = { client: db, tables: { things }, primaryKey: adapterPrimaryKey }
  return drizzle(cfg).create() as Promise<DrizzleAdapter>
}

describe('DrizzleAdapter — per-query primaryKey override', () => {
  let adapter: DrizzleAdapter

  beforeEach(async () => {
    adapter = await makeAdapter(/* adapter-global wrong on purpose */ 'id')
    const qb = adapter.query<Thing>('things', { primaryKey: 'uuid' })
    await qb.create({ uuid: 'u-1', name: 'alpha' })
    await qb.create({ uuid: 'u-2', name: 'beta'  })
    await qb.create({ uuid: 'u-3', name: 'gamma' })
  })

  it('find() reads by the per-query primaryKey ("uuid"), not the adapter-global ("id")', async () => {
    const row = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).find('u-2')
    assert.ok(row, 'find("u-2") should return the row')
    assert.equal(row.name, 'beta')
  })

  it('find() returns null when the uuid does not match (even though name is unique)', async () => {
    const row = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).find('no-such-uuid')
    assert.equal(row, null)
  })

  it('update() writes by the per-query primaryKey', async () => {
    await adapter.query<Thing>('things', { primaryKey: 'uuid' }).update('u-1', { name: 'alpha-edited' })
    const row = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).find('u-1')
    assert.equal(row?.name, 'alpha-edited')
    // Other rows untouched
    const other = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).find('u-2')
    assert.equal(other?.name, 'beta')
  })

  it('delete() removes by the per-query primaryKey', async () => {
    await adapter.query<Thing>('things', { primaryKey: 'uuid' }).delete('u-2')
    const remaining = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).get()
    assert.deepEqual(remaining.map(r => r.uuid).sort(), ['u-1', 'u-3'])
  })

  it('increment() targets the row matched by the per-query primaryKey', async () => {
    await adapter.query<Thing>('things', { primaryKey: 'uuid' }).increment('u-3', 'viewCount', 5)
    const row = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).find('u-3')
    assert.equal(row?.viewCount, 5)
    // Other rows untouched
    const u1 = await adapter.query<Thing>('things', { primaryKey: 'uuid' }).find('u-1')
    assert.equal(u1?.viewCount, 0)
  })
})

describe('DrizzleAdapter — primaryKey fallback chain', () => {
  it('falls back to the adapter-global primaryKey when per-query opts are omitted', async () => {
    // The adapter-global is "uuid", and we don't pass opts → the QB uses "uuid".
    const adapter = await makeAdapter('uuid')
    const qb = adapter.query<Thing>('things') // no opts
    await qb.create({ uuid: 'u-9', name: 'omega' })

    const row = await adapter.query<Thing>('things').find('u-9')
    assert.equal(row?.name, 'omega')
  })

  it('the adapter-global "id" still works for the historical id-PK use case', async () => {
    // Sanity: this duplicates the existing integration coverage but is the
    // base-case the regression should not regress.
    const adapter = await makeAdapter('id')
    // We'd need an id-PK table for this to be end-to-end meaningful; the
    // assertion is just that the adapter constructs and queries without
    // erroring when no opts are passed (back-compat).
    assert.doesNotThrow(() => adapter.query<Thing>('things'))
  })
})
