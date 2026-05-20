import { ZodType, ZodError } from 'zod'
import { ValidationError, type MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Build a middleware that validates `req.body` against a Zod schema.
 *
 * - On success, `req.body` is **replaced in place** with the parsed result.
 *   This mirrors `buildQueryValidator`'s behavior so `z.coerce.*`,
 *   `z.transform()`, and `.default()` work end-to-end: the handler sees
 *   the parsed shape, not the raw JSON.
 * - On failure, throws `ValidationError` (rendered as HTTP 422 by core's
 *   exception handler). The error map mirrors FormRequest's shape:
 *   `{ [path]: string[] }`, with top-level issues under `'root'`.
 *
 * Used by `RouteBuilder.body(schema)` and the `{ body: schema }` opts form
 * on `Router.get/post/etc`. Server adapters populate `req.body` from JSON
 * and form-encoded payloads before middleware runs; this validator only
 * reads + replaces the already-parsed value.
 */
export function buildBodyValidator(schema: ZodType): MiddlewareHandler {
  return async (req, _res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      throw new ValidationError(zodIssuesToErrors(result.error))
    }
    ;(req as { body: unknown }).body = result.data
    await next()
  }
}

function zodIssuesToErrors(err: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || 'root'
    errors[key] = [...(errors[key] ?? []), issue.message]
  }
  return errors
}
