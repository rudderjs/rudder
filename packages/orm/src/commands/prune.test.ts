import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSqlite3Driver, NativeAdapter, SchemaBuilder, SqliteDialect } from '@rudderjs/database/native'
import { ModelRegistry } from '../index.js'
import { arg, registerPruneCommand } from './prune.js'

describe('model:prune arg parser', () => {
  it('--name=value form', () => {
    assert.equal(arg(['--chunk=200'], '--chunk'), '200')
  })

  it('--name value form', () => {
    assert.equal(arg(['--chunk', '500'], '--chunk'), '500')
  })

  it('returns undefined when flag is absent', () => {
    assert.equal(arg(['--pretend'], '--chunk'), undefined)
  })

  it('= form takes precedence when both shapes appear', () => {
    assert.equal(arg(['--chunk=10', '--chunk', '99'], '--chunk'), '10')
  })

  it('returns undefined when --name is the last arg with no value', () => {
    assert.equal(arg(['--model'], '--model'), undefined)
  })
})

// End-to-end through the REAL command wiring: the CLI registers the handler
// with no model sweep of its own, and model registration is lazy (first
// query) — so the handler itself must sweep app/Models/** into the registry
// or discovery sees an empty registry in every real run (the #934 shape;
// prune was the second instance). No manual ModelRegistry.register here —
// that's the point.
describe('model:prune end-to-end (real CLI wiring)', () => {
  it('sweeps app/Models itself — a never-queried prunable model is pruned', async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-prune-e2e-'))
    try {
      const adapter = await NativeAdapter.make({ driverInstance: driver })
      const schema = new SchemaBuilder(driver, new SqliteDialect())
      await schema.create('prunedocs', (t) => {
        t.id()
        t.boolean('expired').default(false)
      })
      await adapter.query<{ expired: number }>('prunedocs').insertMany([
        { expired: 1 }, { expired: 1 }, { expired: 0 },
      ])
      // Production parity: NativeDatabaseProvider.boot() sets the adapter —
      // and nothing else. It never registers app models.
      ModelRegistry.set(adapter)

      // The temp model must extend the SAME Model identity this package
      // imports, so point its import at the compiled index.js explicitly
      // (a bare '@rudderjs/orm' specifier wouldn't resolve from a tmpdir).
      const ormUrl = new URL('../index.js', import.meta.url).href
      mkdirSync(join(cwd, 'app', 'Models'), { recursive: true })
      writeFileSync(join(cwd, 'app', 'Models', 'PruneDoc.js'), [
        `import { Model } from '${ormUrl}'`,
        'export class PruneDoc extends Model {',
        "  static table = 'prunedocs'",
        "  static pruneMode = 'mass'",
        "  static prunable() { return this.where('expired', 1) }",
        '}',
        '',
      ].join('\n'))

      // Capture the handler exactly as the CLI's loader receives it.
      let handler: ((args: string[]) => void | Promise<void>) | undefined
      const rudder = {
        command(_name: string, h: (args: string[]) => void | Promise<void>) {
          handler = h
          return { description: () => ({}) }
        },
      }
      registerPruneCommand(rudder, { cwd })
      assert.ok(handler, 'model:prune handler should be registered')

      await handler!([])

      const remaining = await adapter.query('prunedocs').count()
      assert.equal(remaining, 1, 'expired rows pruned through the real command path')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      await driver.close()
    }
  })
})
