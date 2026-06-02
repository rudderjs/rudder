// Raw-expression methods on the Prisma adapter.
//
// Prisma's structured client can't splice arbitrary raw SQL fragments into a
// `findMany` projection / where / orderBy. Rather than silently dropping them,
// every raw method throws and points at the `DB` facade (which runs raw SQL via
// `$queryRawUnsafe`). These tests pin that contract — no DB connection needed,
// the throw is synchronous at the QB layer.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import { raw } from '@rudderjs/contracts'

function makeClient() {
  const delegate = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, create: async () => ({}), createMany: async () => ({ count: 0 }),
    update: async () => ({}), updateMany: async () => ({ count: 0 }),
    delete: async () => undefined, deleteMany: async () => ({ count: 0 }),
  }
  return { user: delegate, $connect: async () => {}, $disconnect: async () => {} }
}

async function qb() {
  const adapter = await prisma({ client: makeClient() }).create()
  return adapter.query('user')
}

describe('Prisma adapter — raw expressions throw with a DB-facade pointer', () => {
  it('selectRaw throws', async () => {
    const q = await qb()
    assert.throws(() => q.selectRaw('count(*) as total'), /selectRaw\(\) is not supported.*DB\.select/s)
  })

  it('whereRaw throws', async () => {
    const q = await qb()
    assert.throws(() => q.whereRaw('age > ?', [18]), /whereRaw\(\) is not supported.*DB\.select/s)
  })

  it('orWhereRaw throws', async () => {
    const q = await qb()
    assert.throws(() => q.orWhereRaw('age > ?', [18]), /orWhereRaw\(\) is not supported/)
  })

  it('orderByRaw throws', async () => {
    const q = await qb()
    assert.throws(() => q.orderByRaw('age desc'), /orderByRaw\(\) is not supported/)
  })

  it('orderBy(raw(...)) throws', async () => {
    const q = await qb()
    assert.throws(() => q.orderBy(raw('age desc')), /orderBy\(raw\(\.\.\.\)\) is not supported/)
  })

  it('structured orderBy still works (string column)', async () => {
    const q = await qb()
    assert.doesNotThrow(() => q.orderBy('age', 'DESC'))
  })

  it('whereColumn throws with a DB-facade pointer', async () => {
    const q = await qb() as unknown as { whereColumn(a: string, b: string): unknown }
    assert.throws(() => q.whereColumn('balance', 'overdraft'), /whereColumn\(\) is not supported.*DB\.select/s)
  })

  it('orWhereColumn throws', async () => {
    const q = await qb() as unknown as { orWhereColumn(a: string, b: string): unknown }
    assert.throws(() => q.orWhereColumn('balance', 'overdraft'), /orWhereColumn\(\) is not supported/)
  })

  it('has() count comparison throws with a pointer', async () => {
    const q = await qb()
    const base = { relation: 'posts', exists: true, relatedTable: 'post', parentColumn: 'id', relatedColumn: 'userId', constraintWheres: [] }
    assert.throws(() => q.whereRelationExists({ ...base, count: { operator: '>=', value: 3 } }), /count comparison is not supported/)
  })

  it('orWhereHas (OR-rooted existence) throws', async () => {
    const q = await qb()
    const base = { relation: 'posts', exists: true, relatedTable: 'post', parentColumn: 'id', relatedColumn: 'userId', constraintWheres: [] }
    assert.throws(() => q.whereRelationExists({ ...base, boolean: 'OR' }), /OR-rooted relation existence\) is not supported/)
  })
})
