import { rudder } from '@rudderjs/console'
import { config, resolveOptionalPeer } from '@rudderjs/support'
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
import { drainBootNotices, formatBootNotices } from './boot-notices.js'
import {
  HttpException,
  renderHttpException,
  renderServerError,
  report,
  setExceptionReporter,
  wantsJson,
} from './exceptions.js'
import { ValidationError, ValidationResponse } from './validation.js'
import { registerWsContextRunner } from './ws-context-runner.js'

// ─── Dev HMR: in-flight request drain barrier ───────────────
//
// A dev re-boot mutates process-shared state IN PLACE — `router.reset()`,
// `resetGroupMiddleware()`, and provider `boot()`s repopulating registries (the
// global ORM adapter, and framework-package registries such as a panel/resource
// registry). #652 single-flighted re-boots and gated each request's START on the
// boot promise — but a request that already passed the gate can be MID-RENDER
// when the next re-boot stomps that shared state, observing a half-booted graph
// (e.g. a resource schema missing its `table` element → empty render, no error:
// docs/plans/2026-05-24-hmr-reboot-window-...md REOPEN #2). This barrier makes a
// re-boot WAIT for in-flight renders to drain before it mutates; new requests
// already wait for the re-boot (the gate). The drain is bounded by a timeout so
// a hung render can't wedge the reload. Dev-only; no-op in production (single
// boot, nothing in flight, no resets). The store lives on globalThis because the
// re-boot runs on a fresh instance while in-flight renders may be on the old one.
interface InFlightStore { count: number; waiters: Array<() => void> }
const REBOOT_DRAIN_TIMEOUT_MS = 5000
function _inFlightStore(): InFlightStore {
  const g = globalThis as Record<string, unknown>
  if (!g['__rudderjs_inflight__']) g['__rudderjs_inflight__'] = { count: 0, waiters: [] } satisfies InFlightStore
  return g['__rudderjs_inflight__'] as InFlightStore
}
function requestStarted(): void { _inFlightStore().count++ }
function requestEnded(): void {
  const s = _inFlightStore()
  s.count = Math.max(0, s.count - 1)
  if (s.count === 0 && s.waiters.length > 0) for (const w of s.waiters.splice(0)) w()
}
/** Resolve once no request is mid-render, or after `timeoutMs` (so a hung render
 *  can't wedge the dev reload). Immediate no-op when nothing is in flight. */
function drainInFlightRequests(timeoutMs = REBOOT_DRAIN_TIMEOUT_MS): Promise<void> {
  const s = _inFlightStore()
  if (s.count === 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = (): void => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => {
      const i = s.waiters.indexOf(done)
      if (i >= 0) s.waiters.splice(i, 1)
      resolve()
    }, timeoutMs)
    timer.unref?.()
    s.waiters.push(done)
  })
}

// ─── Configure Options ─────────────────────────────────────

export interface ConfigureOptions {
  /**
   * HTTP server adapter. Omit to auto-resolve `@rudderjs/server-hono`,
   * constructed with `config('server')` — equivalent to passing
   * `hono(config.server)` explicitly. Pass an explicit adapter to use a
   * different server, or when bundling to a single file (the auto-resolve
   * is a runtime lookup that bundlers can't see).
   */
  server?:    ServerAdapterProvider
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

// Constructed via the global symbol registry rather than imported from
// @rudderjs/contracts so the check works against a version-skewed session
// install (same key → same symbol regardless of which package defined it).
const SESSION_MIDDLEWARE = Symbol.for('rudderjs.sessionMiddleware')

let _duplicateSessionWarned = false

/**
 * Warn (once per boot) when more than one session middleware is installed
 * across the effective `global → web group` chain. The canonical mistake:
 * `SessionProvider.boot()` auto-installs `sessionMiddleware` on the `web`
 * group, and the app ALSO registers a global `m.use(sessionMiddleware(...))`
 * in bootstrap/app.ts. Two instances silently double-append `Set-Cookie`,
 * and the trailing anonymous cookie clobbers the authenticated one on
 * cookie-less requests — presenting as intermittent login loss / deny-all
 * WS auth, two layers away from the misconfigured line.
 *
 * Identity-based dedupe can't catch this (each `sessionMiddleware(cfg)` call
 * returns a fresh closure), so we count the `SESSION_MIDDLEWARE` marker the
 * session factory tags onto every instance it returns.
 *
 * @internal — exported for tests; called from `_createHandler`'s assembly.
 */
export function warnIfDuplicateSessionMiddleware(handlers: MiddlewareHandler[]): boolean {
  const installs = handlers.filter(
    (h) => (h as unknown as Record<symbol, unknown>)[SESSION_MIDDLEWARE] === true,
  ).length
  if (installs <= 1) return false
  if (!_duplicateSessionWarned) {
    _duplicateSessionWarned = true
    console.warn(
      `[RudderJS] sessionMiddleware is installed ${installs} times on the request pipeline ` +
      '(global + web group). @rudderjs/session auto-installs it on the `web` group — remove ' +
      'the redundant install (usually a global `m.use(sessionMiddleware(...))` in bootstrap/app.ts). ' +
      'Duplicate session middleware double-appends Set-Cookie and can clobber the authenticated ' +
      'session cookie on first-visit requests.',
    )
  }
  return true
}

/** @internal — test seam: re-arm the once-per-boot duplicate-session warning. */
export function resetDuplicateSessionWarning(): void {
  _duplicateSessionWarned = false
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

      // 6. Unhandled — report, then either bubble (so the adapter's rich
      // dev error page fires) or render the safe fallback page.
      //
      // In dev mode AND for HTML-accepting clients, re-throw so the adapter
      // (e.g. server-hono's Ignition-style `renderErrorPage`) catches it
      // and renders a stack-frame view with source context. Without this,
      // every unhandled 500 fell through to `renderServerError`'s plain
      // card-style page below — the dev page was effectively dead code from
      // 2026-04-06 onward when this central pipeline was added.
      //
      // Prod (`debug === false`) and JSON clients always use the safe page:
      // the former mustn't leak source-context to attackers, the latter
      // doesn't render HTML at all.
      report(err)
      let debug = false
      try { debug = Application.getInstance().debug } catch { /* app not ready */ }
      if (debug && !wantsJson(req)) {
        throw err
      }
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

    // RUDDER_HMR_TRACE=1 — count fresh RudderJS constructions. Each fresh
    // instance kicks off a re-boot (its constructor calls _singleFlightBootstrap).
    // The single-flight + handleRequest gate assume one fresh instance per
    // re-boot; a count climbing by >1 within one re-boot window means concurrent
    // re-evaluations are racing past the globalThis guard before the first
    // publishes — the residual the reboot plan flags. Paired with the
    // Application construct trace so the two guards can be compared.
    if (process.env['RUDDER_HMR_TRACE'] === '1') {
      const n = ((g['__rudderjs_instance_ctor_count__'] as number) ?? 0) + 1
      g['__rudderjs_instance_ctor_count__'] = n
      console.log(`[hmr] RudderJS construct #${n}`)
    }

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
  /** Memoized auto-resolved server adapter (when no explicit `server:` was configured). */
  private _autoServer: Promise<ServerAdapterProvider> | null = null

  constructor(
    private readonly _app:     Application,
    private readonly _server:  ServerAdapterProvider | undefined,
    private readonly _loaders: Array<() => Promise<unknown>>,
    private readonly _mwFn?:   (m: MiddlewareConfigurator) => void,
    private readonly _excFn?:  (e: ExceptionConfigurator) => void,
  ) {
    this._providerBoot = this._singleFlightBootstrap()
    // Kick off the auto-resolution eagerly (fire-and-forget) so server-hono's
    // module-load side effects — notably the vike/server prewarm — fire at the
    // same t≈0 point in the cold-boot timeline that the static
    // `import { hono }` in bootstrap/app.ts used to provide. Errors are
    // swallowed here; the awaited path in `_createHandler()` surfaces them.
    if (!this._server) void this._resolveServer().catch(() => { /* surfaced at _createHandler */ })
  }

  /**
   * Resolve the server adapter: the explicit `server:` from
   * `Application.configure()` when given, otherwise auto-resolve
   * `@rudderjs/server-hono` (the default adapter) and construct it with
   * `config('server')`. Memoized — resolution runs once per instance.
   */
  private _resolveServer(): Promise<ServerAdapterProvider> {
    if (this._server) return Promise.resolve(this._server)
    if (!this._autoServer) {
      this._autoServer = (async () => {
        let mod: { hono?: (cfg?: unknown) => ServerAdapterProvider } | undefined
        try {
          mod = await resolveOptionalPeer<{ hono?: (cfg?: unknown) => ServerAdapterProvider }>('@rudderjs/server-hono')
        } catch { /* not installed — handled below */ }
        if (typeof mod?.hono !== 'function') {
          throw new Error(
            '[RudderJS] No server adapter configured and @rudderjs/server-hono is not installed. ' +
            'Install @rudderjs/server-hono, or pass an explicit adapter: ' +
            'Application.configure({ server: hono(config.server), ... }).',
          )
        }
        return mod.hono(config('server', {}))
      })()
    }
    return this._autoServer
  }

  /**
   * Single-flight the provider re-boot across concurrent dev HMR reloads.
   *
   * In dev, the @rudderjs/vite watcher clears `__rudderjs_instance__` +
   * `__rudderjs_app__` on every change, so the next request re-evaluates
   * `bootstrap/app.ts` and constructs a fresh `RudderJS` whose `boot()`
   * resets + re-registers process-wide shared state — the router routes, the
   * provider-group middleware store, and (via `orm-prisma`'s boot) the global
   * `ModelRegistry` adapter. If a second re-boot is triggered while the first is
   * still in flight (an editor's atomic-write / format-on-save double-fire, or
   * any concurrent trigger), running the two boots in parallel let the second's
   * `router.reset()` / `ModelRegistry.set()` interleave with the first — a
   * request served in that window observed a half-booted graph and rendered
   * empty data (e.g. resource tables showing their empty-state despite rows in
   * the DB).
   *
   * The fix: chain each re-boot after the previous one via a promise published
   * on `globalThis.__rudderjs_boot__`. Concurrent re-boots now run strictly
   * serially, so no boot ever observes another mid-reset. `handleRequest()`
   * gates on this same promise so in-window requests block on the latest boot
   * instead of being served against half-booted state.
   *
   * In production there is exactly one boot, so `prev` is undefined and this is
   * a no-op wrapper around `_bootstrapProviders()`.
   */
  private _singleFlightBootstrap(): Promise<void> {
    const g = globalThis as Record<string, unknown>
    const prev = g['__rudderjs_boot__'] as Promise<void> | undefined
    const run = (async () => {
      // Wait for any in-flight re-boot to fully finish before touching shared
      // state. A prior boot's failure is its own concern (surfaced via its own
      // request/handler) — swallow it here so it doesn't cascade into this one.
      if (prev) { try { await prev } catch { /* prior boot owns its failure */ } }
      // `prev` defined ⟺ a previous boot exists ⟺ this is a re-boot (dev HMR).
      await this._bootstrapProviders(prev !== undefined)
    })()
    g['__rudderjs_boot__'] = run
    return run
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
  private async _bootstrapProviders(isReboot = false): Promise<void> {
    this._suppressVikeNoise()
    // RUDDER_HMR_TRACE=1 — when this boot was triggered by a dev file-watch
    // reload, `__rudderjs_hmr_t0__` carries the watcher-event timestamp (set by
    // @rudderjs/vite's rudderjs:routes plugin). Attribute the wall-clock to the
    // Vite re-import gap (watcher→reimport) vs. our re-boot (reboot→ready).
    const g = globalThis as Record<string, unknown>
    const hmrT0 = g['__rudderjs_hmr_t0__']
    const hmrTrace = process.env['RUDDER_HMR_TRACE'] === '1' && typeof hmrT0 === 'number'
    const tStart = hmrTrace ? performance.now() : 0
    if (hmrTrace && typeof hmrT0 === 'number') {
      console.log(`[hmr] watcher→reimport ${(tStart - hmrT0).toFixed(1)}ms`)
    }
    // Reset process-wide shared state before a RE-BOOT — the router routes, the
    // provider-group middleware store, and the rudder CLI registry — so the
    // fresh boot re-registers onto clean state. Gated on `isReboot` (a previous
    // boot exists), NOT `isDevelopment()`: a dev server whose APP_ENV isn't
    // 'development' (no .env, or APP_ENV=production) still re-boots on every file
    // edit, and skipping the reset there leaves the router mounted — so a
    // provider that registers routes in boot() (e.g. Horizon) throws "get()
    // called after router.mount()" on the 2nd edit. Cold boot needs no reset
    // (state is already fresh); production is a single boot so this never runs.
    if (isReboot) {
      // Quiesce: let any in-flight render finish before we stomp shared state —
      // otherwise a request that already passed the handleRequest gate observes a
      // half-booted graph mid-render (the REOPEN #2 empty-table wedge). Bounded
      // by a timeout; no-op on cold boot (nothing in flight).
      await drainInFlightRequests()
      rudder.reset()
      const { router } = await import('@rudderjs/router') as { router: { reset(): void } }
      router.reset()
      resetGroupMiddleware()
    }
    // Start with an empty notice buffer so a re-boot (or a prior boot that
    // failed before flushing) doesn't carry stale notices into this boot's
    // grouped block. Providers repopulate it during bootstrap().
    drainBootNotices()
    await this._app.bootstrap()
    // Serial loader execution — required for per-loader group tagging in
    // @rudderjs/router's runWithGroup(). Parallel execution would set the
    // module-level currentGroup to whichever loader was invoked last before
    // any module bodies evaluated in microtasks. Sequential is negligibly
    // slower for ≤4 loaders and keeps the group context correct.
    for (const loader of this._loaders) await loader()
    if (this._app.isDevelopment()) this._printDevBootLog()
    if (hmrTrace) {
      console.log(`[hmr] reboot→ready ${(performance.now() - tStart).toFixed(1)}ms`)
      delete g['__rudderjs_hmr_t0__']
    }
    // Dev: a Vite-style arrow line that sits with Vike's `➜ Local`/`Network`
    // banner. Prod (no Vike banner, logs go to files/aggregators): keep the
    // parseable bracket prefix.
    // Active line (like Vike's `➜ Local`): bright green arrow, bold "App".
    if (this._app.isDevelopment()) console.log(`  \x1b[32m➜\x1b[39m  \x1b[1mApp\x1b[22m is ready`)
    else console.log('[RudderJS] ready')
    // Flush collected boot notices as a trailing footnote AFTER the ready line,
    // so non-fatal notices sit at the bottom of the boot output rather than
    // wedged above it. Always printed so warnings aren't lost; empty input
    // prints nothing (a fully-configured app boots clean).
    const notices = drainBootNotices()
    if (notices.length > 0) console.warn('\n' + formatBootNotices(notices).join('\n'))
  }

  /**
   * Dev-only — print the auto-discovered provider count as a Vite-style `➜` line
   * so the block sits with Vike's `➜ Local`/`➜ Network` startup banner. With
   * `RUDDER_BOOT_VERBOSE=1`, also print the providers grouped by stage so a
   * missing package is visible at boot instead of failing silently when first
   * used; long stage lists wrap, aligned under the value column.
   */
  private _printDevBootLog(): void {
    const entries = getLastLoadedProviderEntries()
    if (entries.length === 0) return

    const C = {
      green:   (s: string) => `\x1b[32m${s}\x1b[39m`,
      magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
      cyan:    (s: string) => `\x1b[36m${s}\x1b[39m`,
      greenL:  (s: string) => `\x1b[32m${s}\x1b[39m`,
      yellow:  (s: string) => `\x1b[33m${s}\x1b[39m`,
    }
    const STAGE_COLORS = {
      foundation:     C.magenta,
      infrastructure: C.cyan,
      feature:        C.greenL,
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
    const activeStages = STAGE_ORDER.filter(s => (grouped.get(s)?.length ?? 0) > 0)

    // Vite-style arrow prefix: 2 spaces, green ➜, 2 spaces (5 visible columns).
    const arrow    = `  ${C.green('➜')}  `
    const arrowLen = 5

    // Muted line (like Vike's `➜ Network`): dim green arrow + dim
    // "Auto-discovered", with the count itself bright + bold.
    const dimArrow = `  \x1b[2m\x1b[32m➜\x1b[39m  ` // dim green ➜; dim stays on after
    const count    = `${entries.length} provider${entries.length === 1 ? '' : 's'}`
    console.log(`${dimArrow}Auto-discovered \x1b[22m\x1b[1m${count}\x1b[0m`)

    // The per-stage breakdown (which packages booted in each stage) is hidden by
    // default to keep the boot block compact — the count above covers the common
    // case. Set RUDDER_BOOT_VERBOSE=1 to restore it when auditing what loaded
    // (e.g. a package silently missing from the manifest).
    if (process.env['RUDDER_BOOT_VERBOSE'] !== '1') return

    // Align stage-label colons (Vike aligns `Local:`/`Network:` the same way).
    const labelColonWidth = Math.max(...activeStages.map(s => s.length)) + 1 // +1 for ':'
    const valueCol        = arrowLen + labelColonWidth + 1                   // +1 trailing space
    const continuation    = ' '.repeat(valueCol)
    // Wrap at min(terminal width, 80) so the layout is consistent across narrow
    // and wide terminals — wide terminals would otherwise stretch a long feature
    // list to one unreadable line.
    const termCols  = Math.min(process.stdout.columns ?? 80, 80)
    const wrapWidth = Math.max(20, termCols - valueCol)

    for (const stage of activeStages) {
      const list     = grouped.get(stage)!
      const colorize = STAGE_COLORS[stage]
      // Color the stage word only; pad on visible length so colons align.
      const label    = colorize(stage) + ':' + ' '.repeat(labelColonWidth - (stage.length + 1))

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

      lines.forEach((parts, i) => {
        // Trailing comma on a wrapped line so it reads as one continued list.
        const tail   = i < lines.length - 1 ? ',' : ''
        const prefix = i === 0 ? `${arrow}${label} ` : continuation
        console.log(`${prefix}${parts.join(', ')}${tail}`)
      })
    }
  }

  /** Phase 2 — create the HTTP fetch handler. Requires Vite context (virtual: URLs). */
  private async _createHandler(): Promise<void> {
    const mw = new MiddlewareConfigurator()
    this._mwFn?.(mw)
    // Register the WebSocket-upgrade context runner on its globalThis seam.
    // Runs here (at `.create()`, dev + prod) where the web group is already
    // resolvable — `@rudderjs/sync` reads the seam to run session/auth around
    // `onAuth`. Resolver is lazy so it tracks the current group store across
    // dev HMR re-boots.
    registerWsContextRunner(() => mw.getGroupHandlers('web'))
    const exc = new ExceptionConfigurator()
    this._excFn?.(exc)
    const errorHandler = exc.buildHandler()
    const { router } = await import('@rudderjs/router') as { router: { mount(adapter: ServerAdapter): void } }
    // Kernel maintenance middleware — first in the global stack, a pure
    // existsSync no-op when the app is up. Lazy-imported so its node:fs static
    // import never lands in a client bundle (this path is server-only).
    const { maintenanceMiddleware } = await import('./maintenance.js')
    const server = await this._resolveServer()
    this._handler = await server.createFetchHandler((adapter: ServerAdapter) => {
      adapter.applyMiddleware(maintenanceMiddleware())
      // Providers have booted by now, so the group store is fully populated —
      // catch a duplicate session install (global + web group) at boot, in the
      // server log, before the first request hits the subtly-broken pipeline.
      warnIfDuplicateSessionMiddleware([...mw.getHandlers(), ...mw.getGroupHandlers('web')])
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

  /**
   * Snapshot of the configured middleware stack. Combines the user's
   * `withMiddleware()` block with provider-registered group middleware
   * (`appendToGroup()` calls during `boot()`). Used by the `route:list
   * --verbose` command to render the resolved per-route stack in the
   * same order it runs at request time: `[global → group → route]`.
   *
   * Requires providers to have booted (so `appendToGroup()` calls
   * have populated the global group store).
   */
  middlewareSnapshot(): {
    global: MiddlewareHandler[]
    groups: Record<RouteGroupName, MiddlewareHandler[]>
  } {
    const mw = new MiddlewareConfigurator()
    this._mwFn?.(mw)
    return {
      global: mw.getHandlers(),
      groups: {
        web: mw.getGroupHandlers('web'),
        api: mw.getGroupHandlers('api'),
      },
    }
  }

  async handleRequest(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
    if (!this._boot) this._boot = this._providerBoot.then(() => this._createHandler())
    await this._boot
    // Dev HMR gate: a concurrent re-boot (watcher double-fire, or a reload that
    // landed after this instance built its handler) may be mid-flight, resetting
    // process-wide shared state — the router, the group-middleware store, the
    // global ORM adapter registry. Block on the latest re-boot so we never serve
    // against a half-booted graph (the "empty data after a routine edit" race).
    // `__rudderjs_boot__` is this instance's own promise in the steady state and
    // in production, so this is a no-op there.
    const latest = (globalThis as Record<string, unknown>)['__rudderjs_boot__'] as Promise<void> | undefined
    if (latest && latest !== this._providerBoot) {
      try { await latest } catch { /* the newer boot owns its own failure */ }
    }
    if (!this._handler) throw new Error('[RudderJS] Request handler not initialized.')
    // Production: byte-identical fast path — no drain bookkeeping (single boot).
    if (!this._app.isDevelopment()) return this._handler(request, env, ctx)
    // Dev: count this render as in-flight so a concurrent re-boot drains it
    // before mutating shared state (see the drain barrier at the top of file).
    requestStarted()
    try {
      return await this._handler(request, env, ctx)
    } finally {
      requestEnded()
    }
  }

  readonly fetch = (request: Request, env?: unknown, ctx?: unknown): Promise<Response> =>
    this.handleRequest(request, env, ctx)
}
