import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { prisma } from './index.js'
import { MissingEmbedderError, VectorStorageUnsupportedError } from '@rudderjs/orm'

// ─── Fake Prisma client that captures $queryRawUnsafe SQL ─

function makeVectorClient(opts: { rows?: Array<Record<string, unknown>>; throwOnQuery?: string } = {}) {
  const captured: string[] = []
  const capturedParams: unknown[][] = []
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
      capturedParams.push(args.slice(1))
      if (opts.throwOnQuery) throw new Error(opts.throwOnQuery)
      return rows
    },
  }
  return {
    fakeClient,
    getCaptured: () => captured,
    getCapturedParams: () => capturedParams,
  }
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

// ─── still-unsupported chains (subset, post-Phase-2.5) ────

describe('whereVectorSimilarTo — still-unsupported chains', () => {
  it('throws when chained with .with() (eager load)', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await assert.rejects(
      () => qb.whereVectorSimilarTo!('embedding', [1]).with('author').get(),
      /not yet supported/i,
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

  it('throws when chained with whereGroup()', async () => {
    const { fakeClient } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await assert.rejects(
      () => qb
        .whereVectorSimilarTo!('embedding', [1])
        .whereGroup(g => g.where('published', true))
        .get(),
      /whereGroup/i,
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

// ─── chained .where() composition (#B7 Phase 2.5) ─────────

describe('whereVectorSimilarTo — chained .where() (Phase 2.5)', () => {
  it('chains a single .where() into the SQL with positional $1 binding', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [0.1, 0.2]).where('published', true).get()

    const sql = getCaptured()[0]!
    assert.match(sql, /WHERE "published" = \$1/)
    assert.match(sql, /ORDER BY "embedding" <=>/)
    assert.deepEqual(getCapturedParams()[0], [true])
  })

  it('combines minSimilarity + .where() — both clauses joined by AND', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1, 2], { minSimilarity: 0.5 })
      .where('tenantId', 42)
      .limit(5)
      .get()

    const sql = getCaptured()[0]!
    assert.match(sql, /WHERE 1 - \("embedding" <=> '\[1,2\]'::vector\) >= 0\.5 AND "tenantId" = \$1/)
    assert.deepEqual(getCapturedParams()[0], [42])
  })

  it('honors all WhereOperator values (=, !=, >, >=, <, <=)', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1])
      .where('a', '=',  1)
      .where('b', '!=', 2)
      .where('c', '>',  3)
      .where('d', '>=', 4)
      .where('e', '<',  5)
      .where('f', '<=', 6)
      .get()

    const sql = getCaptured()[0]!
    assert.match(sql, /"a" = \$1 AND "b" != \$2 AND "c" > \$3 AND "d" >= \$4 AND "e" < \$5 AND "f" <= \$6/)
    assert.deepEqual(getCapturedParams()[0], [1, 2, 3, 4, 5, 6])
  })

  it('translates `.where(col, "=", null)` to IS NULL (no parameter binding)', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).where('archivedAt', '=', null).get()

    assert.match(getCaptured()[0]!, /"archivedAt" IS NULL/)
    assert.deepEqual(getCapturedParams()[0], [])
  })

  it('translates `.where(col, "!=", null)` to IS NOT NULL', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).where('archivedAt', '!=', null).get()

    assert.match(getCaptured()[0]!, /"archivedAt" IS NOT NULL/)
  })

  it('expands IN with one positional placeholder per element', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).where('id', 'IN', [10, 20, 30]).get()

    assert.match(getCaptured()[0]!, /"id" IN \(\$1, \$2, \$3\)/)
    assert.deepEqual(getCapturedParams()[0], [10, 20, 30])
  })

  it('short-circuits empty IN to FALSE so Postgres does not syntax-error on empty lists', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).where('id', 'IN', []).get()

    assert.match(getCaptured()[0]!, /WHERE FALSE/)
  })

  it('short-circuits empty NOT IN to TRUE', async () => {
    const { fakeClient, getCaptured } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).where('id', 'NOT IN', []).get()

    assert.match(getCaptured()[0]!, /WHERE TRUE/)
  })

  it('LIKE / NOT LIKE pass user value through positional binding', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb.whereVectorSimilarTo!('embedding', [1]).where('title', 'LIKE', '%kafka%').get()

    assert.match(getCaptured()[0]!, /"title" LIKE \$1/)
    assert.deepEqual(getCapturedParams()[0], ['%kafka%'])
  })

  it('chains .orWhere() as top-level OR alternatives to the AND chain (Laravel parity, 2026-05-22 breaking)', async () => {
    // Before Phase 3 this emitted `tenantId=$1 AND (priority=$2 OR
    // starred=$3)` — the .orWhere() alternatives were constrained by the
    // prior AND. Laravel-parity is `(tenantId=$1 OR priority=$2 OR
    // starred=$3)` — each .orWhere() escapes the AND chain. With only
    // one .where() in the AND side, it joins the OR list directly (no
    // inner parens needed).
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1])
      .where('tenantId', 7)
      .orWhere('priority', 'high')
      .orWhere('starred', true)
      .get()

    const sql = getCaptured()[0]!
    assert.match(sql, /\("tenantId" = \$1 OR "priority" = \$2 OR "starred" = \$3\)/)
    assert.deepEqual(getCapturedParams()[0], [7, 'high', true])
  })

  it('chains .orWhere() with multiple .where() — the AND chain is parenthesised as one OR alternative', async () => {
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    await qb
      .whereVectorSimilarTo!('embedding', [1])
      .where('tenantId', 7)
      .where('status', 'active')
      .orWhere('priority', 'high')
      .get()

    const sql = getCaptured()[0]!
    // (tenantId=$1 AND status=$2) OR priority=$3
    assert.match(sql, /\(\("tenantId" = \$1 AND "status" = \$2\) OR "priority" = \$3\)/)
    assert.deepEqual(getCapturedParams()[0], [7, 'active', 'high'])
  })

  it('user values are bound positionally — never string-interpolated into SQL', async () => {
    // Defense-in-depth check: a `' OR 1=1 --` style payload should never
    // appear in the SQL itself; it must travel through $N to $queryRawUnsafe.
    const { fakeClient, getCaptured, getCapturedParams } = makeVectorClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const qb = adapter.query('documents')
    const evil = "'; DROP TABLE documents; --"
    await qb.whereVectorSimilarTo!('embedding', [1]).where('title', evil).get()

    const sql = getCaptured()[0]!
    assert.doesNotMatch(sql, /DROP TABLE/)
    assert.match(sql, /"title" = \$1/)
    assert.deepEqual(getCapturedParams()[0], [evil])
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
