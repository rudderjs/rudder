import type { MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Attaches a unique X-Request-Id header to every response.
 * Useful for distributed tracing and log correlation.
 */
export const requestIdMiddleware: MiddlewareHandler = async (req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID()
  await next()
  res.header('X-Request-Id', id)
}
