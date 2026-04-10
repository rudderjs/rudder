import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Sanctum,
  TokenGuard,
  MemoryTokenRepository,
  SanctumMiddleware,
  RequireToken,
  sanctum,
  type PersonalAccessToken,
  type SanctumConfig,
} from './index.js'
import { toAuthenticatable, EloquentUserProvider, type Authenticatable } from '@rudderjs/auth'

// ─── Fixtures ─────────────────────────────────────────────

function fakeUser(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', name: 'John', email: 'john@example.com', password: 'hashed', ...overrides }
}

function fakeModel(users: Record<string, unknown>[]) {
  return {
    find: async (id: string | number) => users.find(u => u['id'] === String(id)) ?? null,
    query: () => {
      const filters: Record<string, unknown> = {}
      const builder = {
        where(col: string, val: unknown) { filters[col] = val; return builder },
        async first() {
          return users.find(u => Object.entries(filters).every(([k, v]) => u[k] === v)) ?? null
        },
      }
      return builder
    },
  }
}

const alwaysTrue = async () => true
function makeSanctum(users: Record<string, unknown>[] = [fakeUser()], config?: SanctumConfig) {
  const model = fakeModel(users)
  const provider = new EloquentUserProvider(model, alwaysTrue)
  const repo = new MemoryTokenRepository()
  return { sanctum: new Sanctum(repo, provider, config), repo, provider }
}

// ─── Sanctum.hashToken / generateToken ────────────────────

describe('Sanctum static', () => {
  it('hashToken produces a 64-char hex string', () => {
    const hash = Sanctum.hashToken('test')
    assert.strictEqual(hash.length, 64)
    assert.ok(/^[a-f0-9]+$/.test(hash))
  })

  it('hashToken is deterministic', () => {
    assert.strictEqual(Sanctum.hashToken('abc'), Sanctum.hashToken('abc'))
  })

  it('generateToken produces a 64-char hex string', () => {
    const token = Sanctum.generateToken()
    assert.strictEqual(token.length, 64)
  })

  it('generateToken produces unique values', () => {
    assert.notStrictEqual(Sanctum.generateToken(), Sanctum.generateToken())
  })
})

// ─── createToken ──────────────────────────────────────────

describe('Sanctum.createToken', () => {
  it('creates a token and returns plainTextToken', async () => {
    const { sanctum } = makeSanctum()
    const result = await sanctum.createToken('1', 'api-key')
    assert.ok(result.plainTextToken.includes('|'))
    assert.ok(result.accessToken.id)
    assert.strictEqual(result.accessToken.userId, '1')
    assert.strictEqual(result.accessToken.name, 'api-key')
  })

  it('plainTextToken format is {id}|{token}', async () => {
    const { sanctum } = makeSanctum()
    const result = await sanctum.createToken('1', 'test')
    const [id, plain] = result.plainTextToken.split('|')
    assert.strictEqual(id, result.accessToken.id)
    assert.ok(plain!.length > 0)
  })

  it('stores hashed token, not plain', async () => {
    const { sanctum } = makeSanctum()
    const result = await sanctum.createToken('1', 'test')
    const plain = result.plainTextToken.split('|')[1]!
    assert.notStrictEqual(result.accessToken.token, plain)
    assert.strictEqual(result.accessToken.token, Sanctum.hashToken(plain))
  })

  it('stores abilities', async () => {
    const { sanctum } = makeSanctum()
    const result = await sanctum.createToken('1', 'test', ['read', 'write'])
    assert.deepStrictEqual(result.accessToken.abilities, ['read', 'write'])
  })

  it('stores expiresAt', async () => {
    const { sanctum } = makeSanctum()
    const exp = new Date(Date.now() + 60_000)
    const result = await sanctum.createToken('1', 'test', undefined, exp)
    assert.strictEqual(result.accessToken.expiresAt?.getTime(), exp.getTime())
  })

  it('respects tokenPrefix', async () => {
    const { sanctum } = makeSanctum([fakeUser()], { tokenPrefix: 'rjs_' })
    const result = await sanctum.createToken('1', 'test')
    assert.ok(result.plainTextToken.startsWith('rjs_'))
  })
})

// ─── validateToken ────────────────────────────────────────

describe('Sanctum.validateToken', () => {
  it('validates a correct token', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test')
    const result = await sanctum.validateToken(`Bearer ${plainTextToken}`)
    assert.ok(result)
    assert.strictEqual(result.user.getAuthIdentifier(), '1')
  })

  it('validates without Bearer prefix', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test')
    const result = await sanctum.validateToken(plainTextToken)
    assert.ok(result)
  })

  it('returns null for invalid token', async () => {
    const { sanctum } = makeSanctum()
    assert.strictEqual(await sanctum.validateToken('Bearer bad|token'), null)
  })

  it('returns null for malformed token (no pipe)', async () => {
    const { sanctum } = makeSanctum()
    assert.strictEqual(await sanctum.validateToken('Bearer nopipe'), null)
  })

  it('returns null for expired token', async () => {
    const { sanctum } = makeSanctum()
    const exp = new Date(Date.now() - 1000)
    const { plainTextToken } = await sanctum.createToken('1', 'test', undefined, exp)
    assert.strictEqual(await sanctum.validateToken(plainTextToken), null)
  })

  it('returns null when user not found', async () => {
    const { sanctum } = makeSanctum([]) // no users
    // Create a token for user '1' who doesn't exist in the model
    const plain = Sanctum.generateToken()
    const hashed = Sanctum.hashToken(plain)
    const repo = (sanctum as unknown as { tokens: MemoryTokenRepository }).tokens
    const token = await repo.create({ userId: '1', name: 'test', token: hashed })
    assert.strictEqual(await sanctum.validateToken(`${token.id}|${plain}`), null)
  })

  it('updates lastUsedAt on valid token', async () => {
    const { sanctum, repo } = makeSanctum()
    const { plainTextToken, accessToken } = await sanctum.createToken('1', 'test')
    assert.strictEqual(accessToken.lastUsedAt, null)

    await sanctum.validateToken(plainTextToken)
    const tokens = await repo.findByUserId('1')
    assert.ok(tokens[0]!.lastUsedAt)
  })

  it('handles tokenPrefix in validation', async () => {
    const { sanctum } = makeSanctum([fakeUser()], { tokenPrefix: 'rjs_' })
    const { plainTextToken } = await sanctum.createToken('1', 'test')
    assert.ok(plainTextToken.startsWith('rjs_'))
    const result = await sanctum.validateToken(`Bearer ${plainTextToken}`)
    assert.ok(result)
  })
})

// ─── tokenCan ─────────────────────────────────────────────

describe('Sanctum.tokenCan', () => {
  it('returns true when abilities is null (all access)', async () => {
    const { sanctum } = makeSanctum()
    const { accessToken } = await sanctum.createToken('1', 'test')
    assert.strictEqual(sanctum.tokenCan(accessToken, 'anything'), true)
  })

  it('returns true when token has the ability', async () => {
    const { sanctum } = makeSanctum()
    const { accessToken } = await sanctum.createToken('1', 'test', ['read', 'write'])
    assert.strictEqual(sanctum.tokenCan(accessToken, 'read'), true)
    assert.strictEqual(sanctum.tokenCan(accessToken, 'write'), true)
  })

  it('returns false when token lacks the ability', async () => {
    const { sanctum } = makeSanctum()
    const { accessToken } = await sanctum.createToken('1', 'test', ['read'])
    assert.strictEqual(sanctum.tokenCan(accessToken, 'delete'), false)
  })

  it('wildcard * grants all abilities', async () => {
    const { sanctum } = makeSanctum()
    const { accessToken } = await sanctum.createToken('1', 'test', ['*'])
    assert.strictEqual(sanctum.tokenCan(accessToken, 'anything'), true)
  })
})

// ─── revokeToken / revokeAllTokens ────────────────────────

describe('Sanctum.revoke', () => {
  it('revokeToken removes a specific token', async () => {
    const { sanctum } = makeSanctum()
    const { accessToken, plainTextToken } = await sanctum.createToken('1', 'test')
    await sanctum.revokeToken(accessToken.id)
    assert.strictEqual(await sanctum.validateToken(plainTextToken), null)
  })

  it('revokeAllTokens removes all tokens for a user', async () => {
    const { sanctum } = makeSanctum()
    const t1 = await sanctum.createToken('1', 'key-1')
    const t2 = await sanctum.createToken('1', 'key-2')
    await sanctum.revokeAllTokens('1')
    assert.strictEqual(await sanctum.validateToken(t1.plainTextToken), null)
    assert.strictEqual(await sanctum.validateToken(t2.plainTextToken), null)
  })

  it('userTokens lists all tokens', async () => {
    const { sanctum } = makeSanctum()
    await sanctum.createToken('1', 'a')
    await sanctum.createToken('1', 'b')
    const tokens = await sanctum.userTokens('1')
    assert.strictEqual(tokens.length, 2)
  })
})

// ─── TokenGuard ───────────────────────────────────────────

describe('TokenGuard', () => {
  it('user() returns authenticated user for valid token', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test')
    const guard = new TokenGuard(sanctum, `Bearer ${plainTextToken}`)
    const user = await guard.user()
    assert.ok(user)
    assert.strictEqual(user.getAuthIdentifier(), '1')
  })

  it('user() returns null for no token', async () => {
    const { sanctum } = makeSanctum()
    const guard = new TokenGuard(sanctum, null)
    assert.strictEqual(await guard.user(), null)
  })

  it('user() returns null for invalid token', async () => {
    const { sanctum } = makeSanctum()
    const guard = new TokenGuard(sanctum, 'Bearer bad|token')
    assert.strictEqual(await guard.user(), null)
  })

  it('check() / guest() reflect auth state', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test')

    const authed = new TokenGuard(sanctum, plainTextToken)
    assert.strictEqual(await authed.check(), true)
    assert.strictEqual(await authed.guest(), false)

    const guest = new TokenGuard(sanctum, null)
    assert.strictEqual(await guest.check(), false)
    assert.strictEqual(await guest.guest(), true)
  })

  it('currentToken() returns the token after user()', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test', ['read'])
    const guard = new TokenGuard(sanctum, plainTextToken)
    await guard.user()
    assert.ok(guard.currentToken())
    assert.deepStrictEqual(guard.currentToken()!.abilities, ['read'])
  })

  it('tokenCan() checks ability', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test', ['read'])
    const guard = new TokenGuard(sanctum, plainTextToken)
    await guard.user()
    assert.strictEqual(guard.tokenCan('read'), true)
    assert.strictEqual(guard.tokenCan('write'), false)
  })

  it('id() returns user id', async () => {
    const { sanctum } = makeSanctum()
    const { plainTextToken } = await sanctum.createToken('1', 'test')
    const guard = new TokenGuard(sanctum, plainTextToken)
    assert.strictEqual(await guard.id(), '1')
  })
})

// ─── MemoryTokenRepository ────────────────────────────────

describe('MemoryTokenRepository', () => {
  it('create + findByToken round-trips', async () => {
    const repo = new MemoryTokenRepository()
    const token = await repo.create({ userId: '1', name: 'test', token: 'abc' })
    const found = await repo.findByToken('abc')
    assert.ok(found)
    assert.strictEqual(found.id, token.id)
  })

  it('findByToken returns null for missing', async () => {
    const repo = new MemoryTokenRepository()
    assert.strictEqual(await repo.findByToken('nope'), null)
  })

  it('findByUserId returns user tokens', async () => {
    const repo = new MemoryTokenRepository()
    await repo.create({ userId: '1', name: 'a', token: 'x' })
    await repo.create({ userId: '1', name: 'b', token: 'y' })
    await repo.create({ userId: '2', name: 'c', token: 'z' })
    assert.strictEqual((await repo.findByUserId('1')).length, 2)
    assert.strictEqual((await repo.findByUserId('2')).length, 1)
  })

  it('delete removes a token', async () => {
    const repo = new MemoryTokenRepository()
    const token = await repo.create({ userId: '1', name: 'test', token: 'abc' })
    await repo.delete(token.id)
    assert.strictEqual(await repo.findByToken('abc'), null)
  })

  it('deleteByUserId removes all user tokens', async () => {
    const repo = new MemoryTokenRepository()
    await repo.create({ userId: '1', name: 'a', token: 'x' })
    await repo.create({ userId: '1', name: 'b', token: 'y' })
    await repo.deleteByUserId('1')
    assert.strictEqual((await repo.findByUserId('1')).length, 0)
  })
})

// ─── Middleware shape ─────────────────────────────────────

describe('SanctumMiddleware()', () => {
  it('returns a function', () => {
    assert.strictEqual(typeof SanctumMiddleware(), 'function')
  })
})

describe('RequireToken()', () => {
  it('returns a function', () => {
    assert.strictEqual(typeof RequireToken(), 'function')
  })

  it('returns a function with abilities', () => {
    assert.strictEqual(typeof RequireToken('read', 'write'), 'function')
  })
})

// ─── sanctum() provider ───────────────────────────────────

describe('sanctum() provider', () => {
  it('is a function that returns a constructor', () => {
    const Provider = sanctum()
    assert.strictEqual(typeof Provider, 'function')
  })

  it('each call returns a different class', () => {
    assert.notStrictEqual(sanctum(), sanctum())
  })
})
