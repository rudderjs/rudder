// schema:types command + native runner (GATE 7-types). Exercises
// collectRegisteredModelCasts (string casts only), the native adapter's
// generateSchemaTypes, and the end-to-end `schema:types` command wiring against
// an in-memory SQLite connection. Node's test runner isolates each test file in
// its own process, so the global ModelRegistry only holds what this file
// registers.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'
import { NativeAdapter } from '@rudderjs/database/native'
import { SchemaBuilder } from '@rudderjs/database/native'
import { Model, ModelRegistry } from '../index.js'
import { collectRegisteredModelCasts, registerAppModels, runNativeSchemaTypes, registerMigrateCommands } from './migrate.js'
import { registerSchemaTypesCommand } from './schema-types.js'

const dialect = new SqliteDialect()
let driver: Driver
let adapter: NativeAdapter

// A model with a string cast (`enabled` → boolean) and — to prove they're
// skipped — no class cast. Declared at module scope so it registers once.
class Widget extends Model {
  static override table = 'widgets'
  static override casts = { enabled: 'boolean' } as const
}

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  adapter = await NativeAdapter.make({ driverInstance: driver })
  const schema = new SchemaBuilder(driver, dialect)
  await schema.create('widgets', (t) => {
    t.id()
    t.string('label')
    t.boolean('enabled').default(true)
  })
  ModelRegistry.register(Widget)
  ModelRegistry.set(adapter)
})
afterEach(async () => { await driver.close() })

describe('collectRegisteredModelCasts', () => {
  it('returns each registered model\'s table + string casts', () => {
    const all = collectRegisteredModelCasts()
    const w = all.find((m) => m.table === 'widgets')
    assert.ok(w, 'widgets model should be collected')
    assert.equal(w.casts['enabled'], 'boolean')
  })
})

describe('registerAppModels', () => {
  // Models register lazily on first query, which never fires in a CLI
  // generation run — the runner must sweep app/Models/** itself or no casts
  // ever fold in (every app, always). See
  // docs/plans/2026-06-05-schema-types-cast-folding-needs-import-time-registration.md.
  it('sweeps app/Models so never-queried models contribute casts', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-st-sweep-'))
    try {
      // The temp model must extend the SAME Model identity this test file
      // (and migrate.js) imports, so point its import at the compiled
      // index.js explicitly — a bare '@rudderjs/orm' specifier wouldn't
      // resolve from a tmpdir anyway.
      const ormUrl = new URL('../index.js', import.meta.url).href
      const modelsDir = join(cwd, 'app', 'Models')
      mkdirSync(join(modelsDir, '__schema'), { recursive: true })
      writeFileSync(join(modelsDir, 'Article.js'), [
        `import { Model } from '${ormUrl}'`,
        'export class Article extends Model {',
        "  static table = 'articles'",
        "  static casts = { featured: 'boolean' }",
        '}',
        'export const notAModel = 42',   // non-class exports are skipped
        '',
      ].join('\n'))
      // Decoys the sweep must skip/tolerate without aborting:
      writeFileSync(join(modelsDir, '__schema', 'registry.d.ts'), "declare module '@rudderjs/orm' {}\n")
      writeFileSync(join(modelsDir, 'Broken.js'), "import 'this-package-does-not-exist'\n")

      await registerAppModels(cwd)

      const article = collectRegisteredModelCasts().find((m) => m.table === 'articles')
      assert.ok(article, 'swept Article model should be in the registry')
      assert.equal(article.casts['featured'], 'boolean')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('end-to-end: a swept model\'s cast folds into registry.d.ts', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-st-sweep-e2e-'))
    try {
      const schema = new SchemaBuilder(driver, dialect)
      await schema.create('articles', (t) => {
        t.id()
        t.string('title')
        t.boolean('featured').default(false)   // sqlite stores INTEGER
      })
      const ormUrl = new URL('../index.js', import.meta.url).href
      mkdirSync(join(cwd, 'app', 'Models'), { recursive: true })
      writeFileSync(join(cwd, 'app', 'Models', 'Article.js'), [
        `import { Model } from '${ormUrl}'`,
        'export class Article extends Model {',
        "  static table = 'articles'",
        "  static casts = { featured: 'boolean' }",
        '}',
        '',
      ].join('\n'))

      await runNativeSchemaTypes(adapter, cwd)

      const dts = readFileSync(join(cwd, '.rudder', 'types', 'models.d.ts'), 'utf8')
      assert.match(dts, /articles: \{/)
      assert.match(dts, /featured: boolean/, 'cast must override the INTEGER storage type')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('runNativeSchemaTypes', () => {
  it('writes registry.d.ts and folds the model\'s cast in', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-st-runner-'))
    try {
      await runNativeSchemaTypes(adapter, cwd)
      const path = join(cwd, '.rudder', 'types', 'models.d.ts')
      assert.ok(existsSync(path), 'registry.d.ts should be written')
      const dts = readFileSync(path, 'utf8')
      assert.match(dts, /declare module '@rudderjs\/orm'/)
      assert.match(dts, /widgets: \{/)
      assert.match(dts, /label: string/)
      assert.match(dts, /enabled: boolean/)   // cast overrides INTEGER storage
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('registerSchemaTypesCommand', () => {
  it('native app: generates the registry from the live schema', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-st-cmd-'))
    const orig = process.cwd()
    process.chdir(cwd)   // command captures process.cwd() at registration
    try {
      const handlers: Record<string, (args: string[]) => void | Promise<void>> = {}
      const rudder = {
        command(name: string, handler: (args: string[]) => void | Promise<void>) {
          handlers[name] = handler
          return { description() { return this } }
        },
      }
      // bootApp is a no-op — the adapter is already registered via ModelRegistry.set.
      registerSchemaTypesCommand(rudder, { bootApp: async () => {} })
      const handler = handlers['schema:types']
      assert.ok(handler, 'command registered')
      await handler([])

      const path = join(cwd, '.rudder', 'types', 'models.d.ts')
      assert.ok(existsSync(path), 'registry.d.ts should be written under cwd')
      assert.match(readFileSync(path, 'utf8'), /widgets: \{/)
    } finally {
      process.chdir(orig)
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('native migrate auto-regenerates schema types (post-apply hook)', () => {
  it('migrate writes registry.d.ts even with nothing to migrate', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-st-hook-'))
    const orig = process.cwd()
    process.chdir(cwd)
    try {
      mkdirSync(join(cwd, 'database', 'migrations'), { recursive: true })   // empty → 0 pending
      const handlers: Record<string, (args: string[]) => void | Promise<void>> = {}
      const rudder = {
        command(name: string, handler: (args: string[]) => void | Promise<void>) {
          handlers[name] = handler
          return { description() { return this } }
        },
      }
      registerMigrateCommands(rudder, { bootApp: async () => {} })
      const handler = handlers['migrate']
      assert.ok(handler, 'migrate command registered')
      await handler([])

      const path = join(cwd, '.rudder', 'types', 'models.d.ts')
      assert.ok(existsSync(path), 'migrate should auto-generate registry.d.ts')
      assert.match(readFileSync(path, 'utf8'), /widgets: \{/)
    } finally {
      process.chdir(orig)
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
