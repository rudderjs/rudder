import { z, ZodType, ZodError } from 'zod'
import { ValidationError, type AppRequest, type AppResponse } from '@rudderjs/contracts'

// Re-export so existing `import { ValidationError } from '@rudderjs/core'`
// keeps working. The class itself now lives in `@rudderjs/contracts` so
// packages outside core (e.g. `@rudderjs/router`'s `.query(schema)` chain)
// can throw it without a circular core dependency.
export { ValidationError } from '@rudderjs/contracts'

// ─── Validation Response (short-circuit sentinel) ──────────

// Thrown by FormRequest.validate() when failedValidation() returns a Response.
// The framework's exception handler unwraps it and emits the wrapped Response
// directly. Mirrors how view-controller routes short-circuit with raw Response.
export class ValidationResponse extends Error {
  constructor(public response: Response) {
    super('Validation short-circuit')
    this.name = 'ValidationResponse'
  }
}

// ─── Form Request ──────────────────────────────────────────

export interface AfterContext<TData> {
  data:     TData
  req:      AppRequest
  addError: (path: string, message: string) => void
}

export type AfterCallback<TData> = (ctx: AfterContext<TData>) => void | Promise<void>

export type MessagesMap = Record<string, string | ((issue: z.core.$ZodRawIssue) => string)>

export abstract class FormRequest<T extends ZodType = ZodType> {
  protected req!: AppRequest

  abstract rules(): T

  authorize(): boolean {
    return true
  }

  // ─── Lifecycle hooks (default no-ops; override in subclass) ──

  /**
   * Normalize input **before** `authorize()` and schema validation. Pipeline
   * order: `prepareForValidation` → `authorize` → schema `parse` → `after` →
   * `passedValidation`. Use this to canonicalize values that `authorize()`
   * needs to read (e.g. lower-casing an email before a uniqueness check).
   *
   * Return the prepared input to replace `input` for the rest of the
   * pipeline, or return nothing to leave it unchanged. Async overrides are
   * awaited.
   */
  protected prepareForValidation(
    _input: Record<string, unknown>,
  ): Record<string, unknown> | void | Promise<Record<string, unknown> | void> {
    // default: no-op
  }

  protected after(): Array<AfterCallback<z.infer<T>>> {
    return []
  }

  /**
   * Final transform after schema validation succeeds. Return data to
   * **override** the validated value (the controller receives whatever you
   * return). Return nothing (or `undefined`) to use the schema's parsed
   * result unchanged.
   */
  protected passedValidation(_data: z.infer<T>): z.infer<T> | void | Promise<z.infer<T> | void> {
    // default: no-op
  }

  protected failedValidation(errors: Record<string, string[]>): never | Response | Promise<never | Response> {
    throw new ValidationError(errors)
  }

  protected messages(): MessagesMap {
    return {}
  }

  // ─── Pipeline ────────────────────────────────────────────

  async validate(req: AppRequest): Promise<z.infer<T>> {
    this.req = req

    let input: Record<string, unknown> = {
      ...(typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {}),
      ...req.query,
      ...req.params,
    }

    // prepareForValidation runs first so subclasses can normalize input that
    // authorize() then reads (matches Laravel's FormRequest::validateResolved
    // ordering). Awaited so async overrides work — without the await, a
    // returned Promise would pass `typeof === 'object'` and be assigned to
    // `input`, then the schema would fail with a confusing "expected object,
    // received object" error.
    const prepared = await this.prepareForValidation(input)
    if (prepared && typeof prepared === 'object') input = prepared

    if (!this.authorize()) {
      return this.fail({ auth: ['Unauthorized'] })
    }

    const errorMap = buildErrorMap(this.messages())
    const result = errorMap
      ? this.rules().safeParse(input, { error: errorMap })
      : this.rules().safeParse(input)

    if (!result.success) return this.fail(zodIssuesToErrors(result.error))

    const data = result.data as z.infer<T>
    const errors: Record<string, string[]> = {}
    const addError = (path: string, message: string) => {
      errors[path] = [...(errors[path] ?? []), message]
    }
    for (const cb of this.after()) {
      await cb({ data, req, addError })
    }
    if (Object.keys(errors).length > 0) return this.fail(errors)

    const post = await this.passedValidation(data)
    return (post && typeof post === 'object' ? post : data) as z.infer<T>
  }

  private async fail(errors: Record<string, string[]>): Promise<never> {
    const out = await this.failedValidation(errors)
    if (out instanceof Response) throw new ValidationResponse(out)
    throw new ValidationError(errors)
  }
}

// ─── Internal helpers ──────────────────────────────────────

function zodIssuesToErrors(err: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || 'root'
    errors[key] = [...(errors[key] ?? []), issue.message]
  }
  return errors
}

function buildErrorMap(messages: MessagesMap): z.core.$ZodErrorMap | undefined {
  const keys = Object.keys(messages)
  if (keys.length === 0) return undefined
  return (issue) => {
    // Match the key shape that ValidationError.errors uses — top-level
    // (no-path) issues land under `'root'`, not `''`. Override maps need to
    // use the same key the user sees in the rendered errors.
    const path = (issue.path ?? []).join('.') || 'root'
    const entry = messages[path]
    if (entry === undefined) return undefined
    return { message: typeof entry === 'function' ? entry(issue) : entry }
  }
}

// ─── validate helper ───────────────────────────────────────

export async function validate<T extends ZodType>(
  schema: T,
  req: AppRequest
): Promise<z.infer<T>> {
  const input = {
    ...(typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {}),
    ...req.query,
    ...req.params,
  }

  try {
    return schema.parse(input)
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(zodIssuesToErrors(err))
    }
    throw err
  }
}

// ─── validateWith middleware ───────────────────────────────

export function validateWith<T extends ZodType>(schema: T) {
  return async (
    req: AppRequest,
    _res: AppResponse,
    next: () => Promise<void>
  ) => {
    await validate(schema, req)
    await next()
  }
}

export { z } from 'zod'
