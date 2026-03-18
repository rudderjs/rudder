import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  auth,
  betterAuth,
  AuthMiddleware,
  type BetterAuthConfig,
  type AuthDbConfig,
} from './index.js'

// Note: tests that actually boot the auth provider require better-auth,
// a Prisma client, and a running database. These tests verify factory
// contracts and middleware shape without opening any connections.

const baseConfig: BetterAuthConfig = {
  secret:  'test-secret-that-is-long-enough-32chars',
  baseUrl: 'http://localhost:3000',
}

describe('auth() factory', () => {
  it('is a function', () => {
    assert.strictEqual(typeof auth, 'function')
  })

  it('returns a constructor (ServiceProvider class)', () => {
    const Provider = auth(baseConfig)
    assert.strictEqual(typeof Provider, 'function')
  })

  it('works with minimal config', () => {
    assert.doesNotThrow(() => auth({}))
  })

  it('works with emailAndPassword options', () => {
    assert.doesNotThrow(() => auth({
      emailAndPassword: { enabled: true, requireEmailVerification: false },
    }))
  })

  it('works with socialProviders', () => {
    assert.doesNotThrow(() => auth({
      socialProviders: {
        github: { clientId: 'id', clientSecret: 'secret' },
      },
    }))
  })

  it('works with dbConfig', () => {
    const dbConfig: AuthDbConfig = { driver: 'sqlite', url: 'file:./test.db' }
    assert.doesNotThrow(() => auth(baseConfig, dbConfig))
  })

  it('works with all AuthDbConfig drivers', () => {
    const drivers = ['sqlite', 'postgresql', 'libsql', 'mysql'] as const
    for (const driver of drivers) {
      assert.doesNotThrow(() => auth(baseConfig, { driver, url: 'test://localhost' }))
    }
  })

  it('each call returns a different class', () => {
    const A = auth(baseConfig)
    const B = auth(baseConfig)
    assert.notStrictEqual(A, B)
  })
})

describe('betterAuth (deprecated alias)', () => {
  it('is the same function as auth', () => {
    assert.strictEqual(betterAuth, auth)
  })
})

describe('AuthMiddleware()', () => {
  it('is a function', () => {
    assert.strictEqual(typeof AuthMiddleware, 'function')
  })

  it('returns a MiddlewareHandler function', () => {
    const handler = AuthMiddleware()
    assert.strictEqual(typeof handler, 'function')
  })

  it('each call returns a new handler instance', () => {
    const a = AuthMiddleware()
    const b = AuthMiddleware()
    assert.notStrictEqual(a, b)
  })
})

// ─── Schema files ─────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema')

describe('auth schema files', () => {
  it('ships auth.prisma with all 4 models', () => {
    const file = join(schemaDir, 'auth.prisma')
    assert.ok(existsSync(file), 'auth.prisma should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('model User'), 'should contain User model')
    assert.ok(content.includes('model Session'), 'should contain Session model')
    assert.ok(content.includes('model Account'), 'should contain Account model')
    assert.ok(content.includes('model Verification'), 'should contain Verification model')
  })

  it('ships auth.drizzle.sqlite.ts importing from sqlite-core', () => {
    const file = join(schemaDir, 'auth.drizzle.sqlite.ts')
    assert.ok(existsSync(file), 'auth.drizzle.sqlite.ts should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('drizzle-orm/sqlite-core'), 'should import from sqlite-core')
    assert.ok(content.includes('sqliteTable'), 'should use sqliteTable')
  })

  it('ships auth.drizzle.pg.ts importing from pg-core', () => {
    const file = join(schemaDir, 'auth.drizzle.pg.ts')
    assert.ok(existsSync(file), 'auth.drizzle.pg.ts should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('drizzle-orm/pg-core'), 'should import from pg-core')
    assert.ok(content.includes('pgTable'), 'should use pgTable')
  })

  it('ships auth.drizzle.mysql.ts importing from mysql-core', () => {
    const file = join(schemaDir, 'auth.drizzle.mysql.ts')
    assert.ok(existsSync(file), 'auth.drizzle.mysql.ts should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('drizzle-orm/mysql-core'), 'should import from mysql-core')
    assert.ok(content.includes('mysqlTable'), 'should use mysqlTable')
  })

  it('all drizzle schemas export user, session, account, verification', () => {
    for (const variant of ['sqlite', 'pg', 'mysql']) {
      const file = join(schemaDir, `auth.drizzle.${variant}.ts`)
      const content = readFileSync(file, 'utf8')
      assert.ok(content.includes('export const user'), `${variant}: should export user`)
      assert.ok(content.includes('export const session'), `${variant}: should export session`)
      assert.ok(content.includes('export const account'), `${variant}: should export account`)
      assert.ok(content.includes('export const verification'), `${variant}: should export verification`)
    }
  })
})

// ─── ORM detection in provider ────────────────────────────
// The boot() method can't be tested end-to-end without a real DB.
// Instead we verify the source code handles all three paths:
// 1. Prisma (container.bound('prisma'))
// 2. Drizzle (container.bound('drizzle'))
// 3. Fallback to dbConfig
// 4. Throws when no DB found

describe('auth() ORM detection', () => {
  // Tests run from dist-test/ — resolve source from package root
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const srcPath = join(pkgRoot, 'src', 'index.ts')
  const src = readFileSync(srcPath, 'utf8')

  it('boot() checks for prisma in DI container', () => {
    assert.ok(src.includes("this.app.make('prisma')"), 'should check for prisma binding')
  })

  it('boot() checks for drizzle in DI container', () => {
    assert.ok(src.includes("this.app.make('drizzle')"), 'should check for drizzle binding')
  })

  it('boot() imports prismaAdapter when prisma detected', () => {
    assert.ok(src.includes("import('better-auth/adapters/prisma')"), 'should dynamically import prisma adapter')
  })

  it('boot() imports drizzleAdapter when drizzle detected', () => {
    assert.ok(src.includes("import('better-auth/adapters/drizzle')"), 'should dynamically import drizzle adapter')
  })

  it('boot() throws when no database found and no dbConfig', () => {
    assert.ok(src.includes('No database found'), 'should throw descriptive error')
  })

  it('boot() falls back to createPrismaClient when dbConfig provided', () => {
    assert.ok(src.includes('createPrismaClient(dbConfig)'), 'should fall back to explicit dbConfig')
  })
})
