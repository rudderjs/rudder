// OrmTokenRepository — end-to-end on the NATIVE engine (real better-sqlite3).
//
// Proves the durable store round-trips through the same `TokenRepository`
// contract `MemoryTokenRepository` satisfies, that `abilities` keeps the
// null / [] / [...] distinction across the JSON text column, that dates
// rehydrate as `Date` instances, and that a full `Sanctum` issue → validate →
// revoke cycle works against the persisted rows.

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Model, ModelRegistry } from '@rudderjs/orm'
import { NativeAdapter, BetterSqlite3Driver, type Driver } from '@rudderjs/database/native'

import { OrmTokenRepository, PersonalAccessTokenModel } from './orm.js'
import { Sanctum } from './index.js'
import { EloquentUserProvider } from '@rudderjs/auth'

// ─── Fixtures ─────────────────────────────────────────────

let driver: Driver

const CREATE_TABLE = `
  CREATE TABLE personal_access_tokens (
    id          TEXT PRIMARY KEY,
    userId      TEXT NOT NULL,
    name        TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    abilities   TEXT,
    lastUsedAt  TEXT,
    expiresAt   TEXT,
    createdAt   TEXT
  )
`

before(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(CREATE_TABLE, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

after(async () => {
  await driver.close()
})

beforeEach(async () => {
  // Clean slate per test — bulk delete every row.
  await driver.execute('DELETE FROM personal_access_tokens', [])
})

// ─── TokenRepository contract ─────────────────────────────

describe('OrmTokenRepository', () => {
  it('create stamps a ULID id, persists fields, and defaults lastUsedAt to null', async () => {
    const repo = new OrmTokenRepository()
    const token = await repo.create({ userId: '1', name: 'api-key', token: 'hash-1' })

    assert.ok(token.id.length > 0, 'id should be generated')
    assert.strictEqual(token.userId, '1')
    assert.strictEqual(token.name, 'api-key')
    assert.strictEqual(token.token, 'hash-1')
    assert.strictEqual(token.lastUsedAt, null)
    assert.strictEqual(token.expiresAt, null)
    assert.ok(token.createdAt instanceof Date)
  })

  it('create + findByToken round-trips', async () => {
    const repo = new OrmTokenRepository()
    const created = await repo.create({ userId: '1', name: 'test', token: 'hash-2' })
    const found = await repo.findByToken('hash-2')
    assert.ok(found)
    assert.strictEqual(found.id, created.id)
    assert.strictEqual(found.userId, '1')
  })

  it('findByToken returns null for a missing hash', async () => {
    const repo = new OrmTokenRepository()
    assert.strictEqual(await repo.findByToken('nope'), null)
  })

  it('preserves the null / [] / [...] abilities distinction', async () => {
    const repo = new OrmTokenRepository()
    await repo.create({ userId: '1', name: 'all',  token: 'h-null', abilities: null })
    await repo.create({ userId: '1', name: 'none', token: 'h-empty', abilities: [] })
    await repo.create({ userId: '1', name: 'some', token: 'h-list', abilities: ['read', 'write'] })

    assert.strictEqual((await repo.findByToken('h-null'))!.abilities, null)
    assert.deepStrictEqual((await repo.findByToken('h-empty'))!.abilities, [])
    assert.deepStrictEqual((await repo.findByToken('h-list'))!.abilities, ['read', 'write'])
  })

  it('rehydrates expiresAt as a Date', async () => {
    const repo = new OrmTokenRepository()
    const exp = new Date(Date.now() + 60_000)
    await repo.create({ userId: '1', name: 'exp', token: 'h-exp', expiresAt: exp })
    const found = await repo.findByToken('h-exp')
    assert.ok(found!.expiresAt instanceof Date)
    assert.strictEqual(found!.expiresAt!.getTime(), exp.getTime())
  })

  it('findByUserId scopes by user', async () => {
    const repo = new OrmTokenRepository()
    await repo.create({ userId: '1', name: 'a', token: 'h-a' })
    await repo.create({ userId: '1', name: 'b', token: 'h-b' })
    await repo.create({ userId: '2', name: 'c', token: 'h-c' })
    assert.strictEqual((await repo.findByUserId('1')).length, 2)
    assert.strictEqual((await repo.findByUserId('2')).length, 1)
  })

  it('updateLastUsed writes the timestamp', async () => {
    const repo = new OrmTokenRepository()
    const token = await repo.create({ userId: '1', name: 'test', token: 'h-used' })
    assert.strictEqual(token.lastUsedAt, null)

    const when = new Date()
    await repo.updateLastUsed(token.id, when)
    const found = await repo.findByToken('h-used')
    assert.ok(found!.lastUsedAt instanceof Date)
    assert.strictEqual(found!.lastUsedAt!.getTime(), when.getTime())
  })

  it('delete removes a single token', async () => {
    const repo = new OrmTokenRepository()
    const token = await repo.create({ userId: '1', name: 'test', token: 'h-del' })
    await repo.delete(token.id)
    assert.strictEqual(await repo.findByToken('h-del'), null)
  })

  it('deleteByUserId removes all of a user\'s tokens', async () => {
    const repo = new OrmTokenRepository()
    await repo.create({ userId: '1', name: 'a', token: 'h-1' })
    await repo.create({ userId: '1', name: 'b', token: 'h-2' })
    await repo.create({ userId: '2', name: 'c', token: 'h-3' })
    await repo.deleteByUserId('1')
    assert.strictEqual((await repo.findByUserId('1')).length, 0)
    assert.strictEqual((await repo.findByUserId('2')).length, 1)
  })
})

// ─── Sanctum end-to-end against the durable store ─────────

describe('Sanctum + OrmTokenRepository', () => {
  function fakeModel(users: Record<string, unknown>[]) {
    return {
      find: async (id: string | number) => users.find((u) => u['id'] === String(id)) ?? null,
      query: () => {
        const filters: Record<string, unknown> = {}
        const builder = {
          where(col: string, val: unknown) { filters[col] = val; return builder },
          async first() {
            return users.find((u) => Object.entries(filters).every(([k, v]) => u[k] === v)) ?? null
          },
        }
        return builder
      },
    }
  }

  function makeSanctum() {
    const provider = new EloquentUserProvider(
      fakeModel([{ id: '1', name: 'John', email: 'john@example.com', password: 'hashed' }]),
      async () => true,
    )
    return new Sanctum(new OrmTokenRepository(), provider)
  }

  it('issues a token that then validates against the persisted row', async () => {
    const sanctum = makeSanctum()
    const { plainTextToken, accessToken } = await sanctum.createToken('1', 'cli', ['read'])

    // Stored value is the hash, not the plain text.
    assert.notStrictEqual(accessToken.token, plainTextToken)
    assert.strictEqual(accessToken.token, Sanctum.hashToken(plainTextToken.split('|')[1]!))

    const result = await sanctum.validateToken(`Bearer ${plainTextToken}`)
    assert.ok(result)
    assert.strictEqual(result.user.getAuthIdentifier(), '1')
    assert.deepStrictEqual(result.token.abilities, ['read'])
  })

  it('validation stamps lastUsedAt on the persisted row', async () => {
    const sanctum = makeSanctum()
    const { plainTextToken, accessToken } = await sanctum.createToken('1', 'cli')
    assert.strictEqual(accessToken.lastUsedAt, null)

    await sanctum.validateToken(plainTextToken)
    const tokens = await sanctum.userTokens('1')
    assert.ok(tokens[0]!.lastUsedAt instanceof Date)
  })

  it('revokeToken invalidates a persisted token', async () => {
    const sanctum = makeSanctum()
    const { plainTextToken, accessToken } = await sanctum.createToken('1', 'cli')
    await sanctum.revokeToken(accessToken.id)
    assert.strictEqual(await sanctum.validateToken(plainTextToken), null)
  })

  it('rejects an expired persisted token', async () => {
    const sanctum = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'cli', undefined, new Date(Date.now() - 1000))
    assert.strictEqual(await sanctum.validateToken(plainTextToken), null)
  })
})

// ─── Model registration sanity ────────────────────────────

describe('PersonalAccessTokenModel', () => {
  it('is a Model subclass mapped to personal_access_tokens with a ULID key', () => {
    assert.ok(PersonalAccessTokenModel.prototype instanceof Model)
    assert.strictEqual(PersonalAccessTokenModel.table, 'personal_access_tokens')
    assert.strictEqual(PersonalAccessTokenModel.keyType, 'ulid')
  })
})
