import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ServiceProvider, app, config, appendToGroup } from '@rudderjs/core'
import { reusableConnection } from '@rudderjs/support'
import { REQUEST_CONTEXT } from '@rudderjs/contracts'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'

// Side-effect import — pulls in the Vike.PageContext.flash augmentation so
// app code can read pageContext.flash with full typing.
import './types/vike.js'

// ─── Module Augmentation ───────────────────────────────────

declare module '@rudderjs/contracts' {
  interface AppRequest {
    session: SessionInstance
  }
}

// ─── Config ────────────────────────────────────────────────

export interface SessionConfig {
  driver:   'cookie' | 'redis'
  lifetime: number    // minutes, default 120
  secret:   string
  cookie: {
    name:     string  // default 'rudderjs_session'
    secure:   boolean
    httpOnly: boolean
    sameSite: 'lax' | 'strict' | 'none'
    path:     string
  }
  redis?: {
    prefix?:   string
    url?:      string
    host?:     string
    port?:     number
    password?: string
  }
}

// ─── Internal Payload ──────────────────────────────────────

interface SessionPayload {
  id:         string
  data:       Record<string, unknown>
  flash_next: Record<string, unknown>
}

// ─── Internal Driver Interface ─────────────────────────────

interface InternalDriver {
  /** Load payload from the raw cookie value (undefined = no cookie). */
  load(cookieValue: string | undefined): Promise<SessionPayload>
  /** Persist payload and return the value to store in the cookie. */
  persist(payload: SessionPayload, ttlSeconds: number): Promise<string>
  /** Destroy a session by ID. */
  destroy(id: string): Promise<void>
}

// ─── Internal: Hono context + req.raw bag helpers ──────────

/** Narrow shape of `res.raw` — Hono's `c`. We only use header() and the
 *  optional finalized Response so we can append Set-Cookie in place. */
interface HonoContextLike {
  header(k: string, v: string): void
  res?: Response
}

const SESSION_KEY = '__rjs_session'

/** Stash the per-request SessionInstance on the underlying server context
 *  (req.raw = Hono's `c`) so a later normalizeRequest(c) in registerRoute
 *  sees the same instance. Centralized so the property bag cast lives in
 *  exactly one place. */
function attachSession(req: AppRequest, session: SessionInstance): void {
  ;(req.raw as Record<string, unknown>)[SESSION_KEY] = session
}

// ─── SessionInstance ───────────────────────────────────────

export class SessionInstance {
  private _data:      Record<string, unknown>
  private _flash:     Record<string, unknown>
  private _flashNext: Record<string, unknown>
  private _id:        string
  private _dirty = false
  private readonly _driver: InternalDriver
  private readonly _config: SessionConfig

  constructor(payload: SessionPayload, driver: InternalDriver, config: SessionConfig) {
    // Default missing fields rather than trusting the shape — legacy and
    // corrupt redis entries (or third-party writes) may omit flash_next or
    // data entirely, and crashing the constructor takes the whole request
    // down on every load.
    const flashPrev = payload.flash_next ?? {}
    this._id        = payload.id
    this._data      = { ...(payload.data ?? {}) }
    this._flash     = { ...flashPrev }  // prev flash_next → current flash
    this._flashNext = {}
    this._driver    = driver
    this._config    = config
    // Flash data was consumed — mark dirty so save() clears it from the cookie
    if (Object.keys(flashPrev).length > 0) this._dirty = true
  }

  get<T>(key: string, fallback?: T): T | undefined {
    return (key in this._data ? this._data[key] : fallback) as T | undefined
  }

  put(key: string, value: unknown): void {
    this._data[key] = value
    this._dirty = true
  }

  forget(key: string): void {
    delete this._data[key]
    this._dirty = true
  }

  flush(): void {
    this._data = {}
    this._dirty = true
  }

  /** Store a value that will be readable on the *next* request via getFlash(). */
  flash(key: string, value: unknown): void {
    this._flashNext[key] = value
    this._dirty = true
  }

  /** Read a flash value set by the *previous* request. */
  getFlash<T>(key: string, fallback?: T): T | undefined {
    return (key in this._flash ? this._flash[key] : fallback) as T | undefined
  }

  /**
   * Return a copy of every flash value set by the *previous* request.
   * Useful for serializing flash messages into pageContext for SSR views.
   */
  allFlash(): Record<string, unknown> {
    return { ...this._flash }
  }

  has(key: string): boolean {
    return key in this._data
  }

  all(): Record<string, unknown> {
    return { ...this._data }
  }

  id(): string {
    return this._id
  }

  /**
   * Mint a fresh session id and best-effort destroy the prior one server-side.
   *
   * **Cookie driver caveat (`session.driver = 'cookie'`):** the previous
   * cookie remains valid until its `Max-Age` expires. The cookie driver is
   * stateless — there is no server-side store to delete from — so a stolen
   * pre-regenerate cookie can still be replayed within its TTL. Apps that
   * need true post-logout invalidation (or fixation defense beyond
   * "rotate the id on login") must use the redis driver, where `destroy()`
   * actually removes the key. See README "Sessions" → "Driver tradeoffs".
   */
  async regenerate(): Promise<void> {
    await this._driver.destroy(this._id)
    this._id = randomUUID()
    this._dirty = true
  }

  /** Whether the session data has been modified since loading. */
  isDirty(): boolean { return this._dirty }

  /** @internal — force the session to be saved (e.g. new sessions, flash consumption). */
  markDirty(): void { this._dirty = true }

  async save(res: AppResponse): Promise<void> {
    if (!this._dirty) return  // skip Set-Cookie if session wasn't modified

    const payload: SessionPayload = {
      id:         this._id,
      data:       this._data,
      flash_next: this._flashNext,
    }
    const ttl         = this._config.lifetime * 60
    const cookieValue = await this._driver.persist(payload, ttl)
    const cookieStr   = buildCookieHeader(this._config.cookie.name, cookieValue, this._config)
    const c = res.raw as HonoContextLike
    if (c.res) {
      // Response already finalized — append to its headers in place. Mutating
      // c.res.headers preserves multi-value Set-Cookie; cloning via
      // `new Response(body, { headers })` collapses repeats to a single value
      // in Node's undici-backed fetch implementation.
      c.res.headers.append('Set-Cookie', cookieStr)
    } else {
      c.header('Set-Cookie', cookieStr)
    }
  }
}

// ─── AsyncLocalStorage + Session Facade ───────────────────

const _als = new AsyncLocalStorage<SessionInstance>()

export class Session {
  private static current(): SessionInstance {
    const s = _als.getStore()
    if (!s) {
      throw new Error(
        '[RudderJS Session] Session.current() called with no session in context. ' +
        'sessionMiddleware auto-installs only on the "web" route group — API routes ' +
        'are stateless. Use Session.maybeCurrent() for a non-throwing read, or mount ' +
        'sessionMiddleware() per-route on the api side if you really need it.',
      )
    }
    return s
  }

  /** Non-throwing accessor — returns null when no session is in context. */
  static maybeCurrent(): SessionInstance | null {
    return _als.getStore() ?? null
  }

  /** Whether a session is currently in context. */
  static active(): boolean {
    return _als.getStore() !== undefined
  }

  static get<T>(key: string, fallback?: T): T | undefined {
    return this.current().get<T>(key, fallback)
  }

  static put(key: string, value: unknown): void {
    this.current().put(key, value)
  }

  static forget(key: string): void {
    this.current().forget(key)
  }

  static flash(key: string, value: unknown): void {
    this.current().flash(key, value)
  }

  static getFlash<T>(key: string, fallback?: T): T | undefined {
    return this.current().getFlash<T>(key, fallback)
  }

  /** All flash values set by the previous request. Returns `{}` outside an ALS session context. */
  static allFlash(): Record<string, unknown> {
    return this.maybeCurrent()?.allFlash() ?? {}
  }

  static has(key: string): boolean {
    return this.current().has(key)
  }

  static all(): Record<string, unknown> {
    return this.current().all()
  }

  static regenerate(): Promise<void> {
    return this.current().regenerate()
  }
}

/**
 * Test-only — run `fn` inside a session ALS context populated by `session`.
 * Lets unit tests in other packages (e.g. `@rudderjs/socialite`) exercise
 * code paths that go through the `Session` static facade (CSRF helpers,
 * OAuth state) without standing up the full request middleware. The
 * underscore-prefix is the "don't use this in app code" signal — kept in
 * the public types because consuming packages' test suites depend on it.
 * NOT for production code.
 */
export function _runWithSession<T>(session: SessionInstance, fn: () => T): T {
  return _als.run(session, fn)
}

// ─── Sign / Verify primitives ──────────────────────────────

// Generic HMAC-SHA256 sign+verify shared by both drivers. Cookie driver signs
// the base64url-encoded JSON payload; redis driver signs the session ID alone
// so a stolen UUID can't be replayed and an attacker-supplied ID can't fixate
// onto a victim's session.
function sign(value: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(value).digest('base64url')
  return `${value}.${hmac}`
}

function verify(signed: string, secret: string): string | null {
  const dotIdx = signed.lastIndexOf('.')
  if (dotIdx === -1) return null
  const value = signed.slice(0, dotIdx)
  const hmac  = signed.slice(dotIdx + 1)
  const expected = createHmac('sha256', secret).update(value).digest('base64url')
  const expectedBuf = Buffer.from(expected, 'base64url')
  const hmacBuf     = Buffer.from(hmac,     'base64url')
  if (expectedBuf.length !== hmacBuf.length) return null
  return timingSafeEqual(expectedBuf, hmacBuf) ? value : null
}

// ─── Cookie Driver ─────────────────────────────────────────

function signPayload(payload: SessionPayload, secret: string): string {
  return sign(Buffer.from(JSON.stringify(payload)).toString('base64url'), secret)
}

/** Parse a JSON-encoded payload with minimal shape narrowing. Returns null
 *  for malformed JSON or any payload missing a string `id`. Shared by both
 *  drivers so the structural cast lives in one place; `SessionInstance`'s
 *  constructor still defends against missing `data`/`flash_next`. */
function parsePayload(raw: string): SessionPayload | null {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return null }
  if (obj === null || typeof obj !== 'object') return null
  const r = obj as Record<string, unknown>
  return typeof r['id'] === 'string' ? (r as unknown as SessionPayload) : null
}

function verifyPayload(cookieValue: string, secret: string): SessionPayload | null {
  const b64 = verify(cookieValue, secret)
  if (b64 === null) return null
  return parsePayload(Buffer.from(b64, 'base64url').toString('utf8'))
}

class CookieDriver implements InternalDriver {
  constructor(private readonly secret: string) {}

  async load(cookieValue: string | undefined): Promise<SessionPayload> {
    if (!cookieValue) return this.empty()
    return verifyPayload(cookieValue, this.secret) ?? this.empty()
  }

  async persist(payload: SessionPayload, _ttl: number): Promise<string> {
    return signPayload(payload, this.secret)
  }

  async destroy(_id: string): Promise<void> {
    // Cookie driver is stateless — there is no server-side store to delete
    // from. The pre-regenerate cookie therefore remains valid until its
    // Max-Age expires; this is documented on `SessionInstance.regenerate()`.
    // Apps that need true post-logout invalidation must use the redis driver.
  }

  private empty(): SessionPayload {
    return { id: randomUUID(), data: {}, flash_next: {} }
  }
}

// ─── Redis Driver ──────────────────────────────────────────

type RedisClient = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
  quit(): Promise<unknown>
}

/** @internal Exported for tests; not part of the public API. */
export class RedisDriver implements InternalDriver {
  // Cache the *promise* of a client, not the client itself. With a raw
  // `if (!this.client)` guard, two concurrent first-request callers would
  // both fall through and each construct a new ioredis instance — the
  // second overwrites the first, leaking the first connection's FD and
  // its retry timer. Caching the promise means concurrent callers all
  // await the same in-flight connect.
  private clientPromise: Promise<RedisClient> | null = null
  private readonly prefix: string

  constructor(
    private readonly redisConfig: NonNullable<SessionConfig['redis']>,
    private readonly secret: string,
  ) {
    this.prefix = redisConfig.prefix ?? 'session:'
  }

  private getClient(): Promise<RedisClient> {
    if (!this.clientPromise) {
      // Reuse one ioredis client across dev HMR re-boots — SessionProvider.boot()
      // rebuilds this RedisDriver on every edit, so without reuse each re-boot
      // opens (and leaks) a fresh Redis connection. See reusableConnection().
      const signature = this.redisConfig.url
        ?? `${this.redisConfig.host ?? '127.0.0.1'}:${this.redisConfig.port ?? 6379}:${this.redisConfig.password ?? ''}`
      this.clientPromise = reusableConnection<RedisClient>(
        '__rudderjs_session_redis__',
        signature,
        async () => {
          const mod = await import('ioredis') as unknown as {
            Redis: new (opts: string | { host?: string; port?: number; password?: string | undefined }) => RedisClient
          }
          return this.redisConfig.url
            ? new mod.Redis(this.redisConfig.url)
            : new mod.Redis({
                host:     this.redisConfig.host     ?? '127.0.0.1',
                port:     this.redisConfig.port     ?? 6379,
                password: this.redisConfig.password,
              })
        },
        (client) => client.quit(),
      )
      // If the import or constructor throws, drop the rejected promise so
      // the next call retries instead of permanently caching the failure.
      this.clientPromise.catch(() => { this.clientPromise = null })
    }
    return this.clientPromise
  }

  private key(id: string): string { return `${this.prefix}${id}` }

  async load(cookieValue: string | undefined): Promise<SessionPayload> {
    if (!cookieValue) return this.empty()
    // Verify HMAC before touching redis. An attacker who plants an unsigned
    // ID — or guesses one — never reaches the redis lookup, and a cache miss
    // on a valid signature still creates a fresh ID rather than fixating on
    // the cookie-supplied value.
    const id = verify(cookieValue, this.secret)
    if (id === null) return this.empty()
    try {
      const client = await this.getClient()
      const raw    = await client.get(this.key(id))
      if (!raw) return this.empty()
      return parsePayload(raw) ?? this.empty()
    } catch {
      return this.empty()
    }
  }

  async persist(payload: SessionPayload, ttl: number): Promise<string> {
    const client = await this.getClient()
    await client.set(this.key(payload.id), JSON.stringify(payload), 'EX', ttl)
    return sign(payload.id, this.secret)
  }

  async destroy(id: string): Promise<void> {
    try {
      const client = await this.getClient()
      await client.del(this.key(id))
    } catch {
      // ignore
    }
  }

  private empty(): SessionPayload {
    return { id: randomUUID(), data: {}, flash_next: {} }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const k = part.slice(0, eqIdx).trim()
    if (k === name) return part.slice(eqIdx + 1).trim()
  }
  return undefined
}

function buildCookieHeader(name: string, value: string, config: SessionConfig): string {
  const parts = [
    `${name}=${value}`,
    `Path=${config.cookie.path}`,
    `Max-Age=${config.lifetime * 60}`,
    `SameSite=${config.cookie.sameSite}`,
  ]
  if (config.cookie.httpOnly) parts.push('HttpOnly')
  if (config.cookie.secure)   parts.push('Secure')
  return parts.join('; ')
}

function makeDriver(config: SessionConfig): InternalDriver {
  if (config.driver === 'redis') return new RedisDriver(config.redis ?? {}, config.secret)
  return new CookieDriver(config.secret)
}

// ─── Session Middleware ────────────────────────────────────

export function sessionMiddleware(config: SessionConfig): MiddlewareHandler {
  const driver = makeDriver(config)

  const fn = async function SessionMiddleware(req: AppRequest, res: AppResponse, next: () => Promise<void>) {
    const cookieHeader = req.headers['cookie'] ?? ''
    const cookieValue  = parseCookie(cookieHeader, config.cookie.name)
    const payload      = await driver.load(cookieValue)
    const session      = new SessionInstance(payload, driver, config)
    // New session (no cookie yet) — always write Set-Cookie to establish the session
    if (!cookieValue) session.markDirty()

    // Store on the underlying server context (req.raw = Hono's c) so that any
    // normalizeRequest(c) call — including the one in registerRoute — sees it.
    attachSession(req, session)

    // Persist regardless of whether next() throws — flash messages on error
    // redirects, new sessions on error responses, and regenerate() must
    // survive a thrown handler. Save errors only surface when next() did not
    // already throw, so the original exception isn't masked by a redis blip.
    let nextErrored = false
    let nextErr: unknown
    try {
      await _als.run(session, next)
    } catch (err) {
      nextErrored = true
      nextErr = err
    }
    try {
      await session.save(res)
    } catch (saveErr) {
      if (!nextErrored) {
        nextErrored = true
        nextErr = saveErr
      }
    }
    if (nextErrored) throw nextErr
  }

  // Tag as a request-scoped-context middleware. The framework's WS-upgrade
  // context runner runs only REQUEST_CONTEXT-tagged web middleware around a
  // sync `onAuth` callback, so `Session.*` resolves on an upgrade exactly as
  // in an HTTP handler (without CSRF / rate-limit / app middleware running).
  ;(fn as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = true
  return fn
}

// ─── Zero-config middleware (reads config from DI) ─────────

/**
 * Session middleware that reads its config from the DI container.
 * Requires session() provider to be registered in bootstrap/providers.ts.
 *
 * Resolves the singleton middleware bound by `SessionProvider.boot()` to
 * `session.middleware`, so per-route opt-ins on api routes share the same
 * driver — and the same redis connection — as the auto-installed web group
 * middleware. Constructing a fresh `sessionMiddleware(cfg)` per call would
 * spin up a new RedisDriver (and a new ioredis connection) per route.
 *
 * Usage in routes:
 *   import { SessionMiddleware } from '@rudderjs/session'
 *   Route.get('/path', handler, [SessionMiddleware()])
 */
export function SessionMiddleware(): MiddlewareHandler {
  return app().make<MiddlewareHandler>('session.middleware')
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a SessionServiceProvider class configured for the given session config.
 *
 * Built-in drivers:  cookie (signed HMAC — no external deps)
 *                    redis  (requires ioredis: pnpm add ioredis)
 *
 * Usage in bootstrap/providers.ts:
 *   import { session } from '@rudderjs/session'
 *   import configs from '../config/index.js'
 *   export default [..., session(configs.session), ...]
 *
 * `sessionMiddleware(cfg)` is automatically appended to the `web` route group —
 * it runs on every web route but NOT on api routes (which are stateless by default).
 * API routes that need session can opt in explicitly by adding SessionMiddleware()
 * to their route's middleware array.
 */
export class SessionProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<SessionConfig>('session')
    this.app.instance('session.config', cfg)
    const mw = sessionMiddleware(cfg)
    this.app.instance('session.middleware', mw)
    this.app.instance('session.facade', Session)

    // Auto-install on the web route group. Web routes (Vike pages, forms, auth
    // flow) need session; api routes are stateless. Apps that want session on
    // api routes can call SessionMiddleware() per-route.
    appendToGroup('web', mw)

    // Register a Vike page-context enhancer so views can read flash messages
    // from `pageContext.flash`. `@rudderjs/vite` is an optional peer — apps
    // without it (API-only services) silently skip this registration.
    await registerVikeFlashEnhancer()
  }
}

async function registerVikeFlashEnhancer(): Promise<void> {
  try {
    const mod = await import('@rudderjs/vite/page-context-enhancers').catch(() => null) as
      | { registerPageContextEnhancer?: (fn: (pc: { flash?: Record<string, unknown> }) => void) => void }
      | null
    if (!mod?.registerPageContextEnhancer) return

    mod.registerPageContextEnhancer((pageContext) => {
      pageContext.flash = Session.allFlash()
    })
  } catch {
    // Optional peer not installed — quietly skip.
  }
}
