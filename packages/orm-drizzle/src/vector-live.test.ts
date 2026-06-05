// ─── pgvector — LIVE round-trip tests (Drizzle adapter) ──────────────────────
//
// Audit P1-7 (docs/plans/2026-06-05-data-layer-test-audit.md): every vector
// test in the repo is sqlite-mocked — the pgvector extension, the `<=>`/`<->`
// operators, the `::vector` casts, and the `[x,y,z]` literal format had never
// run against a server that understands them. This suite proves, live:
//   - the Model-layer `vector({ dimensions })` cast writes the pgvector text
//     format and reads it back as number[] (engine-agnostic cast, proven once
//     here),
//   - `whereVectorSimilarTo` ranks by real cosine distance (+ minSimilarity
//     filters and the metric operators parse server-side),
//   - `selectVectorDistance` projects a real distance value,
//   - the cast's write-time dimension guard still fires in front of a real
//     column.
//
// Gated on PG_TEST_URL + the extension actually installing: CI's pg service
// runs the pgvector/pgvector:pg16 image (swapped in this PR); a vanilla local
// postgres without the extension skips inside the test instead of failing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pgTable, serial, text as pgText } from 'drizzle-orm/pg-core'
import { Model, ModelRegistry, vector as vectorCast } from '@rudderjs/orm'
import { DrizzleAdapter } from './index.js'

const PG_URL = process.env['PG_TEST_URL']

test('live pg: pgvector cast round-trip + whereVectorSimilarTo + selectVectorDistance', { skip: !PG_URL }, async (t) => {
  const table = `dz_vec_${process.pid}`
  const docs = pgTable(table, {
    id:        serial('id').primaryKey(),
    body:      pgText('body').notNull(),
    // Deliberately TEXT, not drizzle's pgVector type: the Model-layer cast is
    // the serializer under test, and drizzle's vector column would stack a
    // second mapToDriverValue (JSON.stringify) on the cast's already-formatted
    // '[1,0,0]' string → a quoted, invalid vector literal (caught live).
    // postgres coerces the text param to vector(3) on insert; reads come back
    // as pgvector's text output, which the cast parses to number[].
    embedding: pgText('embedding'),
  })
  class Doc extends Model {
    static override table = table
    static override casts = { embedding: vectorCast({ dimensions: 3 }) }
    id!: number
    body!: string
    embedding!: number[]
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-vec-pg-${process.pid}`,
    tables: { [table]: docs },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    try {
      await adapter.affectingStatement('CREATE EXTENSION IF NOT EXISTS vector', [])
    } catch {
      t.skip('pgvector extension unavailable on this server (CI runs pgvector/pgvector:pg16)')
      return
    }
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, body text not null, embedding vector(3))`, [])

    // Cast write path: number[] serializes to the pgvector text literal and a
    // REAL vector(3) column accepts it.
    const alpha = await Doc.create({ body: 'alpha', embedding: [1, 0, 0] })
    await Doc.create({ body: 'beta',  embedding: [0, 1, 0] })
    await Doc.create({ body: 'close', embedding: [0.9, 0.1, 0] })

    // Cast read path: pgvector's text output parses back to number[].
    const found = await Doc.find(alpha.id)
    assert.deepEqual(found?.embedding, [1, 0, 0])

    // Similarity ranking (cosine): nearest-first to [1,0,0].
    const ranked = await adapter.query<{ body: string }>(table)
      .whereVectorSimilarTo!('embedding', [1, 0, 0])
      .get()
    assert.deepEqual(ranked.map((r) => r.body), ['alpha', 'close', 'beta'])

    // minSimilarity: beta is orthogonal (cosine sim 0) → filtered out.
    const similar = await adapter.query<{ body: string }>(table)
      .whereVectorSimilarTo!('embedding', [1, 0, 0], { minSimilarity: 0.8 })
      .get()
    assert.deepEqual(similar.map((r) => r.body).sort(), ['alpha', 'close'])

    // The l2 metric operator parses server-side too.
    const l2 = await adapter.query<{ body: string }>(table)
      .whereVectorSimilarTo!('embedding', [1, 0, 0], { metric: 'l2' })
      .get()
    assert.equal(l2[0]?.body, 'alpha')

    // selectVectorDistance projects a real distance — exact match ⇒ ~0.
    const withDist = await adapter.query<{ body: string; dist: unknown }>(table)
      .whereVectorSimilarTo!('embedding', [1, 0, 0])
      .selectVectorDistance!('embedding', [1, 0, 0], 'dist')
      .get()
    assert.equal(withDist[0]?.body, 'alpha')
    assert.ok(Number(withDist[0]?.dist) < 1e-6, `expected ~0 distance, got ${String(withDist[0]?.dist)}`)

    // Write-time dimension guard still fronts the real column.
    await assert.rejects(
      Doc.create({ body: 'bad', embedding: [1, 2] as unknown as number[] }),
      /dimension/i,
    )
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
