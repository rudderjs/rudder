import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'

// `static keyType = 'uuid' | 'ulid'` stamps an application-generated primary
// key on create/save when the key is unset — the Model layer does it before the
// insert, so every adapter gets it for free (no contract/adapter change).

function makeQb<T>(captured: Record<string, unknown>[]): QueryBuilder<T> {
  const qb = {
    where:        () => qb,
    orWhere:      () => qb,
    orderBy:      () => qb,
    limit:        () => qb,
    offset:       () => qb,
    with:         () => qb,
    first:        async () => null,
    find:         async () => null,
    get:          async () => [],
    all:          async () => [],
    count:        async () => 0,
    create:       async (data: Record<string, unknown>) => { captured.push(data); return data },
    update:       async (_id: unknown, data: unknown) => data,
    delete:       async () => undefined,
    insertMany:   async () => undefined,
    paginate:     async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 1, from: 0, to: 0 }),
    deleteAll:    async () => 0,
    updateAll:    async () => 0,
    restore:      async (id: unknown) => ({ id }),
    forceDelete:  async () => undefined,
    _aggregate:   async () => null,
  } as unknown as QueryBuilder<T>
  return qb
}

function makeAdapter(captured: Record<string, unknown>[]): OrmAdapter {
  return {
    query:      <T>(): QueryBuilder<T> => makeQb<T>(captured),
    connect:    async () => undefined,
    disconnect: async () => undefined,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

describe('Model keyType — application-generated primary keys', () => {
  let captured: Record<string, unknown>[]
  beforeEach(() => {
    captured = []
    ModelRegistry.reset()
    ModelRegistry.set(makeAdapter(captured))
  })

  it('defaults to int and never stamps a key', async () => {
    class Widget extends Model { static override table = 'widgets' }
    await Widget.create({ name: 'a' } as Partial<Widget>)
    assert.equal(captured[0]!['id'], undefined)
    assert.equal(captured[0]!['name'], 'a')
  })

  it('keyType = "uuid" stamps a v4 UUID on create when the PK is unset', async () => {
    class Token extends Model { static override table = 'tokens'; static override keyType = 'uuid' as const }
    const t = await Token.create({ name: 'ci' } as Partial<Token>)
    const id = captured[0]!['id'] as string
    assert.match(id, UUID_RE)
    assert.equal((t as unknown as Record<string, unknown>)['id'], id, 'returned instance carries the generated key')
  })

  it('keyType = "ulid" stamps a 26-char Crockford ULID', async () => {
    class Session extends Model { static override table = 'sessions'; static override keyType = 'ulid' as const }
    await Session.create({ name: 'x' } as Partial<Session>)
    assert.match(captured[0]!['id'] as string, ULID_RE)
  })

  it('does not overwrite a caller-supplied key', async () => {
    class Token extends Model { static override table = 'tokens'; static override keyType = 'uuid' as const }
    await Token.create({ id: 'fixed-key', name: 'ci' } as Partial<Token>)
    assert.equal(captured[0]!['id'], 'fixed-key')
  })

  it('respects a custom primaryKey column name', async () => {
    class Doc extends Model {
      static override table = 'docs'
      static override primaryKey = 'uuid'
      static override keyType = 'uuid' as const
    }
    await Doc.create({ title: 'spec' } as Partial<Doc>)
    assert.match(captured[0]!['uuid'] as string, UUID_RE)
    assert.equal(captured[0]!['id'], undefined)
  })

  it('save() on a new instance stamps the key too', async () => {
    class Token extends Model { static override table = 'tokens'; static override keyType = 'ulid' as const }
    const t = new Token()
    ;(t as unknown as Record<string, unknown>)['name'] = 'via-save'
    await t.save()
    assert.match(captured[0]!['id'] as string, ULID_RE)
  })

  it('ULIDs are lexicographically increasing over time (timestamp prefix)', async () => {
    class S extends Model { static override table = 's'; static override keyType = 'ulid' as const }
    await S.create({} as Partial<S>)
    await new Promise((r) => setTimeout(r, 3))
    await S.create({} as Partial<S>)
    const first  = captured[0]!['id'] as string
    const second = captured[1]!['id'] as string
    assert.ok(second > first, `${second} should sort after ${first}`)
  })
})
