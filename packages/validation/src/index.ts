import { z, ZodType, ZodError } from 'zod'
import type { ForgeRequest } from '@forge/server'

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
  protected req!: ForgeRequest

  /** Define the Zod schema for this request */
  abstract rules(): T

  /** Optional: authorization check */
  authorize(): boolean {
    return true
  }

  /** Validate and return typed data */
  async validate(req: ForgeRequest): Promise<z.infer<T>> {
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

// ─── Validate helper (inline, no class needed) ─────────────

export async function validate<T extends ZodType>(
  schema: T,
  req: ForgeRequest
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

// ─── Validation Middleware ─────────────────────────────────

export function validateWith<T extends ZodType>(
  schema: T
) {
  return async (
    req: ForgeRequest,
    _res: import('@forge/server').ForgeResponse,
    next: () => Promise<void>
  ) => {
    await validate(schema, req)
    await next()
  }
}

// ─── Re-export zod for convenience ────────────────────────

export { z } from 'zod'