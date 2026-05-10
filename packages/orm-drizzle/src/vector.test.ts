import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { pgTable, integer, text } from 'drizzle-orm/pg-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

import { drizzle } from './index.js'
import { MissingEmbedderError, VectorStorageUnsupportedError } from '@rudderjs/orm'

// ─── Fake Drizzle DB capturing every db.execute(sql) call ─

const dialect = new PgDialect()

interface RenderedQuery { sql: string; params: unknown[] }
interface FakeDbCapture {
  rendered:    RenderedQuery[]
  rawCaptured: SQL[]
}

function renderSql(s: SQL): RenderedQuery {
  const q = dialect.sqlToQuery(s)
  return { sql: q.sql, params: q.params as unknown[] }
}

function makeFakeDb(opts: { rows?: Array<Record<string, unknown>>; throwOnExecute?: string } = {}): {
  fakeDb: Record<string, unknown>
  capture: FakeDbCapture
} {
  const capture: FakeDbCapture = { rendered: [], rawCaptured: [] }
  const fakeDb = {
    select() { return { from: () => fakeDb } as unknown as Record<string, unknown> },
    insert() { return { values: () => fakeDb } as unknown as Record<string, unknown> },
    update() { return { set:    () => fakeDb } as unknown as Record<string, unknown> },
    delete() { return fakeDb as unknown as Record<string, unknown> },
    execute: async (sqlObj: SQL) => {
      capture.rawCaptured.push(sqlObj)
      capture.rendered.push(renderSql(sqlObj))
      if (opts.throwOnExecute) throw new Error(opts.throwOnExecute)
      return { rows: opts.rows ?? [] }
    },
  } as Record<string, unknown>
  return { fakeDb, capture }
}

const documents = pgTable('documents', {
  id:        integer('id').primaryKey(),
  content:   text('content'),
  embedding: text('embedding'),
  published: integer('published'),
  tenantId:  integer('tenant_id'),
})

async function makeAdapter(opts: Parameters<typeof makeFakeDb>[0] = {}) {
  const { fakeDb, capture } = makeFakeDb(opts)
  const adapter = await drizzle({ client: fakeDb, tables: { documents } }).create()
  return { adapter, capture }
}

// ─── Basic SQL shape ─────────────────────────────────────

describe('Drizzle whereVectorSimilarTo — basic SQL shape', () => {
  it('emits a cosine ORDER BY with `<=>` op (default metric)', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [0.1, 0.2, 0.3]).limit(5).get()

    const r = capture.rendered[0]!
    assert.match(r.sql, /SELECT \*/)
    assert.match(r.sql, /from "documents"/i)
    assert.match(r.sql, /order by "documents"\."embedding" <=>/i)
    // Vector literal + limit are positional bind params, not inlined.
    assert.deepEqual(r.params.includes('[0.1,0.2,0.3]'), true)
    assert.deepEqual(r.params.includes(5), true)
  })

  it('honors metric: l2 → `<->`', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1, 2], { metric: 'l2' }).get()
    assert.match(capture.rendered[0]!.sql, /<->/)
  })

  it('honors metric: inner-product → `<#>`', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1, 2], { metric: 'inner-product' }).get()
    assert.match(capture.rendered[0]!.sql, /<#>/)
  })

  it('emits a WHERE clause when minSimilarity is set (1 - distance >= minSim)', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1, 2], { minSimilarity: 0.4 }).get()

    const r = capture.rendered[0]!
    assert.match(r.sql, /where 1 - \("documents"\."embedding" <=>/i)
    // 0.4 + the vector literal both bind positionally
    assert.deepEqual(r.params.includes(0.4), true)
  })

  it('default LIMIT 100 when none specified', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).get()
    assert.deepEqual(capture.rendered[0]!.params.includes(100), true)
  })
})

// ─── selectVectorDistance ─────────────────────────────────

describe('Drizzle selectVectorDistance — distance projection', () => {
  it('adds the distance column to the SELECT list with the alias', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1, 2])
      .selectVectorDistance!('embedding', [1, 2], 'score')
      .limit(3)
      .get()

    const r = capture.rendered[0]!
    assert.match(r.sql, /\("documents"\."embedding" <=>.*\) as "score"/i)
  })
})

// ─── first() with vector clause ───────────────────────────

describe('Drizzle whereVectorSimilarTo — first()', () => {
  it('limits to 1 and returns the first row', async () => {
    const fakeRow = { id: 7, content: 'first hit' }
    const { adapter, capture } = await makeAdapter({ rows: [fakeRow] })
    const qb = adapter.query('documents')
    const row = await qb.whereVectorSimilarTo!('embedding', [1]).first()
    assert.deepEqual(row, fakeRow)
    assert.deepEqual(capture.rendered[0]!.params.includes(1), true)
  })

  it('returns null when no rows match', async () => {
    const { adapter } = await makeAdapter({ rows: [] })
    const qb = adapter.query('documents')
    const row = await qb.whereVectorSimilarTo!('embedding', [1]).first()
    assert.equal(row, null)
  })
})

// ─── chained .where() composition (Phase 2.5 parity) ──────

describe('Drizzle whereVectorSimilarTo — chained .where()', () => {
  it('chains a .where() into the SQL alongside the vector clause', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [0.1]).where('published', 1).get()

    const r = capture.rendered[0]!
    assert.match(r.sql, /where "documents"\."published" =/i)
    assert.deepEqual(r.params.includes(1), true)
  })

  it('combines minSimilarity + .where() — both clauses joined by AND', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1, 2], { minSimilarity: 0.5 })
      .where('tenantId', 42)
      .get()

    const r = capture.rendered[0]!
    assert.match(r.sql, /where .* and .*"tenant_id" =/i)
    assert.deepEqual(r.params.includes(0.5), true)
    assert.deepEqual(r.params.includes(42), true)
  })

  it('honors all WhereOperator values via Drizzle helpers', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1])
      .where('id',        '>', 3)
      .where('published', 'IN', [1, 2])
      .get()

    const r = capture.rendered[0]!
    assert.match(r.sql, /"id" >/i)
    assert.match(r.sql, /"published" in/i)
    assert.deepEqual(r.params.includes(3), true)
    assert.deepEqual(r.params.includes(1), true)
    assert.deepEqual(r.params.includes(2), true)
  })

  it('user values are bound positionally — never string-interpolated into SQL', async () => {
    const { adapter, capture } = await makeAdapter()
    const qb = adapter.query('documents')
    const evil = "'; DROP TABLE documents; --"
    await qb.whereVectorSimilarTo!('embedding', [1]).where('content', evil).get()

    const r = capture.rendered[0]!
    assert.doesNotMatch(r.sql, /DROP TABLE/)
    assert.deepEqual(r.params.includes(evil), true)
  })
})

// ─── still-unsupported chains ─────────────────────────────

describe('Drizzle whereVectorSimilarTo — still-unsupported chains', () => {
  it('throws when chained with .orderBy() (redundant)', async () => {
    const { adapter } = await makeAdapter()
    const qb = adapter.query('documents')
    await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).orderBy('content').get(),
      /redundant/i,
    )
  })

  it('throws on count() with vector clause', async () => {
    const { adapter } = await makeAdapter()
    const qb = adapter.query('documents')
    await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).count(),
      /not supported/i,
    )
  })
})

// ─── auto-embed path (string query) ───────────────────────

describe('Drizzle whereVectorSimilarTo — auto-embed', () => {
  it('throws MissingEmbedderError when query is a string without embedWith', async () => {
    const { adapter } = await makeAdapter()
    const qb = adapter.query('documents')
    assert.throws(
      () => qb.whereVectorSimilarTo!('embedding', 'natural language query'),
      (err: unknown) => {
        if (!(err instanceof MissingEmbedderError)) return false
        assert.equal(err.code,   'VECTOR_MISSING_EMBEDDER')
        assert.equal(err.column, 'embedding')
        return true
      },
    )
  })

  it('accepts string query + embedWith synchronously (resolution deferred to terminal)', async () => {
    const { adapter } = await makeAdapter()
    const qb = adapter.query('documents')
    assert.doesNotThrow(() =>
      qb.whereVectorSimilarTo!('embedding', 'q', { embedWith: 'openai/text-embedding-3-small' }),
    )
  })

  it('terminal call surfaces a clear error mentioning @rudderjs/ai when peer/provider are unreachable', async () => {
    const { adapter } = await makeAdapter()
    const qb = adapter.query('documents')
    qb.whereVectorSimilarTo!('embedding', 'q', { embedWith: 'fake-provider/fake-model' })
    await assert.rejects(
      () => qb.get(),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        return /@rudderjs\/ai|fake-provider|provider/i.test(msg)
      },
    )
  })
})

// ─── pgvector missing → VectorStorageUnsupportedError ─────

describe('Drizzle whereVectorSimilarTo — pgvector missing', () => {
  it('wraps "operator does not exist" as VectorStorageUnsupportedError', async () => {
    const { adapter } = await makeAdapter({ throwOnExecute: 'operator does not exist: vector <=> vector' })
    const qb = adapter.query('documents')
    await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).get(),
      (err: unknown) => {
        if (!(err instanceof VectorStorageUnsupportedError)) return false
        assert.equal(err.code,    'VECTOR_STORAGE_UNSUPPORTED')
        assert.equal(err.adapter, 'drizzle')
        assert.match(err.message, /CREATE EXTENSION/i)
        return true
      },
    )
  })

  it('does NOT wrap unrelated query errors', async () => {
    const { adapter } = await makeAdapter({ throwOnExecute: 'connection refused' })
    const qb = adapter.query('documents')
    await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).get(),
      /connection refused/,
    )
  })
})

// ─── unknown column on the registered table ───────────────

describe('Drizzle whereVectorSimilarTo — unknown column', () => {
  it('throws VectorStorageUnsupportedError when the column is not on the table', async () => {
    const { adapter } = await makeAdapter()
    const qb = adapter.query('documents')
    qb.whereVectorSimilarTo!('not_a_column', [1])
    await assert.rejects(
      () => qb.get(),
      (err: unknown) => {
        if (!(err instanceof VectorStorageUnsupportedError)) return false
        assert.match(err.message, /not_a_column/)
        return true
      },
    )
  })
})

// ─── driver missing db.execute ────────────────────────────

describe('Drizzle whereVectorSimilarTo — driver without execute()', () => {
  it('surfaces a helpful VectorStorageUnsupportedError', async () => {
    const noExec = {
      select() { return { from: () => noExec } as unknown as Record<string, unknown> },
      insert() { return { values: () => noExec } as unknown as Record<string, unknown> },
      update() { return { set:    () => noExec } as unknown as Record<string, unknown> },
      delete() { return noExec as unknown as Record<string, unknown> },
      // intentionally no `execute`
    } as Record<string, unknown>
    const adapter = await drizzle({ client: noExec, tables: { documents } }).create()
    const qb = adapter.query('documents')
    qb.whereVectorSimilarTo!('embedding', [1])
    await assert.rejects(
      () => qb.get(),
      (err: unknown) => {
        if (!(err instanceof VectorStorageUnsupportedError)) return false
        assert.match(err.message, /db\.execute/)
        return true
      },
    )
  })
})
