import { z, ZodType, ZodError } from 'zod'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// ─── Validation Error ──────────────────────────────────────

export class ValidationError extends Error {
  constructor(public errors: Record<string, string[]>) {
    super('Validation failed')
    this.name = 'ValidationError'
  }

  toJSON() {
    return {
      message: this.message,
      errors:  this.errors,
    }
  }
}

// ─── Form Request ──────────────────────────────────────────

export abstract class FormRequest<T extends ZodType = ZodType> {
  protected req!: AppRequest

  abstract rules(): T

  authorize(): boolean {
    return true
  }

  async validate(req: AppRequest): Promise<z.infer<T>> {
    this.req = req

    if (!this.authorize()) {
      throw new ValidationError({ auth: ['Unauthorized'] })
    }

    const input = {
      ...(typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {}),
      ...req.query,
      ...req.params,
    }

    try {
      return this.rules().parse(input) as z.infer<T>
    } catch (err) {
      if (err instanceof ZodError) {
        const errors: Record<string, string[]> = {}
        for (const issue of err.issues) {
          const key = issue.path.join('.') || 'root'
          errors[key] = [...(errors[key] ?? []), issue.message]
        }
        throw new ValidationError(errors)
      }
      throw err
    }
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
      const errors: Record<string, string[]> = {}
      for (const issue of err.issues) {
        const key = issue.path.join('.') || 'root'
        errors[key] = [...(errors[key] ?? []), issue.message]
      }
      throw new ValidationError(errors)
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
