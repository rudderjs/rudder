import { createHmac, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ServiceProvider, type Application, app } from '@boostkit/core'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@boostkit/contracts'

// ─── Module Augmentation ───────────────────────────────────

declare module '@boostkit/contracts' {
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
    name:     string  // default 'boostkit_session'
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
    this._id        = payload.id
    this._data      = { ...payload.data }
    this._flash     = { ...payload.flash_next }  // prev flash_next → current flash
    this._flashNext = {}
    this._driver    = driver
    this._config    = config
    // Flash data was consumed — mark dirty so save() clears it from the cookie
    if (Object.keys(payload.flash_next).length > 0) this._dirty = true
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

  has(key: string): boolean {
    return key in this._data
  }

  all(): Record<string, unknown> {
    return { ...this._data }
  }

  id(): string {
    return this._id
  }

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
    const c = res.raw as Record<string, unknown> & { header(k: string, v: string): void; res?: Response }
    if (c.res) {
      // Response already finalized — clone with Set-Cookie header
      const newHeaders = new Headers(c.res.headers)
      newHeaders.append('Set-Cookie', cookieStr)
      c.res = new Response(c.res.body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      })
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
    if (!s) throw new Error('[BoostKit Session] No session in context. Use sessionMiddleware.')
    return s
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

// ─── Cookie Driver ─────────────────────────────────────────

function signPayload(payload: SessionPayload, secret: string): string {
  const b64  = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const hmac = createHmac('sha256', secret).update(b64).digest('base64url')
  return `${b64}.${hmac}`
}

function verifyPayload(cookieValue: string, secret: string): SessionPayload | null {
  const dotIdx = cookieValue.lastIndexOf('.')
  if (dotIdx === -1) return null
  const b64  = cookieValue.slice(0, dotIdx)
  const hmac = cookieValue.slice(dotIdx + 1)
  const expected = createHmac('sha256', secret).update(b64).digest('base64url')
  // Constant-time comparison
  if (expected.length !== hmac.length) return null
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= (expected.codePointAt(i) ?? 0) ^ (hmac.codePointAt(i) ?? 0)
  }
  if (mismatch !== 0) return null
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as SessionPayload
  } catch {
    return null
  }
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
    // Cookie driver: nothing to destroy server-side
  }

  private empty(): SessionPayload {
    return { id: randomUUID(), data: {}, flash_next: {} }
  }
}

// ─── Redis Driver ──────────────────────────────────────────

class RedisDriver implements InternalDriver {
  private client: unknown
  private readonly prefix: string

  constructor(private readonly config: NonNullable<SessionConfig['redis']>) {
    this.prefix = config.prefix ?? 'session:'
  }

  private async getClient(): Promise<{
    get(key: string): Promise<string | null>
    set(key: string, value: string, ...args: unknown[]): Promise<unknown>
    del(...keys: string[]): Promise<unknown>
  }> {
    if (!this.client) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Redis } = await import('ioredis') as any
      this.client = this.config.url
        ? new Redis(this.config.url)
        : new Redis({
            host:     this.config.host     ?? '127.0.0.1',
            port:     this.config.port     ?? 6379,
            password: this.config.password,
          })
    }
    return this.client as Awaited<ReturnType<RedisDriver['getClient']>>
  }

  private key(id: string): string { return `${this.prefix}${id}` }

  async load(cookieValue: string | undefined): Promise<SessionPayload> {
    if (!cookieValue) return this.empty()
    try {
      const client = await this.getClient()
      const raw    = await client.get(this.key(cookieValue))
      if (!raw) return this.emptyWithId(cookieValue)
      return JSON.parse(raw) as SessionPayload
    } catch {
      return this.empty()
    }
  }

  async persist(payload: SessionPayload, ttl: number): Promise<string> {
    const client = await this.getClient()
    await client.set(this.key(payload.id), JSON.stringify(payload), 'EX', ttl)
    return payload.id
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

  private emptyWithId(id: string): SessionPayload {
    return { id, data: {}, flash_next: {} }
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
  if (config.driver === 'redis') return new RedisDriver(config.redis ?? {})
  return new CookieDriver(config.secret)
}

// ─── Session Middleware ────────────────────────────────────

export function sessionMiddleware(config: SessionConfig): MiddlewareHandler {
  const driver = makeDriver(config)

  return async function SessionMiddleware(req: AppRequest, res: AppResponse, next: () => Promise<void>) {
    const cookieHeader = (req.headers['cookie'] as string | undefined) ?? ''
    const cookieValue  = parseCookie(cookieHeader, config.cookie.name)
    const payload      = await driver.load(cookieValue)
    const session      = new SessionInstance(payload, driver, config)
    // New session (no cookie yet) — always write Set-Cookie to establish the session
    if (!cookieValue) session.markDirty()

    // Store on the underlying server context (req.raw = Hono's c) so that any
    // normalizeRequest(c) call — including the one in registerRoute — sees it.
    ;(req.raw as Record<string, unknown>)['__bk_session'] = session

    await _als.run(session, next)
    await session.save(res)
  }
}

// ─── Zero-config middleware (reads config from DI) ─────────

/**
 * Session middleware that reads its config from the DI container.
 * Requires session() provider to be registered in bootstrap/providers.ts.
 *
 * Usage in routes:
 *   import { SessionMiddleware } from '@boostkit/session'
 *   Route.get('/path', handler, [SessionMiddleware()])
 */
export function SessionMiddleware(): MiddlewareHandler {
  const config = app().make<SessionConfig>('session.config')
  return sessionMiddleware(config)
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a SessionServiceProvider class configured for the given session config.
 *
 * Built-in drivers:  cookie (signed HMAC — no external deps)
 *                    redis  (requires ioredis: pnpm add ioredis)
 *
 * Usage in bootstrap/providers.ts:
 *   import { session } from '@boostkit/session'
 *   import configs from '../config/index.js'
 *   export default [..., session(configs.session), ...]
 *
 * Usage in bootstrap/app.ts:
 *   import { sessionMiddleware } from '@boostkit/session'
 *   .withMiddleware((m) => { m.use(sessionMiddleware(configs.session)) })
 */
export function session(config: SessionConfig): new (app: Application) => ServiceProvider {
  class SessionServiceProvider extends ServiceProvider {
    register(): void {}

    boot(): void {
      this.app.instance('session.config', config)
      this.app.instance('session.middleware', sessionMiddleware(config))
    }
  }

  return SessionServiceProvider
}
