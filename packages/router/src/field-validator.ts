import { ValidationError, standardValidate, type StandardSchemaV1, type MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Build a middleware that validates a single request field (`body` or `query`)
 * against a **Standard Schema** validator (Zod by default — any `~standard`
 * validator works). Shared implementation behind {@link buildBodyValidator}
 * and {@link buildQueryValidator} so the two paths can never diverge.
 *
 * - On success, the field is **replaced in place** with the parsed result, so
 *   `z.coerce.*`, `z.transform()`, and `.default()` work end-to-end: the
 *   handler sees the parsed shape, not the raw input.
 * - On failure, throws `ValidationError` (rendered as HTTP 422 by core's
 *   exception handler). The error map mirrors FormRequest's shape:
 *   `{ [path]: string[] }`, with top-level issues under `'root'`.
 */
export function buildFieldValidator(field: 'body' | 'query', schema: StandardSchemaV1): MiddlewareHandler {
  return async (req, _res, next) => {
    const target = req as unknown as Record<string, unknown>
    const result = await standardValidate(schema, target[field])
    if (result.errors) {
      throw new ValidationError(result.errors)
    }
    target[field] = result.value
    await next()
  }
}
