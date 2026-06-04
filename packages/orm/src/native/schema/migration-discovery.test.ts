// discoverMigrations (7.2): loads `*.{ts,js,mts,mjs}` migration files from a
// directory, sorted by filename, validating each default export extends
// Migration. Uses a temp dir of `.mjs` files that import the compiled Migration
// base by file URL (node can import `.mjs` directly — no tsx needed).

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NativeOrmError } from '@rudderjs/database/native'
import { discoverMigrations } from './migrator.js'

// The native barrel as THIS test build sees it (dist-test/native/index.js, the
// sibling of this test's compiled location). Temp migration files must extend
// the same `Migration` class identity `discoverMigrations` checks against —
// pointing at the production `dist/` build would be a different class.
const nativeIndex = resolve(dirname(fileURLToPath(import.meta.url)), '../index.js')
const importBase = pathToFileURL(nativeIndex).href

function migrationFile(table: string): string {
  return `import { Migration, Schema } from ${JSON.stringify(importBase)}\n` +
    `export default class extends Migration {\n` +
    `  async up() { await Schema.create(${JSON.stringify(table)}, (t) => t.id()) }\n` +
    `}\n`
}

let dir: string

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'rudder-migrations-'))
})
after(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('discoverMigrations', () => {
  it('returns [] for a missing directory', async () => {
    assert.deepStrictEqual(await discoverMigrations(join(dir, 'does-not-exist')), [])
  })

  it('loads migration files sorted by filename, ignoring non-migration files', async () => {
    writeFileSync(join(dir, '2026_01_02_000000_create_posts.mjs'), migrationFile('posts'))
    writeFileSync(join(dir, '2026_01_01_000000_create_users.mjs'), migrationFile('users'))
    writeFileSync(join(dir, 'README.md'), '# not a migration')
    writeFileSync(join(dir, 'types.d.ts'), 'export {}')

    const loaded = await discoverMigrations(dir)
    assert.deepStrictEqual(loaded.map(m => m.name), [
      '2026_01_01_000000_create_users',
      '2026_01_02_000000_create_posts',
    ])
    // Each entry is an instantiated Migration with an up() method.
    assert.strictEqual(typeof loaded[0]?.migration.up, 'function')
  })

  it('throws on a file whose default export is not a Migration', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'rudder-bad-mig-'))
    try {
      writeFileSync(join(bad, '2026_01_01_000000_bogus.mjs'), 'export default 42\n')
      await assert.rejects(
        () => discoverMigrations(bad),
        (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_BAD_MIGRATION',
      )
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })
})
