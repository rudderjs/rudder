import type { MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Capture the raw request body BEFORE any JSON parser touches it. Paddle's
 * `Paddle-Signature` HMAC is computed over the exact bytes Paddle sent, so
 * any reformatting (key reordering, whitespace normalization) breaks the
 * signature.
 *
 * Stashes:
 *   req.raw.__rjs_paddle_raw_body  — string (utf8) of the raw body
 *   req.raw.__rjs_paddle_payload   — parsed JSON for downstream handlers
 *
 * Mounted only on the webhook route — global use would defeat hono's normal
 * JSON parsing for everything else.
 */
export function captureRawBody(): MiddlewareHandler {
  return async function captureRawBody(req, _res, next) {
    const raw = req.raw as { __rjs_paddle_raw_body?: string; __rjs_paddle_payload?: Record<string, unknown>; request?: Request; req?: Request }

    if (!raw.__rjs_paddle_raw_body) {
      // Universal-middleware adapters expose the underlying Web Request as
      // `request` (server-hono) or `req`. Fall back to whatever's truthy.
      const webReq = raw.request ?? raw.req
      let bodyText = ''
      try {
        if (webReq && typeof (webReq as Request).clone === 'function') {
          bodyText = await (webReq as Request).clone().text()
        }
      } catch { /* fall through */ }

      raw.__rjs_paddle_raw_body = bodyText
      try {
        raw.__rjs_paddle_payload = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {}
      } catch (err) {
        console.error('[RudderJS Cashier] Failed to parse webhook body as JSON:', err)
        raw.__rjs_paddle_payload = {}
      }
    }

    await next()
  }
}
