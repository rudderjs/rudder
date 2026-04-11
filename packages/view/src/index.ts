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
