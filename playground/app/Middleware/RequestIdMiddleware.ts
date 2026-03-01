import { Middleware } from '@forge/middleware'
import type { ForgeRequest, ForgeResponse } from '@forge/server'

/**
 * Example global middleware.
 *
 * Attaches a unique X-Request-Id header to every response.
 * Useful for distributed tracing and log correlation.
 *
 * Registered globally in bootstrap/app.ts via withMiddleware().
 */
export class RequestIdMiddleware extends Middleware {
  async handle(req: ForgeRequest, res: ForgeResponse, next: () => Promise<void>): Promise<void> {
    // console.log('RequestIdMiddleware: handling request')
    const id = req.headers['x-request-id'] ?? crypto.randomUUID()
    ;(req as Record<string, unknown>)['requestId'] = id
    await next()
    res.header('X-Request-Id', id)
  }
}
