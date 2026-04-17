import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import nodePath from 'node:path'
import os from 'node:os'
import { detectORM, buildArgs } from './migrate.js'

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
