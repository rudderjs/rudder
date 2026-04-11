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

export type ViewProps = Record<string, unknown>

export interface ViewResolveContext {
  /** The request URL — used to forward query string into the rendered page */
  url: string
}

const VIEW_URL_PREFIX = '/__view'

export class ViewResponse {
  /** Marker checked by server-hono via duck-typing (avoids a hard import). */
  static readonly __rudder_view__ = true

  constructor(
    public readonly id: string,
    public readonly props: ViewProps,
  ) {}

  /**
   * Resolve this view to an HTTP Response by calling Vike's renderPage().
   * Called by the server adapter after the route handler returns.
   */
  async toResponse(ctx: ViewResolveContext): Promise<Response> {
    const { renderPage } = await import('vike/server')

    // Build the URL we hand to Vike's renderPage. The id maps 1:1 to a URL
    // path that the generated +route.ts file declares (e.g. 'home' → '/home',
    // 'admin.users' → '/admin/users'). This MUST match what Vike's client
    // router sees in its route table — otherwise client-side navigation falls
    // back to a full page reload.
    //
    // Preserve Vike's `/index.pageContext.json` suffix if the request came
    // from SPA nav so renderPage emits a JSON pageContext envelope instead
    // of HTML. The `/index` prefix is mandatory (Vike hard-codes it).
    const PAGE_CTX_SUFFIX = '/index.pageContext.json'
    const parsedUrl = new URL(ctx.url, 'http://localhost')
    const isPageCtx = parsedUrl.pathname.endsWith(PAGE_CTX_SUFFIX)
    const suffix    = isPageCtx ? PAGE_CTX_SUFFIX : ''
    const idPath    = '/' + this.id.replace(/\./g, '/')
    const urlOriginal = `${idPath}${suffix}${parsedUrl.search}`

    const pageContext = await renderPage({
      urlOriginal,
      // Forwarded into pageContext on both server and client; the generated
      // Vike page reads it via `usePageContext().viewProps`.
      viewProps: this.props,
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
 * Render a view from `app/Views/` with controller-supplied props.
 *
 * @param id    Dot-notation view id (e.g. `'dashboard'` → `app/Views/Dashboard.tsx`)
 * @param props Plain object passed to the view component as props
 */
export function view(id: string, props: ViewProps = {}): ViewResponse {
  return new ViewResponse(id, props)
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
