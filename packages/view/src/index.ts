/**
 * @rudderjs/view — Laravel-style controller-returned views.
 *
 * Usage:
 *   import { view } from '@rudderjs/view'
 *
 *   router.get('/dashboard', async () => {
 *     const users = await User.all()
 *     return view('dashboard', { users })
 *   })
 *
 * `view(id, props)` resolves to `app/Views/<Id>.tsx` (PascalCase) and is
 * rendered through Vike's existing SSR pipeline. The Vite plugin in
 * `@rudderjs/vite` discovers files in `app/Views/**` and emits virtual
 * Vike pages under the internal URL prefix `/__view/<id>`.
 *
 * The server-hono adapter detects ViewResponse instances by duck-typing on
 * the static `__rudder_view__` marker and resolves them via Vike's
 * programmatic `renderPage()`.
 */

// Side-effect import — pulls in the Vike.PageContext.{viewProps,viewHeaders}
// augmentation so app code can read both with full typing.
import './types/vike.js'

export type ViewProps = Record<string, unknown>

export interface ViewResolveContext {
  /** The request URL — used to forward query string into the rendered page */
  url: string
}

export interface ViewOptions {
  /**
   * Response headers to attach to the rendered page.
   *
   * Can be a plain object or a function returning one (the function form
   * runs server-side at render time so per-request values like CSP nonces
   * work). Framework-owned headers (`set-cookie`, `vary`, anything
   * starting with `x-rudderjs-`) are dropped to prevent collisions with
   * server-hono's response pipeline.
   *
   * @example
   * return view('marketing.pricing', { plans }, {
   *   headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' },
   * })
   *
   * @example
   * return view('admin.dashboard', props, {
   *   headers: () => ({ 'content-security-policy': `script-src 'self' 'nonce-${nonce}'` }),
   * })
   */
  headers?: Record<string, string> | (() => Record<string, string>)
}

const VIEW_URL_PREFIX = '/__view'

/**
 * Headers a view is never allowed to set — these belong to the framework's
 * response pipeline. Silently dropped by `filterReservedHeaders()`.
 *
 * - `set-cookie`: session, CSRF, and auth middleware write Set-Cookie
 *   cooperatively (multi-value append, see the `feedback_set_cookie_collapse`
 *   note in repo memory). A view-supplied Set-Cookie would either clobber
 *   those or get collapsed by Node's undici `Response` constructor.
 * - `vary`: managed by server-hono / Vike based on negotiated content; a
 *   view-supplied `Vary` would shadow caching directives the framework needs.
 * - `x-rudderjs-*` prefix: reserved for framework-internal markers
 *   (telescope correlation ids, view markers, etc.); a view setting these
 *   would corrupt observability.
 */
const RESERVED_HEADER_PREFIXES = ['x-rudderjs-']
const RESERVED_HEADERS = new Set(['set-cookie', 'vary'])

function filterReservedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase()
    if (RESERVED_HEADERS.has(key)) continue
    if (RESERVED_HEADER_PREFIXES.some(p => key.startsWith(p))) continue
    out[k] = v
  }
  return out
}

export class ViewResponse {
  /** Marker checked by server-hono via duck-typing (avoids a hard import). */
  static readonly __rudder_view__ = true

  constructor(
    public readonly id: string,
    public readonly props: ViewProps,
    public readonly options: ViewOptions = {},
  ) {}

  /** Resolve the `headers` option to a plain object, filtering reserved keys. */
  resolveHeaders(): Record<string, string> {
    const raw = this.options.headers
    if (!raw) return {}
    const headers = typeof raw === 'function' ? raw() : raw
    return filterReservedHeaders(headers)
  }

  /**
   * Resolve this view to an HTTP Response by calling Vike's renderPage().
   * Called by the server adapter after the route handler returns.
   *
   * **Vike contract this method depends on** — `renderPage()` returns a
   * pageContext object whose shape is partly undocumented. We only read two
   * optional fields:
   *
   * - `errorWhileRendering`: present (and rethrown) when a page-component
   *   throws during SSR. Surfaced to server-hono's exception handler.
   * - `httpResponse`: present on success — carries `statusCode`,
   *   `contentType`, `headers`, and `getReadableWebStream()`. Absent in two
   *   cases: an early Vike abort (e.g. `throw render(404)`) or a renderer
   *   misconfiguration. Both fall through to the 404 fallback below.
   *
   * If a future Vike upgrade renames either field, the 404 fallback would
   * silently mask the real error — re-verify these property names when
   * bumping `vike` major. The structural casts on the destructure exist
   * because Vike's exported `PageContextServer` type doesn't surface them.
   */
  async toResponse(ctx: ViewResolveContext): Promise<Response> {
    const { renderPage } = await import('vike/server')

    // Hand Vike the URL the browser actually requested. The scanner generates
    // a +route.ts file whose default export matches this URL — either derived
    // from the view id by convention ('home' → /home) or taken from a
    // `export const route = '...'` override inside the view file. Either way,
    // the incoming request URL IS the URL Vike's route table uses, so there's
    // no remapping to do here.
    //
    // The `/index.pageContext.json` suffix (present when the request came
    // from SPA nav) is handled by Vike itself — passing it through makes
    // renderPage return a JSON envelope instead of HTML.
    const urlOriginal = ctx.url

    const viewHeaders = this.resolveHeaders()

    const pageContext = await renderPage({
      urlOriginal,
      // Forwarded into pageContext on both server and client; the generated
      // Vike page reads it via `usePageContext().viewProps`.
      viewProps: this.props,
      // Surfaced on pageContext.viewHeaders; @rudderjs/vite's +headersResponse
      // hook (registered via the config preset) reads this and attaches them
      // to the SSR response.
      viewHeaders,
    } as Parameters<typeof renderPage>[0])

    if ((pageContext as { errorWhileRendering?: unknown }).errorWhileRendering) {
      throw (pageContext as { errorWhileRendering: unknown }).errorWhileRendering
    }

    const httpResponse = (pageContext as { httpResponse?: {
      statusCode: number
      contentType: string
      getReadableWebStream: () => ReadableStream
      headers: [string, string][]
    } }).httpResponse

    if (!httpResponse) {
      return new Response(`View "${this.id}" not found`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const headers = new Headers()
    for (const [k, v] of httpResponse.headers) headers.set(k, v)
    if (!headers.has('Content-Type')) headers.set('Content-Type', httpResponse.contentType)

    return new Response(httpResponse.getReadableWebStream(), {
      status:  httpResponse.statusCode,
      headers,
    })
  }
}

/**
 * Module-augmentation registry mapping view ids → component prop types.
 *
 * `@rudderjs/vite`'s views scanner populates this automatically at build time
 * by emitting `pages/__view/registry.d.ts`. App authors never write to this
 * interface directly — they just `export interface Props` in their view
 * component file and the scanner picks it up.
 *
 * Unrecognized ids fall through to the loose `view(id, props?)` overload, so
 * call sites in apps that haven't adopted the convention keep working.
 *
 * Intentionally empty — module augmentation requires `interface`, not `type`,
 * because consumers add members via `interface ViewPropsRegistry { ... }`
 * in a `declare module '@rudderjs/view'` block.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- module-augmentation target; see comment above
export interface ViewPropsRegistry {}

/** Resolved prop type for a registered view id. */
export type ViewPropsFor<Id extends keyof ViewPropsRegistry> = ViewPropsRegistry[Id]

/**
 * Forces the loose overload to reject ids that are already registered, so
 * `view('typed.demo', ...)` MUST match the typed overload (or fail) — it
 * cannot silently fall through to the loose record-typed signature.
 *
 * For a literal id `Id` that extends `keyof ViewPropsRegistry`, this resolves
 * to `never`, making the loose overload's `id` parameter unassignable. For a
 * `string`-typed variable, `string extends <known-id-union>` is false so it
 * resolves back to `string` — dynamic call sites keep working.
 */
type UnknownViewId<Id extends string> = Id extends keyof ViewPropsRegistry ? never : Id

/**
 * Render a view from `app/Views/` with controller-supplied props.
 *
 * @param id      Dot-notation view id (e.g. `'dashboard'` → `app/Views/Dashboard.tsx`)
 * @param props   Plain object passed to the view component as props
 * @param options Optional response options (headers, etc.)
 */
export function view<Id extends keyof ViewPropsRegistry>(
  id:       Id,
  props:    ViewPropsRegistry[Id],
  options?: ViewOptions,
): ViewResponse
export function view<Id extends string>(
  id:       UnknownViewId<Id>,
  props?:   ViewProps,
  options?: ViewOptions,
): ViewResponse
export function view(id: string, props: ViewProps = {}, options: ViewOptions = {}): ViewResponse {
  return new ViewResponse(id, props, options)
}

/**
 * Duck-typed check used by `@rudderjs/server-hono` to detect a ViewResponse
 * without importing this package directly. The constructor's static
 * `__rudder_view__ === true` flag is the marker.
 */
export function isViewResponse(value: unknown): value is ViewResponse {
  if (value === null || typeof value !== 'object') return false
  const ctor = (value as { constructor?: { __rudder_view__?: unknown } }).constructor
  return ctor?.__rudder_view__ === true
}

/**
 * Hook for view components to read controller-supplied props.
 * Re-exported from the framework-specific entry points (currently inlined
 * in user views via `usePageContext()` from vike-react).
 */
export const VIEW_URL_PREFIX_INTERNAL = VIEW_URL_PREFIX

/**
 * HTML-escape a value for interpolation into a vanilla view's returned string.
 *
 * **Vanilla views do NOT auto-escape** — unlike JSX, raw template literals
 * will happily emit unescaped markup. Any user-supplied value interpolated
 * into a vanilla view MUST go through `escapeHtml()` or be proven safe.
 *
 * ```ts
 * // app/Views/AdminReport.ts
 * import { escapeHtml } from '@rudderjs/view'
 *
 * export default function AdminReport({ title }: { title: string }): string {
 *   return `<h1>${escapeHtml(title)}</h1>`
 * }
 * ```
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Wraps a string that is already known to be safe HTML. Values of this type
 * pass through `html\`\`` interpolations without being re-escaped. The `html`
 * tag returns a `SafeString`, so nested templates compose naturally:
 *
 * ```ts
 * const row = html`<tr><td>${user.name}</td></tr>`  // SafeString
 * const table = html`<table>${rows}</table>`         // rows are SafeStrings, not re-escaped
 * ```
 *
 * To intentionally inject pre-rendered markup (from a CMS, a markdown
 * renderer, etc.), wrap it explicitly: `new SafeString(trustedHtml)`. Only
 * do this for markup you produced or fully control — anything originating
 * from user input must go through `escapeHtml()` first.
 */
export class SafeString {
  /**
   * Wraps a string as already-escaped HTML. **Does NOT escape its argument.**
   * The caller is responsible for ensuring `value` cannot contain
   * unsanitized user input — pass user-controlled strings through
   * `escapeHtml()` first, or compose via the `html\`\`` tagged template
   * (which handles escaping for you).
   */
  constructor(public readonly value: string) {}
  toString(): string { return this.value }
}

function renderHtmlValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value instanceof SafeString) return value.value
  if (Array.isArray(value)) return value.map(renderHtmlValue).join('')
  return escapeHtml(value)
}

/**
 * Tagged template literal that auto-escapes interpolated values into HTML.
 *
 * This is the safe way to build HTML strings in vanilla views — unlike plain
 * template literals, user-supplied values are escaped automatically, and
 * nested `html\`\`` results compose without double-escaping.
 *
 * ```ts
 * // app/Views/AdminReport.ts
 * import { html } from '@rudderjs/view'
 *
 * interface AdminReportProps {
 *   title: string
 *   rows:  { name: string; total: number }[]
 * }
 *
 * export default function AdminReport({ title, rows }: AdminReportProps): string {
 *   return html`
 *     <h1>${title}</h1>
 *     <table>
 *       ${rows.map(r => html`<tr><td>${r.name}</td><td>${r.total}</td></tr>`)}
 *     </table>
 *   `.toString()
 * }
 * ```
 *
 * - **Primitives** (string, number, boolean): escaped via `escapeHtml()`
 * - **null / undefined / false**: rendered as empty string
 * - **Arrays**: each item recursively handled, then joined (no separator)
 * - **`SafeString`**: passed through unchanged — the escape hatch for
 *   composing nested `html\`\`` blocks or injecting pre-rendered markup
 *
 * The return type is `SafeString` so the caller can either compose further
 * with `html\`\`` or coerce to a plain string via `.toString()` (which is
 * what the vanilla view contract expects from `export default`).
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SafeString {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    out += renderHtmlValue(values[i]) + (strings[i + 1] ?? '')
  }
  return new SafeString(out)
}
