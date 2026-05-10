---
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm": minor
---

**B7 Phase 3 — Drizzle pgvector adapter + `make:migration --vector` helper. Closes B7.** Drizzle apps now have feature parity with `@rudderjs/orm-prisma` for vector queries (incl. Phase 2.5 chained `.where()` composition + auto-embed). New `make:migration --vector` flag scaffolds the `CREATE EXTENSION` + `ALTER TABLE` + HNSW index migration so apps don't have to hand-write it.

```ts
// 1. Schema (Drizzle)
import { pgTable, integer, text } from 'drizzle-orm/pg-core'
export const documents = pgTable('documents', {
  id:        integer('id').primaryKey(),
  content:   text('content'),
  embedding: text('embedding'),  // pgvector column — Drizzle has no native vector type yet
})

// 2. Generate the migration:
//    pnpm rudder make:migration --vector documents embedding 1536
//    → writes drizzle/20260511XXXXXX_add_embedding_vector_to_documents.sql

// 3. Use vector queries the same way as Prisma:
const docs = await Document
  .whereVectorSimilarTo('embedding', queryEmbedding, { minSimilarity: 0.7 })
  .where('tenantId', currentTenant)
  .limit(10)
  .get()

// 4. similaritySearch from @rudderjs/ai works against Drizzle Models too —
//    nothing changes at the agent layer.
```

`@rudderjs/orm-drizzle`:

- `whereVectorSimilarTo(col, query, opts?)` — accepts `number[]` (literal) or `string` (auto-embed via `opts.embedWith`). String form throws `MissingEmbedderError` if `embedWith` is missing; otherwise defers the embed to terminal time and lazy-loads `@rudderjs/ai` via `resolveOptionalPeer` (orm-drizzle adds `@rudderjs/ai` as an optional peer + `@rudderjs/support` as a regular dep — same wiring as orm-prisma).
- `selectVectorDistance(col, query, alias)` — projects the distance as a column on each row.
- Terminal `get()` / `first()` route to a new `_getViaVector` that issues raw SQL via `db.execute(sql\`...\`)`. Composes the chained WHERE clause by reusing the existing `buildConditions()`, so flat `.where()` / `.orWhere()` / soft-delete / `whereRelationExists`-EXISTS subqueries (Phase 2.5 parity) all flow into the SQL alongside the vector clause.
- Vector literal (`'[0.1,0.2,...]'::vector`) and user values bind through Drizzle's `sql` template — never string-interpolated. Operators come from a closed allow-list. Defense-in-depth SQL-injection test asserts a `'; DROP TABLE...` payload travels through bind params, not the SQL string.
- Errors: `db.execute()` missing on the driver → `VectorStorageUnsupportedError` with hint to use a Postgres driver; unknown column → same error class with the column name; pgvector extension/operator missing → wrapped with `CREATE EXTENSION` guidance message (matches orm-prisma).
- Still throws: `.orderBy()` (redundant — vector queries order by similarity), aggregates (`withCount` etc.), `count()` (vector queries are top-K, not count-shaped). `.with()` / `whereGroup` are silently no-ops on this adapter as they were before.

`@rudderjs/orm`:

- Extends the existing `make:migration` command with a `--vector <table> <column> <dimensions>` short-circuit (no new subpath — helpers live in `commands/migrate.ts`). Optional `--metric cosine|l2|inner-product` picks the HNSW index ops class.
- Generates an ORM-detected migration file: Prisma → `prisma/migrations/<ts>_add_<col>_vector_to_<table>/migration.sql`; Drizzle → `drizzle/<ts>_add_<col>_vector_to_<table>.sql`. Falls back to Drizzle layout when no ORM is detected.
- Prisma projects get a printed `schema.prisma` snippet showing `Unsupported("vector(N)")` + the `@@index([col(ops: VectorCosineOps)], type: Hnsw)` declaration, plus a reminder to enable the `postgresqlExtensions` preview feature.
- Exports `buildVectorMigrationSql`, `buildPrismaSchemaSnippet`, `parseVectorFlag`, `writeVectorMigration` for testing and for apps that want to compose the SQL into a hand-rolled migration.

**B7 closes with this PR.** Next Track B parity item is **B8** — hosted vector stores + `FileSearch` provider tool wrapping OpenAI/Gemini hosted stores. The local Prisma/Drizzle path B7 ships becomes B8's fallback when no hosted provider is configured.

Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (Phase 3 marked in flight; flips to ✓ shipped on merge).
