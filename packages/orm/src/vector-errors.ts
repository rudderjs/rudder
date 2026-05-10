/**
 * Error classes for `@rudderjs/orm`'s vector storage support (#B7 Phase 1).
 *
 * All extend native `Error` and carry stable `code` fields for app
 * `instanceof` + `.code` dispatch.
 */

/**
 * Thrown by the {@link vector} cast at write time when the vector being
 * persisted has a different number of dimensions than the column was
 * declared with.
 *
 * pgvector itself rejects dimension mismatches with `expected N
 * dimensions, not M` — a cryptic Prisma error. We pre-validate at the
 * cast layer so the throw points at the column name and the values.
 *
 * @example
 * ```ts
 * class Document extends Model {
 *   static casts = { embedding: vector({ dimensions: 1536 }) }
 * }
 * await Document.create({ embedding: [1, 2, 3] })
 * // → VectorDimensionMismatchError: column "embedding" expected 1536 dimensions, got 3
 * ```
 */
export class VectorDimensionMismatchError extends Error {
  readonly code = 'VECTOR_DIMENSION_MISMATCH' as const
  readonly column:   string
  readonly expected: number
  readonly actual:   number

  constructor(column: string, expected: number, actual: number) {
    super(
      `[RudderJS ORM] Vector column "${column}" expected ${expected} dimensions, got ${actual}.`,
    )
    this.name = 'VectorDimensionMismatchError'
    this.column   = column
    this.expected = expected
    this.actual   = actual
  }
}

/**
 * Thrown by an adapter when a vector query is attempted against a
 * backend that doesn't support pgvector — SQLite, MySQL, or Postgres
 * without the `vector` extension installed.
 *
 * v1 only supports Postgres + pgvector. Drizzle's adapter throws this
 * unconditionally until phase 3 implements pgvector for it. Prisma's
 * adapter throws when `$queryRaw` errors with a known
 * "operator/extension/type missing" pattern.
 *
 * Document loudly: "vector storage is Postgres-only in v1; install the
 * pgvector extension via `CREATE EXTENSION vector;` and ensure your
 * `@rudderjs/orm` adapter is `prisma`."
 */
export class VectorStorageUnsupportedError extends Error {
  readonly code = 'VECTOR_STORAGE_UNSUPPORTED' as const
  readonly adapter: string
  readonly hint?:   string

  constructor(adapter: string, hint?: string) {
    super(
      `[RudderJS ORM] Vector storage is not supported on the "${adapter}" adapter in this phase.${hint ? ` ${hint}` : ''}`,
    )
    this.name = 'VectorStorageUnsupportedError'
    this.adapter = adapter
    if (hint !== undefined) this.hint = hint
  }
}

/**
 * Thrown by `whereVectorSimilarTo(column, queryString, opts)` when the
 * `query` is a string (i.e. requesting auto-embed) but `opts.embedWith`
 * is not set.
 *
 * Mirrors the "fail loud on unknown model" pattern A6's
 * `assertKnownModelPricing` introduced — apps should never accidentally
 * hit a paid embeddings API by typo. Pass `embedWith: 'openai/text-embedding-3-small'`
 * (or your model of choice) to opt in.
 *
 * Auto-embed support itself lands in B7 Phase 2 alongside the
 * `similaritySearch()` agent tool — phase 1 throws this whenever a
 * string is passed.
 */
export class MissingEmbedderError extends Error {
  readonly code = 'VECTOR_MISSING_EMBEDDER' as const
  readonly column: string

  constructor(column: string) {
    super(
      `[RudderJS ORM] whereVectorSimilarTo("${column}", "<string>") requires opts.embedWith to be set ` +
      `(e.g. "openai/text-embedding-3-small"). Pass an embedded number[] directly to skip auto-embedding.`,
    )
    this.name = 'MissingEmbedderError'
    this.column = column
  }
}
