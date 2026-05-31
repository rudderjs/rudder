// schema:types command + native runner (GATE 7-types). Exercises
// collectRegisteredModelCasts (string casts only), the native adapter's
// generateSchemaTypes, and the end-to-end `schema:types` command wiring against
// an in-memory SQLite connection. Node's test runner isolates each test file in
// its own process, so the global ModelRegistry only holds what this file
// registers.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSqlite3Driver } from '../native/drivers/better-sqlite3.js'
import { SqliteDialect } from '../native/dialect.js'
import type { Driver } from '../native/driver.js'
import { NativeAdapter } from '../native/adapter.js'
import { SchemaBuilder } from '../native/schema/schema-builder.js'
import { Model, ModelRegistry } from '../index.js'
import { collectRegisteredModelCasts, runNativeSchemaTypes, registerMigrateCommands } from './migrate.js'
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

describe('runNativeSchemaTypes', () => {
  it('writes registry.d.ts and folds the model\'s cast in', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-st-runner-'))
    try {
      await runNativeSchemaTypes(adapter, cwd)
      const path = join(cwd, 'app', 'Models', '__schema', 'registry.d.ts')
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

      const path = join(cwd, 'app', 'Models', '__schema', 'registry.d.ts')
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

      const path = join(cwd, 'app', 'Models', '__schema', 'registry.d.ts')
      assert.ok(existsSync(path), 'migrate should auto-generate registry.d.ts')
      assert.match(readFileSync(path, 'utf8'), /widgets: \{/)
    } finally {
      process.chdir(orig)
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
