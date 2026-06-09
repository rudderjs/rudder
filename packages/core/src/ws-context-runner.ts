import { REQUEST_CONTEXT } from '@rudderjs/contracts'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { IncomingMessage } from 'node:http'

// ─── WebSocket-upgrade context runner ──────────────────────
//
// A WebSocket upgrade never flows through the HTTP request pipeline, so the
// session + auth AsyncLocalStorage scopes that an HTTP handler relies on are
// never established. `@rudderjs/sync`'s `onAuth(req, docName)` therefore ran
// with no ALS — `Auth.user()` / `Session.*` resolved to null, forcing apps to
// hand-roll cookie→session→user parsing (#1011 follow-up).
//
// This runner re-establishes that context: it synthesizes a minimal
// `AppRequest` from the raw Node `IncomingMessage`, builds a throwaway
// `AppResponse` (its Set-Cookie sink is discarded — there is no HTTP response
// on an upgrade), and runs ONLY the `REQUEST_CONTEXT`-tagged middleware from
// the `web` group (session + auth today) onion-style with the caller's
// callback as the terminal `next`. CSRF, rate-limit, and app middleware are
// deliberately NOT run — they assume a full HTTP request and would, e.g.,
// consume a rate-limit token per upgrade.
//
// Registered on `globalThis['__rudderjs_ws_context_runner__']` by core's
// `_createHandler()` (runs at `.create()` in dev AND prod). `@rudderjs/sync`
// reads the seam and routes `onAuth` through it when present, else runs raw
// (standalone / backward-compatible). It propagates throws — fail-closed is
// the caller's concern.

export type WsContextRunner = <T>(
  rawReq: IncomingMessage,
  fn: () => T | Promise<T>,
) => Promise<T>

const GLOBAL_KEY = '__rudderjs_ws_context_runner__'

/** Coerce Node's `string | string[] | undefined` header bag into the flat
 *  `Record<string, string>` shape `AppRequest` (and session/auth) expect. */
function normalizeHeaders(raw: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    // `cookie` is the only header session reads; Node already merges duplicate
    // cookie headers into one string. Arrays (e.g. set-cookie, never read here)
    // are joined with ', ' to match standard header folding.
    out[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  return out
}

/**
 * Build a minimal `AppRequest` from a Node `IncomingMessage` carrying only what
 * the context middleware read: headers (incl. `cookie`), url, method `'GET'`, a
 * mutable `raw: {}` bag (session writes `__rjs_session`, auth writes
 * `__rjs_user`), and `ip`. No body, no params — only session + auth run.
 */
export function synthesizeRequest(rawReq: IncomingMessage): AppRequest {
  const url = rawReq.url ?? '/'
  let pathname = url
  let query: Record<string, string> = {}
  const qIdx = url.indexOf('?')
  if (qIdx !== -1) {
    pathname = url.slice(0, qIdx)
    query = Object.fromEntries(new URLSearchParams(url.slice(qIdx + 1)).entries())
  }
  const req: Record<string, unknown> = {
    method:  'GET',
    url,
    path:    pathname,
    query,
    params:  {},
    headers: normalizeHeaders(rawReq.headers),
    body:    null,
    raw:     {},           // mutable bag for session/auth (__rjs_session / __rjs_user)
    ip:      rawReq.socket?.remoteAddress,
  }
  return req as unknown as AppRequest
}

/**
 * A throwaway `AppResponse` for the upgrade path. There is no HTTP response, so
 * status/header/json/send/redirect are no-ops and any Set-Cookie the session
 * middleware writes (a new-session cookie, or a redis TTL refresh) is discarded.
 *
 * `raw` is a `HonoContextLike`-compatible sink: `session.save()` reads `res.raw`,
 * and since it carries no finalized `.res` it falls to the `c.header(...)` branch
 * — which we no-op. See `@rudderjs/session`'s `SessionInstance.save()`.
 */
export function makeThrowawayResponse(): AppResponse {
  const res: AppResponse = {
    statusCode: 200,
    status() { return res },
    header() { return res },
    json() { /* discarded — no HTTP response on an upgrade */ },
    send() { /* discarded */ },
    redirect() { /* discarded */ },
    raw: { header() { /* Set-Cookie sink */ } },
  }
  return res
}

/**
 * Create a `WsContextRunner` closing over a (lazy) resolver of the `web` group.
 * Resolving lazily keeps the runner correct across dev HMR re-boots, which
 * rebuild the group middleware store.
 */
export function createWsContextRunner(
  resolveWebHandlers: () => MiddlewareHandler[],
): WsContextRunner {
  return async <T>(rawReq: IncomingMessage, fn: () => T | Promise<T>): Promise<T> => {
    const handlers = resolveWebHandlers().filter(
      (h) => (h as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] === true,
    )
    const req = synthesizeRequest(rawReq)
    const res = makeThrowawayResponse()

    let result: T | undefined
    let idx = 0
    const dispatch = async (): Promise<void> => {
      const handler = handlers[idx++]
      if (handler) {
        await handler(req, res, dispatch)
      } else {
        result = await fn()
      }
    }
    await dispatch()
    // If a context middleware short-circuited without calling next(), `fn`
    // never ran and `result` is undefined. Fail-closed is the caller's concern
    // (sync wraps the runner in `.catch(() => false)`).
    return result as T
  }
}

/** Register the runner on the globalThis seam. Idempotent — overwrites any
 *  prior registration (a dev re-boot installs a fresh resolver). */
export function registerWsContextRunner(resolveWebHandlers: () => MiddlewareHandler[]): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = createWsContextRunner(resolveWebHandlers)
}
