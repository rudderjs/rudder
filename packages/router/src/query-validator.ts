import { ZodType, ZodError } from 'zod'
import { ValidationError, type MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Build a middleware that validates `req.query` against a Zod schema.
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
 */
export function buildQueryValidator(schema: ZodType): MiddlewareHandler {
  return async (req, _res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      throw new ValidationError(zodIssuesToErrors(result.error))
    }
    ;(req as { query: unknown }).query = result.data
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
