import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { prisma } from './index.js'
import { MissingEmbedderError, VectorStorageUnsupportedError } from '@rudderjs/orm'

// ─── Fake Prisma client that captures $queryRawUnsafe SQL ─

function makeVectorClient(opts: { rows?: Array<Record<string, unknown>>; throwOnQuery?: string } = {}) {
  const captured: string[] = []
  const rows = opts.rows ?? []
  const delegate = {
    findMany:   async () => rows,
    findFirst:  async () => rows[0] ?? null,
    findUnique: async () => null,
    count:      async () => 0,
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    updateMany: async () => ({ count: 0 }),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  }
  const fakeClient = {
    documents:    delegate,
    $connect:     async () => {},
    $disconnect:  async () => {},
    $queryRawUnsafe: async (...args: unknown[]) => {
      captured.push(args[0] as string)
      if (opts.throwOnQuery) throw new Error(opts.throwOnQuery)
      return rows
    },
  }
  return { fakeClient, getCaptured: () => captured }
}

// ─── whereVectorSimilarTo — happy path ────────────────────

describe('whereVectorSimilarTo — basic SQL shape', () => {
  it('emits a cosine ORDER BY with `<=>` op (default metric)', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await qb.whereVectorSimilarTo!('embedding', [0.1, 0.2, 0.3]).limit(5).get()

    const sql = getCaptured()[0]!
    assert.match(sql, /SELECT \* FROM "documents"/)
    assert.match(sql, /ORDER BY "embedding" <=> '\[0\.1,0\.2,0\.3\]'::vector/)
    assert.match(sql, /LIMIT 5/)
  })

  it('honors metric: l2 → `<->`', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await qb.whereVectorSimilarTo!('embedding', [1, 2], { metric: 'l2' }).get()
    assert.match(getCaptured()[0]!, /<->/)
  })

  it('honors metric: inner-product → `<#>`', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await qb.whereVectorSimilarTo!('embedding', [1, 2], { metric: 'inner-product' }).get()
    assert.match(getCaptured()[0]!, /<#>/)
  })

  it('emits a WHERE clause when minSimilarity is set (1 - distance >= minSimilarity)', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await qb.whereVectorSimilarTo!('embedding', [1, 2], { minSimilarity: 0.4 }).get()

    const sql = getCaptured()[0]!
    assert.match(sql, /WHERE 1 - \("embedding" <=> '\[1,2\]'::vector\) >= 0\.4/)
  })

  it('default LIMIT 100 when none specified', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await qb.whereVectorSimilarTo!('embedding', [1]).get()

    assert.match(getCaptured()[0]!, /LIMIT 100/)
  })
})

// ─── selectVectorDistance ─────────────────────────────────

describe('selectVectorDistance — distance projection', () => {
  it('adds the distance column to the SELECT list', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1, 2])
      .selectVectorDistance!('embedding', [1, 2], 'score')
      .limit(3)
      .get()

    const sql = getCaptured()[0]!
    assert.match(sql, /\("embedding" <=> '\[1,2\]'::vector\) AS "score"/)
  })
})

// ─── first() with vector clause ───────────────────────────

describe('whereVectorSimilarTo — first()', () => {
  it('limits to 1 and unwraps', async () => {
    const fakeRow = { id: 7, content: 'first hit' }
    const { fakeClient, getCaptured } = makeVectorClient({ rows: [fakeRow] })
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
const row = await qb.whereVectorSimilarTo!('embedding', [1]).first()
    assert.deepEqual(row, fakeRow)
    assert.match(getCaptured()[0]!, /LIMIT 1/)
  })

  it('returns null when no rows match', async () => {
    const { fakeClient } = makeVectorClient({ rows: [] })
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
const row = await qb.whereVectorSimilarTo!('embedding', [1]).first()
    assert.equal(row, null)
  })
})

// ─── v1 restrictions ──────────────────────────────────────

describe('whereVectorSimilarTo — v1 restrictions', () => {
  it('throws when chained with .where() (B7 Phase 2)', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).where('published', true).get(),
      /Phase 2/i,
    )
  })

  it('throws when chained with .with() (eager load — B7 Phase 2)', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).with('author').get(),
      /Phase 2/i,
    )
  })

  it('throws when chained with .orderBy() (redundant)', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).orderBy('createdAt').get(),
      /redundant/i,
    )
  })

  it('throws on count() with vector clause', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).count(),
      /not supported.*Phase 1/i,
    )
  })
})

// ─── auto-embed path (string query) ───────────────────────

describe('whereVectorSimilarTo — auto-embed', () => {
  it('throws MissingEmbedderError when query is a string without embedWith', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    assert.throws(
      () => qb.whereVectorSimilarTo!('embedding', 'a natural-language query'),
      (err: unknown) => {
        if (!(err instanceof MissingEmbedderError)) return false
        assert.equal(err.code,   'VECTOR_MISSING_EMBEDDER')
        assert.equal(err.column, 'embedding')
        return true
      },
    )
  })

  it('accepts string query + embedWith synchronously (resolution deferred to terminal)', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    // Should NOT throw — auto-embed is deferred until .get() / .first().
    assert.doesNotThrow(() =>
      qb.whereVectorSimilarTo!('embedding', 'natural language query', { embedWith: 'openai/text-embedding-3-small' }),
    )
  })

  it('terminal call surfaces a clear error when @rudderjs/ai is not resolvable', async () => {
    // process.cwd() is the orm-prisma package dir during the test, where
    // @rudderjs/ai may or may not be reachable depending on workspace
    // hoisting. The error message must mention @rudderjs/ai either way so
    // users get an actionable diagnostic, never an opaque resolver dump.
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    qb.whereVectorSimilarTo!('embedding', 'query', { embedWith: 'fake-provider/fake-model' })
    await assert.rejects(
      () => qb.get(),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        // Either resolveOptionalPeer fails (peer missing) → guidance message,
        // OR ai resolves and AiRegistry rejects the unknown provider →
        // contains 'fake-provider' / provider-not-registered language.
        return /@rudderjs\/ai|fake-provider|provider/i.test(msg)
      },
    )
  })
})

// ─── pgvector missing → VectorStorageUnsupportedError ─────

describe('whereVectorSimilarTo — pgvector missing on the connection', () => {
  it('wraps "operator does not exist" as VectorStorageUnsupportedError', async () => {
    const { fakeClient } = makeVectorClient({ throwOnQuery: 'operator does not exist: vector <=> vector' })
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).get(),
      (err: unknown) => {
        if (!(err instanceof VectorStorageUnsupportedError)) return false
        assert.equal(err.code,    'VECTOR_STORAGE_UNSUPPORTED')
        assert.equal(err.adapter, 'prisma')
        assert.match(err.message, /CREATE EXTENSION/i)
        return true
      },
    )
  })

  it('wraps "type vector does not exist" as VectorStorageUnsupportedError', async () => {
    const { fakeClient } = makeVectorClient({ throwOnQuery: 'type "vector" does not exist' })
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).get(),
      VectorStorageUnsupportedError,
    )
  })

  it('does NOT wrap unrelated query errors', async () => {
    const { fakeClient } = makeVectorClient({ throwOnQuery: 'connection refused' })
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).get(),
      /connection refused/,
    )
  })
})

// ─── identifier quoting (defensive) ───────────────────────

describe('whereVectorSimilarTo — identifier quoting', () => {
  it('double-quotes table + column identifiers', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
await qb.whereVectorSimilarTo!('myEmbedding', [1]).get()

    const sql = getCaptured()[0]!
    assert.match(sql, /FROM "documents"/)
    assert.match(sql, /"myEmbedding"/)
  })
})
