import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import nodePath from 'node:path'
import os from 'node:os'
import { detectORM, buildArgs, findSeederFile, hasPrismaSeedConfig, runSeeder } from './migrate.js'

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
