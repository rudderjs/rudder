import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import nodePath from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  detectORM, buildArgs, assertSafeName, findSeederFile, hasPrismaSeedConfig, runSeeder,
  buildVectorMigrationSql, buildPrismaSchemaSnippet, parseVectorFlag,
  writeVectorMigration, runNativeMigrate, runNativeStatus,
  runNativeRollback, runNativeRefresh, runNativeFresh,
  buildNativeMigrationStub, writeNativeMigration,
} from './migrate.js'
import { NativeAdapter } from '../native/adapter.js'
import { BetterSqlite3Driver } from '../native/drivers/better-sqlite3.js'
import type { Driver } from '../native/driver.js'

describe('migrate — detectORM()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-migrate-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns "prisma" when @rudderjs/orm-prisma is in dependencies', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-prisma': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'prisma')
  })

  it('returns "drizzle" when @rudderjs/orm-drizzle is in dependencies', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-drizzle': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'drizzle')
  })

  it('returns "prisma" when @rudderjs/orm-prisma is in devDependencies', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { '@rudderjs/orm-prisma': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'prisma')
  })

  it('returns null when neither ORM is present', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'express': '4.0.0' },
    }))
    assert.equal(detectORM(tmpDir), null)
  })

  it('returns null when package.json does not exist', () => {
    assert.equal(detectORM(nodePath.join(tmpDir, 'nonexistent')), null)
  })

  it('prefers prisma when both ORMs are listed', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-prisma': 'latest', '@rudderjs/orm-drizzle': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'prisma')
  })
})

describe('migrate — buildArgs()', () => {
  // ── Prisma ──────────────────────────────────────────────

  it('prisma migrate (dev)', () => {
    const args = buildArgs('prisma', 'migrate', { env: 'development' })
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'dev'])
  })

  it('prisma migrate (production)', () => {
    const args = buildArgs('prisma', 'migrate', { env: 'production' })
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'deploy'])
  })

  it('prisma migrate:fresh', () => {
    const args = buildArgs('prisma', 'migrate:fresh')
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'reset', '--force'])
  })

  it('prisma migrate:status', () => {
    const args = buildArgs('prisma', 'migrate:status')
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'status'])
  })

  it('prisma make:migration with name', () => {
    const args = buildArgs('prisma', 'make:migration', { name: 'add-users' })
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'dev', '--create-only', '--name', 'add-users'])
  })

  it('prisma make:migration uses default name', () => {
    const args = buildArgs('prisma', 'make:migration')
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'dev', '--create-only', '--name', 'migration'])
  })

  it('prisma db:push', () => {
    const args = buildArgs('prisma', 'db:push')
    assert.deepEqual(args, ['exec', 'prisma', 'db', 'push'])
  })

  it('prisma db:generate', () => {
    const args = buildArgs('prisma', 'db:generate')
    assert.deepEqual(args, ['exec', 'prisma', 'generate'])
  })

  // ── Drizzle ─────────────────────────────────────────────

  it('drizzle migrate', () => {
    const args = buildArgs('drizzle', 'migrate')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'migrate'])
  })

  it('drizzle migrate:fresh', () => {
    const args = buildArgs('drizzle', 'migrate:fresh')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'migrate', '--force'])
  })

  it('drizzle migrate:status', () => {
    const args = buildArgs('drizzle', 'migrate:status')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'check'])
  })

  it('drizzle make:migration with name', () => {
    const args = buildArgs('drizzle', 'make:migration', { name: 'add-posts' })
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'generate', '--name', 'add-posts'])
  })

  // ── make:migration name validation (shell-injection guard) ──

  it('rejects a make:migration name with shell metacharacters (prisma)', () => {
    assert.throws(
      () => buildArgs('prisma', 'make:migration', { name: 'x; rm -rf .' }),
      /Invalid migration name/,
    )
  })

  it('rejects a make:migration name with shell metacharacters (drizzle)', () => {
    assert.throws(
      () => buildArgs('drizzle', 'make:migration', { name: '$(whoami)' }),
      /Invalid migration name/,
    )
  })

  it('assertSafeName accepts identifier-style names, rejects metacharacters', () => {
    for (const ok of ['add-users', 'add_users', 'AddUsers', 'v1.2.0', 'migration']) {
      assert.equal(assertSafeName(ok), ok)
    }
    for (const bad of ['x; rm -rf .', '$(whoami)', 'a b', 'a`b`', 'a|b', 'a&b', '']) {
      assert.throws(() => assertSafeName(bad), /Invalid migration name/)
    }
  })

  it('drizzle db:push', () => {
    const args = buildArgs('drizzle', 'db:push')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'push'])
  })

  it('drizzle db:generate returns empty (no-op)', () => {
    const args = buildArgs('drizzle', 'db:generate')
    assert.deepEqual(args, [])
  })
})

describe('migrate — findSeederFile()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-seeder-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns null when no seeder file exists', () => {
    assert.equal(findSeederFile(tmpDir), null)
  })

  it('finds DatabaseSeeder.ts', async () => {
    await fs.mkdir(nodePath.join(tmpDir, 'database/seeders'), { recursive: true })
    const path = nodePath.join(tmpDir, 'database/seeders/DatabaseSeeder.ts')
    await fs.writeFile(path, 'export default class {}')
    assert.equal(findSeederFile(tmpDir), path)
  })

  it('finds DatabaseSeeder.js when .ts is absent', async () => {
    await fs.mkdir(nodePath.join(tmpDir, 'database/seeders'), { recursive: true })
    const path = nodePath.join(tmpDir, 'database/seeders/DatabaseSeeder.js')
    await fs.writeFile(path, 'export default class {}')
    assert.equal(findSeederFile(tmpDir), path)
  })
})

describe('migrate — hasPrismaSeedConfig()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-seedcfg-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns true when package.json#prisma.seed is set', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      prisma: { seed: 'tsx prisma/seed.ts' },
    }))
    assert.equal(hasPrismaSeedConfig(tmpDir), true)
  })

  it('returns false when package.json has no prisma.seed', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: {},
    }))
    assert.equal(hasPrismaSeedConfig(tmpDir), false)
  })

  it('returns false when package.json is missing', () => {
    assert.equal(hasPrismaSeedConfig(nodePath.join(tmpDir, 'nope')), false)
  })
})

describe('migrate — runSeeder()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-runseed-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('throws a clear error when no seeder + no prisma config', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({}))
    await assert.rejects(() => runSeeder(tmpDir), /No seeder found/)
  })

  it('invokes a function-based seeder default export', async () => {
    await fs.mkdir(nodePath.join(tmpDir, 'database/seeders'), { recursive: true })
    const path = nodePath.join(tmpDir, 'database/seeders/DatabaseSeeder.mjs')
    const sentinel = nodePath.join(tmpDir, '__ran__')
    await fs.writeFile(path, `import { writeFile } from 'node:fs/promises'
export default async function () { await writeFile(${JSON.stringify(sentinel)}, 'ok') }
`)
    await runSeeder(tmpDir)
    const contents = await fs.readFile(sentinel, 'utf8')
    assert.equal(contents, 'ok')
  })

  it('invokes a class-based seeder default export', async () => {
    await fs.mkdir(nodePath.join(tmpDir, 'database/seeders'), { recursive: true })
    const path = nodePath.join(tmpDir, 'database/seeders/DatabaseSeeder.mjs')
    const sentinel = nodePath.join(tmpDir, '__ran__')
    await fs.writeFile(path, `import { writeFile } from 'node:fs/promises'
export default class DatabaseSeeder {
  async run () { await writeFile(${JSON.stringify(sentinel)}, 'class') }
}
`)
    await runSeeder(tmpDir)
    const contents = await fs.readFile(sentinel, 'utf8')
    assert.equal(contents, 'class')
  })

  it('throws when default export is not a class or function', async () => {
    await fs.mkdir(nodePath.join(tmpDir, 'database/seeders'), { recursive: true })
    const path = nodePath.join(tmpDir, 'database/seeders/DatabaseSeeder.mjs')
    await fs.writeFile(path, 'export default { not: "callable" }\n')
    await assert.rejects(() => runSeeder(tmpDir), /must be a Seeder class or function/)
  })
})

// ─── #B7 Phase 3 — make:migration --vector helper ─────────

describe('migrate — buildVectorMigrationSql()', () => {
  it('emits CREATE EXTENSION + ALTER TABLE + HNSW INDEX in cosine mode (default)', () => {
    const sql = buildVectorMigrationSql({ table: 'documents', column: 'embedding', dimensions: 1536 })
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector;/)
    assert.match(sql, /ALTER TABLE "documents" ADD COLUMN "embedding" vector\(1536\);/)
    assert.match(sql, /CREATE INDEX "documents_embedding_hnsw_idx" ON "documents" USING hnsw \("embedding" vector_cosine_ops\);/)
  })

  it('switches the index ops class for metric: l2', () => {
    const sql = buildVectorMigrationSql({ table: 'docs', column: 'emb', dimensions: 8, metric: 'l2' })
    assert.match(sql, /vector_l2_ops/)
    assert.doesNotMatch(sql, /vector_cosine_ops/)
  })

  it('switches the index ops class for metric: inner-product', () => {
    const sql = buildVectorMigrationSql({ table: 'docs', column: 'emb', dimensions: 8, metric: 'inner-product' })
    assert.match(sql, /vector_ip_ops/)
  })

  it('rejects invalid table identifiers (defense against arg injection)', () => {
    assert.throws(
      () => buildVectorMigrationSql({ table: 'docs"; DROP TABLE x; --', column: 'embedding', dimensions: 1 }),
      /invalid table name/i,
    )
  })

  it('rejects invalid column identifiers', () => {
    assert.throws(
      () => buildVectorMigrationSql({ table: 'docs', column: '1bad', dimensions: 1 }),
      /invalid column name/i,
    )
  })

  it('rejects non-positive or non-integer dimensions', () => {
    assert.throws(() => buildVectorMigrationSql({ table: 'd', column: 'e', dimensions: 0 }),    /positive integer/)
    assert.throws(() => buildVectorMigrationSql({ table: 'd', column: 'e', dimensions: -1 }),   /positive integer/)
    assert.throws(() => buildVectorMigrationSql({ table: 'd', column: 'e', dimensions: 1.5 }),  /positive integer/)
  })
})

describe('migrate — buildPrismaSchemaSnippet()', () => {
  it('includes the Unsupported(...) column declaration', () => {
    const snippet = buildPrismaSchemaSnippet({ table: 'documents', column: 'embedding', dimensions: 1536 })
    assert.match(snippet, /embedding\s+Unsupported\("vector\(1536\)"\)\?/)
  })

  it('uses VectorCosineOps in cosine mode (default)', () => {
    const snippet = buildPrismaSchemaSnippet({ table: 'documents', column: 'embedding', dimensions: 1536 })
    assert.match(snippet, /VectorCosineOps/)
  })

  it('uses VectorL2Ops for metric: l2', () => {
    const snippet = buildPrismaSchemaSnippet({ table: 'd', column: 'e', dimensions: 8, metric: 'l2' })
    assert.match(snippet, /VectorL2Ops/)
  })
})

describe('migrate — parseVectorFlag()', () => {
  it('returns null when --vector is absent', () => {
    assert.equal(parseVectorFlag(['add_users_table']),         null)
    assert.equal(parseVectorFlag([]),                          null)
  })

  it('parses positional <table> <column> <dimensions>', () => {
    const r = parseVectorFlag(['--vector', 'documents', 'embedding', '1536'])
    assert.deepEqual(r, { table: 'documents', column: 'embedding', dimensions: 1536 })
  })

  it('also picks up an optional --metric flag', () => {
    const r = parseVectorFlag(['--vector', 'd', 'e', '8', '--metric', 'l2'])
    assert.deepEqual(r, { table: 'd', column: 'e', dimensions: 8, metric: 'l2' })
  })

  it('throws when positional args are missing', () => {
    assert.throws(() => parseVectorFlag(['--vector', 'docs']),                       /requires/)
    assert.throws(() => parseVectorFlag(['--vector', 'docs', 'embedding']),          /requires/)
  })

  it('throws on non-integer dimensions', () => {
    assert.throws(() => parseVectorFlag(['--vector', 'd', 'e', 'oops']),             /positive integer/)
    assert.throws(() => parseVectorFlag(['--vector', 'd', 'e', '0']),                /positive integer/)
  })

  it('throws on unknown --metric value', () => {
    assert.throws(() => parseVectorFlag(['--vector', 'd', 'e', '8', '--metric', 'cosmos']), /cosine\|l2\|inner-product/)
  })
})

describe('migrate — writeVectorMigration()', () => {
  let tmpDir: string
  const fixedNow = new Date('2026-05-11T12:34:56Z')

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-vec-migrate-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes a Prisma migration to prisma/migrations/<ts>_<slug>/migration.sql when ORM is prisma', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-prisma': 'latest' },
    }))
    const result = await writeVectorMigration({ table: 'documents', column: 'embedding', dimensions: 1536 }, tmpDir, fixedNow)

    assert.match(result.filePath.replace(/\\/g, '/'), /prisma\/migrations\/20260511123456_add_embedding_vector_to_documents\/migration\.sql$/)
    const written = await fs.readFile(result.filePath, 'utf8')
    assert.match(written, /CREATE EXTENSION IF NOT EXISTS vector;/)
    assert.match(written, /vector_cosine_ops/)
  })

  it('writes a Drizzle migration to drizzle/<ts>_<slug>.sql when ORM is drizzle', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-drizzle': 'latest' },
    }))
    const result = await writeVectorMigration({ table: 'documents', column: 'embedding', dimensions: 768 }, tmpDir, fixedNow)

    assert.match(result.filePath.replace(/\\/g, '/'), /drizzle\/20260511123456_add_embedding_vector_to_documents\.sql$/)
  })

  it('falls back to drizzle layout when no ORM is detected', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({}))
    const result = await writeVectorMigration({ table: 'd', column: 'e', dimensions: 8 }, tmpDir, fixedNow)
    assert.match(result.filePath.replace(/\\/g, '/'), /drizzle\//)
  })

  it('returns the Prisma schema snippet only for Prisma projects', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-prisma': 'latest' },
    }))
    const r1 = await writeVectorMigration({ table: 'd', column: 'e', dimensions: 8 }, tmpDir, fixedNow)
    assert.ok(r1.prismaSchemaSnippet)
    assert.match(r1.prismaSchemaSnippet!, /Unsupported\("vector\(8\)"\)/)

    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-drizzle': 'latest' },
    }))
    const r2 = await writeVectorMigration({ table: 'd', column: 'e', dimensions: 8 }, tmpDir, fixedNow)
    assert.equal(r2.prismaSchemaSnippet, undefined)
  })

  it('honors explicit opts.orm even when package.json suggests something else', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-drizzle': 'latest' },
    }))
    const result = await writeVectorMigration({ table: 'd', column: 'e', dimensions: 8, orm: 'prisma' }, tmpDir, fixedNow)
    assert.match(result.filePath.replace(/\\/g, '/'), /prisma\/migrations\//)
    assert.ok(result.prismaSchemaSnippet)
  })
})

// ── Native engine command layer (7.2) ────────────────────
// Exercises runNativeMigrate / runNativeStatus end-to-end: a temp project
// `database/migrations/` of `.mjs` files driven against an in-memory adapter.
// (The CLI handler's boot + adapter-detection glue is the only uncovered bit.)

describe('migrate — native command layer', () => {
  const nativeIndex = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../native/index.js')
  const importBase = pathToFileURL(nativeIndex).href

  const migration = (table: string) =>
    `import { Migration, Schema } from ${JSON.stringify(importBase)}\n` +
    `export default class extends Migration {\n` +
    `  async up()   { await Schema.create(${JSON.stringify(table)}, (t) => { t.id(); t.string('name') }) }\n` +
    `  async down() { await Schema.dropIfExists(${JSON.stringify(table)}) }\n` +
    `}\n`

  let cwd: string
  let driver: Driver
  let adapter: NativeAdapter
  // Silence the commands' progress logging during the test.
  const realLog = console.log

  beforeEach(async () => {
    cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-native-mig-'))
    await fs.mkdir(nodePath.join(cwd, 'database', 'migrations'), { recursive: true })
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver })
    console.log = () => {}
  })
  afterEach(async () => {
    console.log = realLog
    await driver.close()
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('runNativeMigrate applies files from database/migrations and returns the count', async () => {
    await fs.writeFile(nodePath.join(cwd, 'database', 'migrations', '2026_01_01_000000_create_users.mjs'), migration('users'))
    await fs.writeFile(nodePath.join(cwd, 'database', 'migrations', '2026_01_02_000000_create_posts.mjs'), migration('posts'))

    const count = await runNativeMigrate(adapter, cwd)
    assert.equal(count, 2)
    assert.equal(await adapter.schemaBuilder().hasTable('users'), true)
    assert.equal(await adapter.schemaBuilder().hasTable('posts'), true)

    // Idempotent: a second run applies nothing.
    assert.equal(await runNativeMigrate(adapter, cwd), 0)
  })

  it('runNativeMigrate returns 0 when there are no migration files', async () => {
    assert.equal(await runNativeMigrate(adapter, cwd), 0)
  })

  it('runNativeStatus prints a row per migration without throwing', async () => {
    await fs.writeFile(nodePath.join(cwd, 'database', 'migrations', '2026_01_01_000000_create_users.mjs'), migration('users'))
    const lines: string[] = []
    console.log = (s?: unknown) => { lines.push(String(s)) }
    await runNativeMigrate(adapter, cwd)
    await runNativeStatus(adapter, cwd)
    console.log = () => {}
    assert.ok(lines.some(l => l.includes('Ran') && l.includes('create_users')))
  })
})

// ── Native rollback / refresh / fresh command layer (7.5) ─
// Same harness shape as the 7.2 block: a temp database/migrations/ of `.mjs`
// files driven against an in-memory adapter.

describe('migrate — native rollback/refresh/fresh command layer', () => {
  const nativeIndex = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../native/index.js')
  const importBase = pathToFileURL(nativeIndex).href

  const migration = (table: string) =>
    `import { Migration, Schema } from ${JSON.stringify(importBase)}\n` +
    `export default class extends Migration {\n` +
    `  async up()   { await Schema.create(${JSON.stringify(table)}, (t) => { t.id(); t.string('name') }) }\n` +
    `  async down() { await Schema.dropIfExists(${JSON.stringify(table)}) }\n` +
    `}\n`

  let cwd: string
  let driver: Driver
  let adapter: NativeAdapter
  const realLog = console.log

  beforeEach(async () => {
    cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-native-rrf-'))
    await fs.mkdir(nodePath.join(cwd, 'database', 'migrations'), { recursive: true })
    await fs.writeFile(nodePath.join(cwd, 'database', 'migrations', '2026_01_01_000000_create_users.mjs'), migration('users'))
    await fs.writeFile(nodePath.join(cwd, 'database', 'migrations', '2026_01_02_000000_create_posts.mjs'), migration('posts'))
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver })
    console.log = () => {}
  })
  afterEach(async () => {
    console.log = realLog
    await driver.close()
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('runNativeRollback reverts the last batch and drops its tables', async () => {
    await runNativeMigrate(adapter, cwd) // both in batch 1
    const count = await runNativeRollback(adapter, cwd)
    assert.equal(count, 2)
    assert.equal(await adapter.schemaBuilder().hasTable('users'), false)
    assert.equal(await adapter.schemaBuilder().hasTable('posts'), false)

    // Nothing left to roll back.
    assert.equal(await runNativeRollback(adapter, cwd), 0)
  })

  it('runNativeRefresh rolls everything back then re-applies', async () => {
    await runNativeMigrate(adapter, cwd)
    const count = await runNativeRefresh(adapter, cwd)
    assert.equal(count, 2)
    assert.equal(await adapter.schemaBuilder().hasTable('users'), true)
    assert.equal(await adapter.schemaBuilder().hasTable('posts'), true)
  })

  it('runNativeFresh drops all tables then re-applies', async () => {
    await runNativeMigrate(adapter, cwd)
    const count = await runNativeFresh(adapter, cwd)
    assert.equal(count, 2)
    assert.equal(await adapter.schemaBuilder().hasTable('users'), true)
    assert.equal(await adapter.schemaBuilder().hasTable('posts'), true)
  })

  it('runNativeFresh works even when nothing was migrated yet', async () => {
    const count = await runNativeFresh(adapter, cwd)
    assert.equal(count, 2)
    assert.equal(await adapter.schemaBuilder().hasTable('users'), true)
  })
})

// ── Native engine make:migration stub generator (7.3) ─────

describe('migrate — buildNativeMigrationStub()', () => {
  it('imports Migration + Schema from @rudderjs/orm/native and default-exports a Migration subclass', () => {
    const stub = buildNativeMigrationStub('whatever')
    assert.match(stub, /import \{ Migration, Schema \} from '@rudderjs\/orm\/native'/)
    assert.match(stub, /export default class extends Migration \{/)
    assert.match(stub, /async up\(\)/)
    assert.match(stub, /async down\(\)/)
  })

  it('scaffolds Schema.create + dropIfExists for a create_<table>_table name', () => {
    const stub = buildNativeMigrationStub('create_users_table')
    assert.match(stub, /await Schema\.create\('users', \(t\) => \{/)
    assert.match(stub, /t\.id\(\)/)
    assert.match(stub, /t\.timestamps\(\)/)
    assert.match(stub, /await Schema\.dropIfExists\('users'\)/)
  })

  it('infers the table name from the middle segment (create_blog_posts_table → blog_posts)', () => {
    const stub = buildNativeMigrationStub('create_blog_posts_table')
    assert.match(stub, /await Schema\.create\('blog_posts',/)
    assert.match(stub, /await Schema\.dropIfExists\('blog_posts'\)/)
  })

  it('produces a generic empty up/down stub with TODOs for a non-create name', () => {
    const stub = buildNativeMigrationStub('add_votes_to_posts')
    // No table inference → no Schema.create / dropIfExists scaffolding.
    assert.doesNotMatch(stub, /Schema\.create/)
    assert.doesNotMatch(stub, /Schema\.dropIfExists/)
    // ...and no reference to Schema.table (alters are a separate phase, 7.4).
    assert.doesNotMatch(stub, /Schema\.table/)
    assert.match(stub, /async up\(\) \{\n\s+\/\/ TODO/)
    assert.match(stub, /async down\(\) \{\n\s+\/\/ TODO/)
  })
})

describe('migrate — writeNativeMigration()', () => {
  let tmpDir: string
  const fixedNow = new Date('2026-05-11T12:34:56Z')

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-native-stub-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes a timestamped stub to database/migrations/<ts>_<name>.ts', async () => {
    const result = await writeNativeMigration('create_users_table', tmpDir, fixedNow)
    assert.match(
      result.filePath.replace(/\\/g, '/'),
      /database\/migrations\/20260511123456_create_users_table\.ts$/,
    )
    const written = await fs.readFile(result.filePath, 'utf8')
    assert.equal(written, result.contents)
    assert.match(written, /await Schema\.create\('users',/)
  })

  it('creates the database/migrations directory if it does not exist', async () => {
    // tmpDir starts with no database/ dir at all.
    const result = await writeNativeMigration('add_index', tmpDir, fixedNow)
    const stat = await fs.stat(nodePath.dirname(result.filePath))
    assert.ok(stat.isDirectory())
  })

  it('rejects an unsafe migration name', async () => {
    await assert.rejects(() => writeNativeMigration('x; rm -rf .', tmpDir, fixedNow), /Invalid migration name/)
  })
})
