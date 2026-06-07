// Blueprint-intent replay (schema:types fallback layer): replaying APPLIED
// migrations against the in-memory intent ledger, the runtime-statement guard
// (no re-executed backfills, ever), and the cast > intent > storage precedence
// folding into the generated registry. Runs against a REAL in-memory
// better-sqlite3 NativeAdapter where the live schema matters.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NativeAdapter } from '../adapter.js'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import { SqliteDialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { Migration } from './migration.js'
import { Schema } from './schema-facade.js'
import { Migrator, type LoadedMigration } from './migrator.js'
import { collectBlueprintIntent } from './intent-replay.js'
import { collectSchemaTypes } from './schema-types.js'
import { blueprintIntentToTs, resolveColumnType } from './types-generator.js'

class CreateArticles extends Migration {
  async up() {
    await Schema.create('articles', (t) => {
      t.id()
      t.string('title')
      t.boolean('featured')
      t.json('meta')
      t.timestamp('publishedAt').nullable()
    })
  }
  async down() { await Schema.dropIfExists('articles') }
}

class AlterArticles extends Migration {
  async up() {
    await Schema.table('articles', (t) => {
      t.boolean('pinned')
      t.renameColumn('meta', 'attributes')
      t.dropColumn('publishedAt')
    })
  }
  async down() { /* not replayed */ }
}

const loaded = (name: string, migration: Migration): LoadedMigration => ({ name, migration })

describe('collectBlueprintIntent — ledger replay', () => {
  it('records declared column types from Schema.create', async () => {
    const { intent, skipped } = await collectBlueprintIntent(
      [loaded('m1', new CreateArticles())],
      ['m1'],
    )
    assert.deepStrictEqual(skipped, [])
    const articles = intent.get('articles')
    assert.ok(articles)
    assert.strictEqual(articles.get('featured'), 'boolean')
    assert.strictEqual(articles.get('meta'), 'json')
    assert.strictEqual(articles.get('publishedAt'), 'timestamp')
    assert.strictEqual(articles.get('id'), 'increments')
  })

  it('applies alter ops: add, rename, drop', async () => {
    const { intent } = await collectBlueprintIntent(
      [loaded('m1', new CreateArticles()), loaded('m2', new AlterArticles())],
      ['m1', 'm2'],
    )
    const articles = intent.get('articles')
    assert.ok(articles)
    assert.strictEqual(articles.get('pinned'), 'boolean')
    assert.strictEqual(articles.get('attributes'), 'json') // renamed, type carried
    assert.strictEqual(articles.has('meta'), false)
    assert.strictEqual(articles.has('publishedAt'), false)
  })

  it('applies a .change() as a type update', async () => {
    class ChangeTitle extends Migration {
      async up() { await Schema.table('articles', (t) => { t.json('title').change() }) }
      async down() {}
    }
    const { intent } = await collectBlueprintIntent(
      [loaded('m1', new CreateArticles()), loaded('m2', new ChangeTitle())],
      ['m1', 'm2'],
    )
    assert.strictEqual(intent.get('articles')?.get('title'), 'json')
  })

  it('applies table rename and drop', async () => {
    class RenameThenDrop extends Migration {
      async up() {
        await Schema.rename('articles', 'posts')
        await Schema.create('scratch', (t) => { t.id() })
        await Schema.drop('scratch')
      }
      async down() {}
    }
    const { intent } = await collectBlueprintIntent(
      [loaded('m1', new CreateArticles()), loaded('m2', new RenameThenDrop())],
      ['m1', 'm2'],
    )
    assert.strictEqual(intent.has('articles'), false)
    assert.strictEqual(intent.get('posts')?.get('featured'), 'boolean')
    assert.strictEqual(intent.has('scratch'), false)
  })

  it('replays only APPLIED migrations, in applied order', async () => {
    const { intent } = await collectBlueprintIntent(
      [loaded('m1', new CreateArticles()), loaded('m2', new AlterArticles())],
      ['m1'], // m2 is pending — its intent must not apply
    )
    const articles = intent.get('articles')
    assert.ok(articles)
    assert.strictEqual(articles.has('pinned'), false)
    assert.strictEqual(articles.get('meta'), 'json')
  })

  it('skips an applied migration whose file is gone, silently', async () => {
    const { intent, skipped } = await collectBlueprintIntent(
      [loaded('m2', new CreateArticles())],
      ['m1_deleted', 'm2'],
    )
    assert.deepStrictEqual(skipped, [])
    assert.ok(intent.get('articles'))
  })

  it('answers hasTable/hasColumn from the ledger', async () => {
    class Conditional extends Migration {
      async up() {
        if (!(await Schema.hasTable('articles'))) {
          throw new Error('ledger should report articles as created')
        }
        if (!(await Schema.hasColumn('articles', 'featured'))) {
          throw new Error('ledger should report featured as present')
        }
        if (await Schema.hasTable('nope')) throw new Error('unknown table must read absent')
        await Schema.table('articles', (t) => { t.boolean('flagged') })
      }
      async down() {}
    }
    const { intent, skipped } = await collectBlueprintIntent(
      [loaded('m1', new CreateArticles()), loaded('m2', new Conditional())],
      ['m1', 'm2'],
    )
    assert.deepStrictEqual(skipped, [])
    assert.strictEqual(intent.get('articles')?.get('flagged'), 'boolean')
  })
})

describe('collectBlueprintIntent — runtime-statement guard', () => {
  let driver: Driver
  let adapter: NativeAdapter

  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver })
  })
  afterEach(async () => { await driver.close() })

  it('refuses a runtime statement mid-replay and skips the migration remainder', async () => {
    const live = adapter
    class WithBackfill extends Migration {
      async up() {
        await Schema.create('flags', (t) => { t.id(); t.boolean('enabled') })
        // A data backfill in the original run — must NOT re-execute on replay.
        await live.selectRaw('SELECT 1', [])
        await Schema.create('never_reached', (t) => { t.id() })
      }
      async down() {}
    }
    const { intent, skipped } = await collectBlueprintIntent(
      [loaded('m1', new WithBackfill())],
      ['m1'],
    )
    assert.deepStrictEqual(skipped, ['m1'])
    // Intent recorded BEFORE the throw is kept (those ops ran historically)…
    assert.strictEqual(intent.get('flags')?.get('enabled'), 'boolean')
    // …the remainder is not.
    assert.strictEqual(intent.has('never_reached'), false)
  })

  it('disarms the guard after replay — live queries work again', async () => {
    class Backfill extends Migration {
      async up() { await adapter.selectRaw('SELECT 1', []) }
      async down() {}
    }
    await collectBlueprintIntent([loaded('m1', new Backfill())], ['m1'])
    const rows = await adapter.selectRaw('SELECT 1 AS one', [])
    assert.strictEqual(rows.length, 1)
  })
})

describe('blueprint intent — type folding', () => {
  it('maps boolean and json/jsonb, leaves the rest to storage', () => {
    assert.strictEqual(blueprintIntentToTs('boolean'), 'boolean')
    assert.strictEqual(blueprintIntentToTs('json'), 'unknown')
    assert.strictEqual(blueprintIntentToTs('jsonb'), 'unknown')
    // The date family deliberately does NOT fold — better-sqlite3 rejects a
    // Date binding on a cast-less column, so a `Date` type would lie.
    assert.strictEqual(blueprintIntentToTs('timestamp'), null)
    assert.strictEqual(blueprintIntentToTs('date'), null)
    assert.strictEqual(blueprintIntentToTs('string'), null)
    assert.strictEqual(blueprintIntentToTs('increments'), null)
  })

  it('resolveColumnType precedence: cast > intent > storage', () => {
    const col = { name: 'featured', type: 'INTEGER', notNull: true, pk: 0, dflt: null }
    const intent = new Map([['featured', 'boolean' as const]])
    // Cast wins over intent.
    assert.strictEqual(resolveColumnType(col, { featured: 'integer' }, undefined, intent).ts, 'number')
    // Intent wins over storage.
    assert.strictEqual(resolveColumnType(col, {}, undefined, intent).ts, 'boolean')
    // No cast, no intent → storage affinity.
    assert.strictEqual(resolveColumnType(col, {}).ts, 'number')
  })

  it('folds intent into collectSchemaTypes against a live sqlite schema', async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    try {
      const adapter = await NativeAdapter.make({ driverInstance: driver })
      const migrations = [loaded('m1', new CreateArticles())]
      await new Migrator(adapter).run(migrations)
      const { intent } = await collectBlueprintIntent(migrations, ['m1'])

      const tables = await collectSchemaTypes(driver, new SqliteDialect(), [], intent)
      const articles = tables.find((t) => t.table === 'articles')
      assert.ok(articles)
      const ts = Object.fromEntries(articles.columns.map((c) => [c.name, c.ts]))
      assert.strictEqual(ts['featured'], 'boolean')       // intent (INTEGER affinity without it)
      assert.strictEqual(ts['meta'], 'unknown')           // intent (TEXT affinity without it)
      assert.strictEqual(ts['publishedAt'], 'string | null') // date family stays storage-typed
      assert.strictEqual(ts['title'], 'string')

      // A model cast still wins over intent.
      const withCast = await collectSchemaTypes(
        driver, new SqliteDialect(),
        [{ table: 'articles', casts: { featured: 'integer' } }],
        intent,
      )
      const cols = Object.fromEntries(withCast.find((t) => t.table === 'articles')!.columns.map((c) => [c.name, c.ts]))
      assert.strictEqual(cols['featured'], 'number')
    } finally {
      await driver.close()
    }
  })
})
