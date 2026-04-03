import { Middleware } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

/**
 * Attaches a unique X-Request-Id header to every response.
 * Useful for distributed tracing and log correlation.
 *
 * Registered globally in bootstrap/app.ts via withMiddleware().
 */
export class RequestIdMiddleware extends Middleware {
  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>): Promise<void> {
    const id = req.headers['x-request-id'] ?? crypto.randomUUID()
    ;(req as unknown as Record<string, unknown>)['requestId'] = id
    await next()
    res.header('X-Request-Id', id)
  }
}
