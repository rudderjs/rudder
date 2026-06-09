import {
  attachInputAccessors,
  REQUEST_CONTEXT,
  type AppRequest,
  type AppResponse,
  type MiddlewareHandler,
} from '@rudderjs/contracts'

// ─── WebSocket-upgrade request context runner ──────────────
//
// A sync `onAuth(req, docName)` callback runs on every WS upgrade (since
// @rudderjs/sync 1.5.x) but receives only raw headers + url — no
// AsyncLocalStorage context — so the idiomatic resolver `() => Auth.user()`
// returns null (the HTTP auth middleware never ran on the upgrade path).
//
// This runner establishes the same request-scoped context an HTTP request gets
// — the session + auth ALS scopes — then runs the `onAuth` decision inside it,
// so `Auth.user()` / `Session.*` "just work" with no app-side cookie parsing.
//
// It runs ONLY the `web` group middleware tagged `REQUEST_CONTEXT` (session,
// auth), not the whole group: CSRF / rate-limit / arbitrary app middleware
// assume a full HTTP req/res and would mis-fire on an upgrade (rate-limit would
// consume a token per upgrade). Each context middleware wraps `next()` in its
// own ALS `.run(...)`, so running the chain with the decision as the terminal
// `next` places it inside both the session and auth ALS — no middleware change
// beyond the marker.
//
// Registered on `globalThis['__rudderjs_ws_context_runner__']` by core's
// `_createHandler()` (dev + prod). `@rudderjs/sync` reads the seam off
// globalThis and routes `onAuth` through it when present (fail-closed); absent
// (standalone sync, no server adapter) → `onAuth` runs raw, today's behavior.

/**
 * The subset of a Node `http.IncomingMessage` the runner reads. Typed locally
 * (not imported from `node:http`) so this module stays free of static `node:`
 * imports — it's lazy-imported on the server-only `_createHandler()` path.
 */
export interface MinimalIncomingMessage {
  headers: Record<string, string | string[] | undefined>
  url?: string
  socket?: { remoteAddress?: string | undefined } | undefined
}

export type WsContextRunner = <T>(
  rawReq: MinimalIncomingMessage,
  fn: () => T | Promise<T>,
) => Promise<T>

/** Flatten Node's `string | string[] | undefined` header bag to `Record<string,string>`. */
function normalizeHeaders(raw: MinimalIncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

/**
 * Synthesize a minimal `AppRequest` from a Node upgrade request. Carries only
 * what the context middleware read: `headers` (incl. `cookie`), `url`, a mutable
 * `raw` bag (session writes `__rjs_session`, auth writes `__rjs_user`), and
 * `ip`. No body / params / query — only session + auth run, not a routed
 * handler.
 */
function synthesizeRequest(rawReq: MinimalIncomingMessage): AppRequest {
  const url = rawReq.url ?? '/'
  const req: Record<string, unknown> = {
    method:  'GET',
    url,
    path:    (url.split('?')[0] ?? url),
    query:   {},
    params:  {},
    headers: normalizeHeaders(rawReq.headers),
    body:    undefined,
    raw:     {}, // mutable bag — session/auth stash __rjs_session / __rjs_user here
  }
  const ip = rawReq.socket?.remoteAddress
  if (ip !== undefined) req['ip'] = ip
  attachInputAccessors(req)
  return req as unknown as AppRequest
}

/**
 * Throwaway `AppResponse`. An upgrade has no HTTP response, so the session
 * middleware's return-path `session.save(res)` (which appends `Set-Cookie`)
 * writes into a sink that is discarded. `res.raw` mimics the Hono-context shape
 * `SessionInstance.save()` duck-types (`.res` falsy → it calls `.header()`,
 * a no-op here).
 */
function throwawayResponse(): AppResponse {
  const res: AppResponse = {
    raw:        { res: undefined, header: () => {} },
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    header()     { return this },
    json()       { /* discarded — onAuth returns a boolean, not a response */ },
    send()       { /* discarded */ },
    redirect()   { /* discarded */ },
  }
  return res
}

/**
 * Build the runner, closing over the resolved `web` group. Filters to the
 * `REQUEST_CONTEXT`-tagged middleware (order preserved) and runs them onion-style
 * with `fn` as the terminal step, returning `fn`'s result. Throws from a
 * middleware or from `fn` propagate — fail-closed is the caller's concern.
 */
export function createWsContextRunner(webGroup: MiddlewareHandler[]): WsContextRunner {
  const contextMw = webGroup.filter(
    (fn) => (fn as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] === true,
  )

  return async function wsContextRunner<T>(
    rawReq: MinimalIncomingMessage,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    const req = synthesizeRequest(rawReq)
    const res = throwawayResponse()

    let result: T
    let idx = 0
    const next = async (): Promise<void> => {
      const mw = contextMw[idx++]
      if (mw) {
        await mw(req, res, next)
      } else {
        // All context middleware established their ALS scope — run the decision
        // inside them. `result` is captured before the outer await returns.
        result = await fn()
      }
    }
    await next()
    return result!
  }
}
