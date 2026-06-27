import { type StandardSchemaV1, type MiddlewareHandler } from '@rudderjs/contracts'
import { buildFieldValidator } from './field-validator.js'

/**
 * Build a middleware that validates `req.query` against a **Standard Schema**
 * validator (Zod by default — any `~standard` validator works).
 *
 * - On success, `req.query` is **replaced in place** with the parsed result.
 *   This is what makes `z.coerce.number()` work end-to-end: the handler sees
 *   `req.query.page` as a `number`, not the original string.
 * - On failure, throws `ValidationError` (rendered as HTTP 422 by core's
 *   exception handler). The error map mirrors FormRequest's shape:
 *   `{ [path]: string[] }`, with top-level issues under `'root'`.
 *
 * Used by `RouteBuilder.query(schema)` and the `{ query: schema }` opts form
 * on `Router.get/post/etc`.
 *
 * Thin wrapper over the shared {@link buildFieldValidator}.
 */
export function buildQueryValidator(schema: StandardSchemaV1): MiddlewareHandler {
  return buildFieldValidator('query', schema)
}
