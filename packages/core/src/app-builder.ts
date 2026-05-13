import { rudder } from '@rudderjs/console'
import type {
  AppRequest,
  FetchHandler,
  MiddlewareHandler,
  ServerAdapter,
  ServerAdapterProvider,
} from '@rudderjs/contracts'
import {
  Application,
  groupMiddlewareStore,
  resetGroupMiddleware,
  type ProviderClass,
} from './application.js'
import { getLastLoadedProviderEntries } from './default-providers.js'
import {
  HttpException,
  renderHttpException,
  renderServerError,
  report,
  setExceptionReporter,
} from './exceptions.js'
import { ValidationError, ValidationResponse } from './validation.js'

// ─── Configure Options ─────────────────────────────────────

export interface ConfigureOptions {
  server:     ServerAdapterProvider
  config?:    Record<string, unknown>
  providers?: ProviderClass[]
}

export interface RoutingOptions {
  web?:      () => Promise<unknown>
  api?:      () => Promise<unknown>
  commands?: () => Promise<unknown>
  channels?: () => Promise<unknown>
}

// ─── Middleware Configurator ───────────────────────────────

type RouteGroupName = 'web' | 'api'

export class MiddlewareConfigurator {
  private _handlers: MiddlewareHandler[] = []
  private _groupHandlers: Record<RouteGroupName, MiddlewareHandler[]> = { web: [], api: [] }

  /** Global middleware — runs on every request, regardless of route group. */
  use(handler: MiddlewareHandler): this {
    this._handlers.push(handler)
    return this
  }

  /** Append middleware to the `web` route group (routes loaded via withRouting({ web })). */
  web(...handlers: MiddlewareHandler[]): this {
    this._groupHandlers.web.push(...handlers)
    return this
  }

  /** Append middleware to the `api` route group (routes loaded via withRouting({ api })). */
  api(...handlers: MiddlewareHandler[]): this {
    this._groupHandlers.api.push(...handlers)
    return this
  }

  getHandlers(): MiddlewareHandler[] { return this._handlers }

  /** Combined group stack — user-config + any provider-registered group middleware. */
  getGroupHandlers(group: RouteGroupName): MiddlewareHandler[] {
    return [...groupMiddlewareStore[group], ...this._groupHandlers[group]]
  }
}

// ─── Exception Configurator ────────────────────────────────

export type ErrorRenderer = (err: unknown, req: AppRequest) => Response | Promise<Response>

export class ExceptionConfigurator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _renders: Array<{ type: new (...args: any[]) => unknown; fn: ErrorRenderer }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _ignored: Set<new (...args: any[]) => unknown> = new Set()

  /**
   * Register a custom renderer for a specific error type.
   *
   * @example
   * e.render(PaymentError, (err, req) =>
   *   new Response(JSON.stringify({ code: err.code }), { status: 402, headers: { 'Content-Type': 'application/json' } })
   * )
   */
  render<T extends Error>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: new (...args: any[]) => T,
    fn: (err: T, req: AppRequest) => Response | Promise<Response>,
  ): this {
    this._renders.push({ type, fn: fn as ErrorRenderer })
    return this
  }

  /**
   * Ignore an error type — re-throws it so the server's native handler sees it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ignore(type: new (...args: any[]) => unknown): this {
    this._ignored.add(type)
    return this
  }

  /**
   * Override the global exception reporter for unhandled errors.
   * By default, `@rudderjs/log` wires this automatically when installed.
   *
   * @example
   * e.reportUsing((err) => Sentry.captureException(err))
   */
  reportUsing(fn: (err: unknown) => void): this {
    setExceptionReporter(fn)
    return this
  }

  /** @internal — called by RudderJS to produce the combined error handler */
  buildHandler(): ErrorRenderer {
    const renders = this._renders.slice()
    const ignored = new Set(this._ignored)

    return async (err: unknown, req: AppRequest): Promise<Response> => {
      // 1. Explicitly ignored — re-throw
      for (const type of ignored) {
        if (err instanceof type) throw err
      }

      // 2. User-registered renderers (take priority)
      for (const { type, fn } of renders) {
        if (err instanceof type) return fn(err, req)
      }

      // 3. ValidationResponse — short-circuit emit the wrapped Response (FormRequest.failedValidation)
      if (err instanceof ValidationResponse) {
        return err.response
      }

      // 4. ValidationError — 422 JSON
      if (err instanceof ValidationError) {
        return new Response(JSON.stringify(err.toJSON()), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // 4. HttpException — render with its status code (JSON or HTML)
      if (err instanceof HttpException) {
        return renderHttpException(err, req)
      }

      // 5. Errors carrying a duck-typed `httpStatus` (e.g. ModelNotFoundError,
      // RouteModelNotFoundError) — render with that status. Avoids a hard
      // dependency on @rudderjs/orm or @rudderjs/router from here.
      if (err instanceof Error) {
        const status = (err as Error & { httpStatus?: unknown }).httpStatus
        if (typeof status === 'number' && status >= 400 && status < 600) {
          return renderHttpException(new HttpException(status, err.message), req)
        }
      }

      // 6. Unhandled — report + render 500
      report(err)
      let debug = false
      try { debug = Application.getInstance().debug } catch { /* app not ready */ }
      return renderServerError(req, debug, err)
    }
  }
}

// ─── App Builder ───────────────────────────────────────────

export class AppBuilder {
  private _loaders: Array<() => Promise<unknown>> = []
  private _mwFn?:  (m: MiddlewareConfigurator) => void
  private _excFn?: (e: ExceptionConfigurator) => void

  constructor(private readonly _options: ConfigureOptions) {}

  withRouting(routes: RoutingOptions): this {
    if (routes.web)      this._loaders.push(this._taggedLoader('web', routes.web))
    if (routes.api)      this._loaders.push(this._taggedLoader('api', routes.api))
    if (routes.commands) this._loaders.push(routes.commands)
    if (routes.channels) this._loaders.push(routes.channels)
    return this
  }

  /** Wrap a route loader so routes registered inside it get tagged with `group`. */
  private _taggedLoader(group: 'web' | 'api', loader: () => Promise<unknown>): () => Promise<unknown> {
    return async () => {
      const { runWithGroup } = await import('@rudderjs/router')
      return runWithGroup(group, loader)
    }
  }

  withMiddleware(fn: (m: MiddlewareConfigurator) => void): this {
    this._mwFn = fn
    return this
  }

  withExceptions(fn: (e: ExceptionConfigurator) => void): this {
    this._excFn = fn
    return this
  }

  create(): RudderJS {
    const g = globalThis as Record<string, unknown>
    if (g['__rudderjs_instance__']) return g['__rudderjs_instance__'] as RudderJS

    const app = Application.create({
      ...(this._options.config    && { config:    this._options.config }),
      ...(this._options.providers && { providers: this._options.providers }),
    })
    const instance = new RudderJS(app, this._options.server, this._loaders, this._mwFn, this._excFn)
    g['__rudderjs_instance__'] = instance
    return instance
  }
}

// ─── RudderJS (Configured Application) ─────────────────────

export class RudderJS {
  /** Phase 1: providers only — safe to await in CLI (no Vike virtual imports) */
  private _providerBoot: Promise<void>
  /** Phase 2: provider boot + HTTP handler — created lazily on first handleRequest call */
  private _boot: Promise<void> | null = null
  private _handler: FetchHandler | null = null

  constructor(
    private readonly _app:     Application,
    private readonly _server:  ServerAdapterProvider,
    private readonly _loaders: Array<() => Promise<unknown>>,
    private readonly _mwFn?:   (m: MiddlewareConfigurator) => void,
    private readonly _excFn?:  (e: ExceptionConfigurator) => void,
  ) {
    this._providerBoot = this._bootstrapProviders()
  }

  private _suppressVikeNoise(): void {
    const isNoise = (args: unknown[]): boolean => {
      const msg = args.map(a => String(a ?? '')).join(' ')
      if (msg.includes('[vike]')) return true
      if (msg.includes('Server running at ')) return true
      return false
    }
    const _log  = console.log
    const _warn = console.warn
    const _info = console.info
    console.log  = (...a: unknown[]) => { if (!isNoise(a)) _log(...a)  }
    console.warn = (...a: unknown[]) => { if (!isNoise(a)) _warn(...a) }
    console.info = (...a: unknown[]) => { if (!isNoise(a)) _info(...a) }
  }

  /** Phase 1 — boot providers + routes. Safe in CLI (no Vike virtual URLs). */
  private async _bootstrapProviders(): Promise<void> {
    this._suppressVikeNoise()
    if (this._app.isDevelopment()) {
      rudder.reset()
      const { router } = await import('@rudderjs/router') as { router: { reset(): void } }
      router.reset()
      resetGroupMiddleware()
    }
    await this._app.bootstrap()
    // Serial loader execution — required for per-loader group tagging in
    // @rudderjs/router's runWithGroup(). Parallel execution would set the
    // module-level currentGroup to whichever loader was invoked last before
    // any module bodies evaluated in microtasks. Sequential is negligibly
    // slower for ≤4 loaders and keeps the group context correct.
    for (const loader of this._loaders) await loader()
    if (this._app.isDevelopment()) this._printDevBootLog()
    console.log('[RudderJS] ready')
  }

  /**
   * Dev-only — print the auto-discovered providers grouped by stage so a missing
   * package is visible at every boot instead of failing silently when first used.
   * Wraps long stage lines so the output stays readable in narrow terminals.
   */
  private _printDevBootLog(): void {
    const entries = getLastLoadedProviderEntries()
    if (entries.length === 0) return

    const C = {
      dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
      magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
      cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
      green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
      yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
    }
    const STAGE_COLORS = {
      foundation:     C.magenta,
      infrastructure: C.cyan,
      feature:        C.green,
      monitoring:     C.yellow,
    } as const
    const STAGE_ORDER = ['foundation', 'infrastructure', 'feature', 'monitoring'] as const

    const shortName = (p: string): string => p.startsWith('@rudderjs/') ? p.slice('@rudderjs/'.length) : p

    const grouped = new Map<string, string[]>()
    for (const e of entries) {
      const list = grouped.get(e.stage) ?? []
      list.push(shortName(e.package))
      grouped.set(e.stage, list)
    }

    console.log(`[RudderJS] ${entries.length} provider${entries.length === 1 ? '' : 's'} booted`)

    // Find which stages have entries — needed to know which one is the last
    // (gets `└─` instead of `├─`).
    const activeStages = STAGE_ORDER.filter(s => (grouped.get(s)?.length ?? 0) > 0)

    const labelWidth = 16
    const indent     = '  '
    const connector  = '── '   // 3 visible chars after the corner
    const cornerLen  = 2 + connector.length // ├─ + space-after width
    // Wrap at min(terminal width, 80) so the layout is consistent across
    // narrow and wide terminals — wide terminals would otherwise stretch a
    // long feature list to one unreadable line.
    const termCols   = Math.min(process.stdout.columns ?? 80, 80)
    const wrapWidth  = termCols - indent.length - cornerLen - labelWidth - 2

    activeStages.forEach((stage, idx) => {
      const list   = grouped.get(stage)!
      const isLast = idx === activeStages.length - 1
      const corner = isLast ? '└─ ' : '├─ '

      const colorize = STAGE_COLORS[stage]
      const label    = colorize(stage.padEnd(labelWidth))

      // Greedy line-wrap: pack as many comma-joined names as fit per line.
      const lines: string[][] = [[]]
      let currentLen = 0
      for (const name of list) {
        const piece = (lines[lines.length - 1]!.length === 0 ? '' : ', ') + name
        if (currentLen + piece.length > wrapWidth && lines[lines.length - 1]!.length > 0) {
          lines.push([name])
          currentLen = name.length
        } else {
          lines[lines.length - 1]!.push(name)
          currentLen += piece.length
        }
      }

      // Continuation lines use `│` to maintain the tree visual when there are
      // more stages below; the last stage uses spaces instead.
      const continuation = isLast
        ? ' '.repeat(corner.length + labelWidth)
        : C.dim('│  ') + ' '.repeat(labelWidth)

      lines.forEach((parts, i) => {
        const prefix = i === 0
          ? `${indent}${C.dim(corner)}${label}`
          : `${indent}${continuation}`
        console.log(`${prefix}${parts.join(', ')}`)
      })
    })
  }

  /** Phase 2 — create the HTTP fetch handler. Requires Vite context (virtual: URLs). */
  private async _createHandler(): Promise<void> {
    const mw = new MiddlewareConfigurator()
    this._mwFn?.(mw)
    const exc = new ExceptionConfigurator()
    this._excFn?.(exc)
    const errorHandler = exc.buildHandler()
    const { router } = await import('@rudderjs/router') as { router: { mount(adapter: ServerAdapter): void } }
    this._handler = await this._server.createFetchHandler((adapter: ServerAdapter) => {
      for (const h of mw.getHandlers()) adapter.applyMiddleware(h)
      if (adapter.applyGroupMiddleware) {
        for (const h of mw.getGroupHandlers('web')) adapter.applyGroupMiddleware('web', h)
        for (const h of mw.getGroupHandlers('api')) adapter.applyGroupMiddleware('api', h)
      }
      router.mount(adapter)
      adapter.setErrorHandler?.(errorHandler)
    })
  }

  /** Boot providers without starting an HTTP server — used by the CLI */
  async boot(): Promise<void> {
    await this._providerBoot
  }

  async handleRequest(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
    if (!this._boot) this._boot = this._providerBoot.then(() => this._createHandler())
    await this._boot
    if (!this._handler) throw new Error('[RudderJS] Request handler not initialized.')
    return this._handler(request, env, ctx)
  }

  readonly fetch = (request: Request, env?: unknown, ctx?: unknown): Promise<Response> =>
    this.handleRequest(request, env, ctx)
}
